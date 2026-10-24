use std::collections::{BTreeMap, BTreeSet, VecDeque};

use chrono::{DateTime, Local, Utc};

use crate::client::wire::{EngineLive, Job, JobPhase, Live, LogLine, RequestKind, Snapshot};
use crate::client::{ApiError, ControllerState, Reach};
use crate::format;

const VRAM_HIGH: f64 = 0.95;
const KV_HIGH: f64 = 0.9;

#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Running,
    Idle,
    Loading {
        percent: Option<u8>,
    },
    Failed {
        message: String,
    },
    Offline {
        since: DateTime<Utc>,
        reason: String,
    },
    NeedsKey,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Normal,
    High,
}

#[derive(Clone, Debug)]
pub struct Metric {
    pub value: String,
    pub context: String,
    pub level: Level,
    pub spoken: String,
}

#[derive(Clone, Debug)]
pub struct NowRows {
    pub decode: Metric,
    pub prefill: Metric,
    pub requests: Metric,
    pub first_token: Metric,
    pub vram: Metric,
    pub kv: Metric,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EngineAction {
    Stop { port: u16 },
    Cancel { job_id: String },
    Dismiss { job_id: String },
}

#[derive(Clone, Debug)]
pub struct EngineRow {
    pub model: String,
    pub engine: Option<String>,
    pub port: u16,
    pub gpus: Option<String>,
    pub status: Status,
    pub action: EngineAction,
}

#[derive(Clone, Debug)]
pub struct GpuRow {
    pub index: u32,
    pub memory: (u64, u64),
    pub util_pct: Option<f64>,
    pub temp_c: Option<f64>,
    pub power: Option<(f64, f64)>,
}

#[derive(Clone, Debug)]
pub struct ControllerView {
    pub name: String,
    pub url: String,
    pub version: String,
    pub status: Status,
    pub model_line: String,
    pub gpu_label: Option<String>,
    pub engines: Vec<EngineRow>,
    pub gpus: Vec<GpuRow>,
    pub now: NowRows,
    pub warnings: Vec<String>,
    pub live_supported: bool,
    pub live_error: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct LogFilter {
    pub query: String,
    pub kinds: BTreeSet<RequestKind>,
}

#[derive(Clone, Debug, Default)]
pub struct LogView {
    pub rows: Vec<usize>,
    pub counts: BTreeMap<RequestKind, usize>,
    pub summary: String,
}

fn strip_gpu(name: &str) -> String {
    name.trim_start_matches("NVIDIA ")
        .trim_start_matches("GeForce ")
        .trim_end_matches(" Workstation Edition")
        .to_string()
}

fn range(gpus: &[u32]) -> Option<String> {
    let first = *gpus.iter().min()?;
    let last = *gpus.iter().max()?;
    let contiguous = usize::try_from(last - first).is_ok_and(|span| span + 1 == gpus.len());
    Some(match (first == last, contiguous) {
        (true, _) => first.to_string(),
        (false, true) => format!("{first}\u{2013}{last}"),
        (false, false) => gpus
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(","),
    })
}

fn host(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['/', ':']).next().unwrap_or(rest).to_string()
}

fn mib_bytes(mib: f64) -> u64 {
    (mib.max(0.) * 1_048_576.).round() as u64
}

fn spoken(text: &str) -> String {
    text.replace(format::NBSP, " ")
}

fn metric(name: &str, value: String, context: String, level: Level) -> Metric {
    let spoken = match context.is_empty() {
        true => spoken(&format!("{name} {value}")),
        false => spoken(&format!("{name} {value}, {context}")),
    };
    Metric {
        value,
        context,
        level,
        spoken,
    }
}

fn unknown(name: &str, reason: &str) -> Metric {
    metric(
        name,
        format::UNKNOWN.to_string(),
        reason.to_string(),
        Level::Normal,
    )
}

fn job_status(job: &Job) -> Option<Status> {
    match job.phase {
        JobPhase::Pending | JobPhase::Pulling | JobPhase::Downloading | JobPhase::Starting => {
            Some(Status::Loading {
                percent: job.progress.map(|p| (p.clamp(0., 1.) * 100.).round() as u8),
            })
        }
        JobPhase::Failed => Some(Status::Failed {
            message: job
                .message
                .clone()
                .unwrap_or_else(|| "failed without a message".to_string()),
        }),
        JobPhase::Ready | JobPhase::Stopped => None,
    }
}

fn across(count: usize) -> String {
    match count {
        0 | 1 => String::new(),
        n => format!("across {n}{}engines", format::NBSP),
    }
}

fn now_rows(snapshot: Option<&Snapshot>, live: Option<&Live>, running: usize) -> NowRows {
    let vram = snapshot.and_then(vram_of).map_or_else(
        || unknown("VRAM", "not reported"),
        |(used, total)| {
            let fraction = if total > 0 {
                used as f64 / total as f64
            } else {
                0.
            };
            let high = fraction >= VRAM_HIGH;
            let context = match high {
                true => format!("{}, high", format::percent(fraction)),
                false => format::percent(fraction),
            };
            let level = if high { Level::High } else { Level::Normal };
            metric("VRAM", format::gigabytes_used(used, total), context, level)
        },
    );
    let Some(live) = live else {
        return NowRows {
            decode: unknown("Decode", "not reported"),
            prefill: unknown("Prefill", "not reported"),
            requests: unknown("Requests", "not reported"),
            first_token: unknown("First token", "not reported"),
            vram,
            kv: unknown("KV cache", "not reported"),
        };
    };
    let engines = &live.engines;
    if engines.is_empty() || running == 0 {
        return NowRows {
            decode: unknown("Decode", "idle"),
            prefill: unknown("Prefill", "idle"),
            requests: unknown("Requests", "idle"),
            first_token: unknown("First token", "idle"),
            vram,
            kv: unknown("KV cache", "idle"),
        };
    }
    let sum = |f: fn(&EngineLive) -> Option<f64>| {
        let values: Vec<f64> = engines.iter().filter_map(f).collect();
        (!values.is_empty()).then(|| values.iter().sum::<f64>())
    };
    let spread = across(engines.len());
    let in_flight: Option<u32> = engines
        .iter()
        .filter_map(|e| e.running)
        .reduce(u32::saturating_add);
    let queued: Option<u32> = engines
        .iter()
        .filter_map(|e| e.queued)
        .reduce(u32::saturating_add);
    let decode = sum(|e| e.decode_tps).map_or_else(
        || unknown("Decode", "not reported"),
        |tps| {
            let context = match (engines.len(), in_flight) {
                (1, Some(n)) if n > 0 => format!(
                    "{:.1}{}per{}request",
                    tps / f64::from(n),
                    format::NBSP,
                    format::NBSP
                ),
                _ => spread.clone(),
            };
            metric("Decode", format::rate(tps), context, Level::Normal)
        },
    );
    let peak = live
        .series
        .iter()
        .map(|point| point.prefill_tps)
        .fold(None, |max: Option<f64>, v| {
            Some(max.map_or(v, |m| m.max(v)))
        });
    let prefill = sum(|e| e.prefill_tps).map_or_else(
        || unknown("Prefill", "not reported"),
        |tps| {
            let context = match peak {
                Some(peak) if engines.len() == 1 => format!("peak {}", format::compact(peak)),
                _ => spread.clone(),
            };
            metric("Prefill", format::rate(tps), context, Level::Normal)
        },
    );
    let requests = in_flight.map_or_else(
        || unknown("Requests", "not reported"),
        |n| {
            let context = queued.map_or_else(String::new, |q| format!("{q}{}queued", format::NBSP));
            metric(
                "Requests",
                format!("{n}{}running", format::NBSP),
                context,
                Level::Normal,
            )
        },
    );
    let ttfts: Vec<f64> = engines.iter().filter_map(|e| e.ttft_ms).collect();
    let first_token = match ttfts.is_empty() {
        true => unknown("First token", "not reported"),
        false => {
            let mean = ttfts.iter().sum::<f64>() / ttfts.len() as f64;
            let context = match ttfts.len() {
                1 => String::new(),
                n => format!("mean of {n}{}engines", format::NBSP),
            };
            metric("First token", format::millis(mean), context, Level::Normal)
        }
    };
    let kv = engines
        .iter()
        .filter_map(|e| e.kv_fraction)
        .fold(None, |max: Option<f64>, v| {
            Some(max.map_or(v, |m| m.max(v)))
        })
        .map_or_else(
            || unknown("KV cache", "not reported"),
            |fraction| {
                let high = fraction >= KV_HIGH;
                let context = match (high, engines.len()) {
                    (true, _) => "high".to_string(),
                    (false, 1) => String::new(),
                    (false, n) => format!("highest of {n}{}engines", format::NBSP),
                };
                let level = if high { Level::High } else { Level::Normal };
                metric("KV cache", format::percent(fraction), context, level)
            },
        );
    NowRows {
        decode,
        prefill,
        requests,
        first_token,
        vram,
        kv,
    }
}

fn vram_of(snapshot: &Snapshot) -> Option<(u64, u64)> {
    let gpus = &snapshot.hardware.gpus;
    if gpus.is_empty() {
        let hardware = &snapshot.hardware;
        return (hardware.mem_total_bytes > 0).then(|| {
            (
                hardware
                    .mem_total_bytes
                    .saturating_sub(hardware.mem_free_bytes),
                hardware.mem_total_bytes,
            )
        });
    }
    Some((
        gpus.iter().map(|g| mib_bytes(g.memory_used_mib)).sum(),
        gpus.iter().map(|g| mib_bytes(g.memory_total_mib)).sum(),
    ))
}

pub fn controller_view(state: &ControllerState) -> ControllerView {
    let snapshot = state.snapshot.as_ref();
    let own = snapshot.map(|s| s.controller.id.as_str());
    let live = state.live.as_ref();
    let recipe_engine = |recipe_id: &str| {
        state
            .recipes
            .as_ref()
            .and_then(|r| r.recipes.iter().find(|recipe| recipe.id == recipe_id))
            .map(|recipe| recipe.engine.clone())
    };
    let live_engine = |port: u16| {
        live.and_then(|l| l.engines.iter().find(|e| e.port == port))
            .map(|e| e.engine.clone())
    };
    let jobs: &[Job] = snapshot.map_or(&[], |s| s.jobs.as_slice());
    let mut engines: Vec<EngineRow> = snapshot
        .map_or(&[][..], |s| s.endpoints.as_slice())
        .iter()
        .filter(|endpoint| endpoint.live && Some(endpoint.controller_id.as_str()) == own)
        .map(|endpoint| {
            let job = endpoint
                .job_id
                .as_ref()
                .and_then(|id| jobs.iter().find(|job| &job.id == id))
                .or_else(|| jobs.iter().find(|job| job.port == endpoint.port));
            EngineRow {
                model: endpoint.models.join(", "),
                engine: live_engine(endpoint.port)
                    .or_else(|| job.and_then(|job| recipe_engine(&job.recipe_id))),
                port: endpoint.port,
                gpus: job.and_then(|job| range(&job.gpus)),
                status: Status::Running,
                action: EngineAction::Stop {
                    port: endpoint.port,
                },
            }
        })
        .collect();
    let running = engines.len();
    for job in jobs {
        let Some(status) = job_status(job) else {
            continue;
        };
        if engines.iter().any(|row| row.port == job.port) {
            continue;
        }
        let action = match status {
            Status::Failed { .. } => EngineAction::Dismiss {
                job_id: job.id.clone(),
            },
            Status::Running
            | Status::Idle
            | Status::Loading { .. }
            | Status::Offline { .. }
            | Status::NeedsKey => EngineAction::Cancel {
                job_id: job.id.clone(),
            },
        };
        engines.push(EngineRow {
            model: job.recipe_id.clone(),
            engine: recipe_engine(&job.recipe_id),
            port: job.port,
            gpus: range(&job.gpus),
            status,
            action,
        });
    }
    let first_job = engines.get(running).map(|row| row.status.clone());
    let status = match &state.reach {
        Reach::Failed {
            error: ApiError::Unauthorized,
            ..
        } => Status::NeedsKey,
        Reach::Failed { error, since } => Status::Offline {
            since: *since,
            reason: error.to_string(),
        },
        Reach::Connecting | Reach::Ok if running > 0 => Status::Running,
        Reach::Connecting | Reach::Ok => first_job.unwrap_or(Status::Idle),
    };
    let models: Vec<&str> = engines[..running]
        .iter()
        .map(|r| r.model.as_str())
        .collect();
    let model_line = match &status {
        Status::NeedsKey => "fleet key rejected".to_string(),
        Status::Offline { since, .. } => format!(
            "not answering since {}",
            since.with_timezone(&Local).format("%H:%M")
        ),
        Status::Running => models.join(", "),
        Status::Loading { .. } | Status::Failed { .. } => engines
            .get(running)
            .map_or_else(String::new, |row| row.model.clone()),
        Status::Idle if matches!(state.reach, Reach::Connecting) => "connecting".to_string(),
        Status::Idle => "no model loaded".to_string(),
    };
    let names: Vec<String> = snapshot
        .map_or(&[][..], |s| s.hardware.gpus.as_slice())
        .iter()
        .map(|gpu| strip_gpu(&gpu.name))
        .collect();
    let name_refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let gpu_label = (!name_refs.is_empty()).then(|| format::gpu_label(&name_refs));
    let gpus: Vec<GpuRow> = snapshot
        .map_or(&[][..], |s| s.hardware.gpus.as_slice())
        .iter()
        .map(|gpu| {
            let live_gpu = live.and_then(|l| l.gpus.iter().find(|g| g.index == gpu.index));
            GpuRow {
                index: gpu.index,
                memory: (
                    mib_bytes(gpu.memory_used_mib),
                    mib_bytes(gpu.memory_total_mib),
                ),
                util_pct: live_gpu.and_then(|g| g.util_pct),
                temp_c: live_gpu.and_then(|g| g.temp_c),
                power: live_gpu.and_then(|g| g.power_w.zip(g.power_limit_w)),
            }
        })
        .collect();
    let warnings = gpus
        .iter()
        .filter_map(|gpu| {
            let (draw, limit) = gpu.power?;
            (draw.round() > limit.round()).then(|| {
                format!(
                    "G{} draws {}, {} over its {} limit.",
                    gpu.index,
                    watts(draw),
                    watts(draw - limit),
                    watts(limit)
                )
            })
        })
        .collect();
    ControllerView {
        name: snapshot
            .map(|s| s.controller.name.clone())
            .or_else(|| state.name.clone())
            .unwrap_or_else(|| host(&state.url)),
        url: state.url.clone(),
        version: snapshot.map_or_else(String::new, |s| s.controller.version.clone()),
        model_line,
        gpu_label,
        now: now_rows(snapshot, live, running),
        status,
        engines,
        gpus,
        warnings,
        live_supported: live.is_some() || state.live_error.is_some(),
        live_error: state.live_error.as_ref().map(ToString::to_string),
    }
}

fn watts(value: f64) -> String {
    format!("{}{}W", value.round() as i64, format::NBSP)
}

fn hidden_phrase(kind: RequestKind, count: usize) -> String {
    let noun = match (kind, count) {
        (RequestKind::Chat, 1) => "chat request",
        (RequestKind::Chat, _) => "chat requests",
        (RequestKind::Health, 1) => "health check",
        (RequestKind::Health, _) => "health checks",
        (RequestKind::Metrics, 1) => "metrics scrape",
        (RequestKind::Metrics, _) => "metrics scrapes",
    };
    format!("{count}{}{noun} hidden", format::NBSP)
}

pub fn log_view(lines: &VecDeque<LogLine>, filter: &LogFilter) -> LogView {
    let mut counts = BTreeMap::new();
    let mut rows = Vec::new();
    let mut failed = 0;
    let query = filter.query.to_lowercase();
    for (index, line) in lines.iter().enumerate() {
        *counts.entry(line.kind).or_insert(0) += 1;
        let matches = query.is_empty()
            || line.path.to_lowercase().contains(&query)
            || line.client.to_lowercase().contains(&query);
        if filter.kinds.contains(&line.kind) && matches {
            rows.push(index);
            if line.status >= 400 {
                failed += 1;
            }
        }
    }
    let mut parts = vec![format!(
        "{}{nbsp}of{nbsp}{}{nbsp}requests, newest first",
        rows.len(),
        lines.len(),
        nbsp = format::NBSP
    )];
    parts.extend(
        counts
            .iter()
            .filter(|(kind, count)| **count > 0 && !filter.kinds.contains(kind))
            .map(|(kind, count)| hidden_phrase(*kind, *count)),
    );
    if failed > 0 {
        parts.push(format!("{failed}{}failed", format::NBSP));
    }
    LogView {
        rows,
        counts,
        summary: parts.join(", "),
    }
}
