use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub index: u32,
    pub name: String,
    pub memory_used_mib: f64,
    pub memory_total_mib: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub mem_total_bytes: u64,
    pub mem_free_bytes: u64,
    pub gpus: Vec<Gpu>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub controller_id: String,
    pub port: u16,
    pub models: Vec<String>,
    pub live: bool,
    pub last_seen_at: Option<String>,
    pub job_id: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ControllerLink {
    pub name: Option<String>,
    pub url: String,
    #[serde(rename = "self")]
    pub self_: bool,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobPhase {
    Pending,
    Pulling,
    Downloading,
    Starting,
    Ready,
    Failed,
    Stopped,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub recipe_id: String,
    pub gpus: Vec<u32>,
    pub port: u16,
    pub phase: JobPhase,
    pub progress: Option<f64>,
    pub message: Option<String>,
    pub started_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ControllerInfo {
    pub id: String,
    pub name: String,
    pub version: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub controller: ControllerInfo,
    pub generated_at: String,
    pub hardware: Hardware,
    pub endpoints: Vec<Endpoint>,
    pub controllers: Vec<ControllerLink>,
    pub jobs: Vec<Job>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub model: String,
    pub card: String,
    pub engine: String,
    pub cards: u32,
    pub ctx: u64,
    pub fits: bool,
    pub blocked: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recipes {
    pub recipes: Vec<Recipe>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpus: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dry_run: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replace: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PeerRequest {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove: Option<bool>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct PeersReply {
    pub peers: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct ApiErrorReply {
    pub error: ApiErrorBody,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub engines: Vec<EngineLive>,
    pub gpus: Vec<GpuLive>,
    pub series: Vec<SeriesPoint>,
    pub log: LogPage,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EngineLive {
    pub port: u16,
    pub engine: String,
    #[serde(default)]
    pub decode_tps: Option<f64>,
    #[serde(default)]
    pub prefill_tps: Option<f64>,
    #[serde(default)]
    pub running: Option<u32>,
    #[serde(default)]
    pub queued: Option<u32>,
    #[serde(default)]
    pub ttft_ms: Option<f64>,
    #[serde(default)]
    pub kv_fraction: Option<f64>,
    #[serde(default)]
    pub started_at: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GpuLive {
    pub index: u32,
    #[serde(default)]
    pub util_pct: Option<f64>,
    #[serde(default)]
    pub temp_c: Option<f64>,
    #[serde(default)]
    pub power_w: Option<f64>,
    #[serde(default)]
    pub power_limit_w: Option<f64>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SeriesPoint {
    pub at: String,
    pub decode_tps: f64,
    pub prefill_tps: f64,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum RequestKind {
    Chat,
    Health,
    Metrics,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub id: u64,
    pub at: String,
    pub kind: RequestKind,
    pub status: u16,
    pub method: String,
    pub path: String,
    pub client: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub cursor: u64,
    pub lines: Vec<LogLine>,
}
