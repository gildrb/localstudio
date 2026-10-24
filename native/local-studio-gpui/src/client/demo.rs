use std::collections::VecDeque;

use chrono::{DateTime, SecondsFormat, TimeDelta, Utc};
use serde::Deserialize;

use super::fleet::{ControllerState, LOG_LINES, Reach};
use super::http::ApiError;
use super::wire::{Live, Recipes, Snapshot};

const FIXTURE: &str = include_str!("demo.json");
const SWING: [f64; 6] = [1., 0.96, 1.03, 0.99, 1.05, 0.98];
const TICK_SECONDS: i64 = 5;

#[derive(Deserialize)]
struct Fixture {
    anchor: String,
    controllers: Vec<DemoController>,
}

#[derive(Deserialize)]
struct DemoController {
    url: String,
    error: Option<String>,
    snapshot: Option<Snapshot>,
    live: Option<Live>,
    recipes: Option<Recipes>,
}

fn parse(at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

fn iso(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn shift(at: &mut String, delta: TimeDelta) {
    if let Some(time) = parse(at) {
        *at = iso(time + delta);
    }
}

fn shift_snapshot(snapshot: &mut Snapshot, delta: TimeDelta) {
    shift(&mut snapshot.generated_at, delta);
    for endpoint in &mut snapshot.endpoints {
        if let Some(at) = endpoint.last_seen_at.as_mut() {
            shift(at, delta);
        }
    }
    for job in &mut snapshot.jobs {
        shift(&mut job.started_at, delta);
        shift(&mut job.updated_at, delta);
    }
}

fn animate(live: &mut Live, started: DateTime<Utc>, delta: TimeDelta, tick: u64) {
    let swing = SWING[(tick % SWING.len() as u64) as usize];
    for engine in &mut live.engines {
        if let Some(at) = engine.started_at.as_mut() {
            shift(at, delta);
        }
        engine.decode_tps = engine.decode_tps.map(|v| v * swing);
        engine.prefill_tps = engine.prefill_tps.map(|v| v * swing);
        engine.running = engine.running.map(|v| v + (tick % 3) as u32);
    }
    for (index, gpu) in live.gpus.iter_mut().enumerate() {
        gpu.temp_c = gpu.temp_c.map(|v| v + ((tick + index as u64) % 3) as f64);
    }
    for point in &mut live.series {
        shift(&mut point.at, delta);
    }
    if let (Some(point), Some(engine)) = (live.series.last_mut(), live.engines.first()) {
        point.decode_tps = engine.decode_tps.unwrap_or(0.);
        point.prefill_tps = engine.prefill_tps.unwrap_or(0.);
    }
    for line in &mut live.log.lines {
        shift(&mut line.at, delta);
    }
    let templates = live.log.lines.clone();
    if templates.is_empty() {
        return;
    }
    let base = live.log.cursor;
    let fresh = (0..tick).rev().map(|step| {
        let mut line = templates[(step as usize * 7) % templates.len()].clone();
        line.id = base + step + 1;
        line.at = iso(started + TimeDelta::seconds((step as i64 + 1) * TICK_SECONDS));
        line
    });
    let mut lines: Vec<_> = fresh.chain(templates.iter().cloned()).collect();
    lines.truncate(LOG_LINES);
    live.log.cursor = base + tick;
    live.log.lines = lines;
}

pub fn states(started: DateTime<Utc>, tick: u64) -> Vec<ControllerState> {
    let fixture = match serde_json::from_str::<Fixture>(FIXTURE) {
        Ok(fixture) => fixture,
        Err(error) => {
            let mut state = ControllerState::new("demo".to_string());
            state.reach = Reach::Failed {
                error: ApiError::Decode(error.to_string()),
                since: started,
            };
            return vec![state];
        }
    };
    let delta = parse(&fixture.anchor).map_or(TimeDelta::zero(), |anchor| started - anchor);
    fixture
        .controllers
        .into_iter()
        .map(|demo| {
            let mut state = ControllerState::new(demo.url);
            state.reach = match demo.error {
                Some(reason) => Reach::Failed {
                    error: ApiError::Unreachable(reason),
                    since: started - TimeDelta::minutes(30),
                },
                None => Reach::Ok,
            };
            state.snapshot = demo.snapshot.map(|mut snapshot| {
                shift_snapshot(&mut snapshot, delta);
                snapshot
            });
            state.name = state.snapshot.as_ref().map(|s| s.controller.name.clone());
            state.recipes = demo.recipes;
            if let Some(mut live) = demo.live {
                animate(&mut live, started, delta, tick);
                state.cursor = Some(live.log.cursor);
                state.log = VecDeque::from(std::mem::take(&mut live.log.lines));
                state.live = Some(live);
            }
            state
        })
        .collect()
}
