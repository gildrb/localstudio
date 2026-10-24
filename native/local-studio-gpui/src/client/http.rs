use std::fmt;
use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;
use ureq::Agent;

use super::wire::{
    ApiErrorReply, Job, Live, PeerRequest, PeersReply, Recipes, RunRequest, Snapshot,
};

const READ_TIMEOUT: Duration = Duration::from_secs(3);
const ACT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub enum ApiError {
    Unreachable(String),
    Unauthorized,
    Http {
        status: u16,
        code: String,
        message: String,
    },
    Decode(String),
    UnsupportedScheme(String),
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Unreachable(reason) => write!(f, "{reason}"),
            ApiError::Unauthorized => write!(f, "fleet key rejected"),
            ApiError::Http {
                status,
                code,
                message,
            } => write!(f, "{status} {code}: {message}"),
            ApiError::Decode(reason) => write!(f, "unexpected reply: {reason}"),
            ApiError::UnsupportedScheme(scheme) => write!(f, "Unsupported URL scheme {scheme}"),
        }
    }
}

impl std::error::Error for ApiError {}

pub struct Controller {
    base: String,
    key: String,
    read: Agent,
    act: Agent,
}

impl fmt::Debug for Controller {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Controller")
            .field("base", &self.base)
            .finish_non_exhaustive()
    }
}

fn agent(timeout: Option<Duration>) -> Agent {
    Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(timeout)
        .build()
        .into()
}

impl Controller {
    pub fn new(base: String, key: String) -> Result<Self, ApiError> {
        match base.split_once("://") {
            Some(("http", _)) => Ok(Controller {
                base: base.trim_end_matches('/').to_string(),
                key,
                read: agent(Some(READ_TIMEOUT)),
                act: agent(Some(ACT_TIMEOUT)),
            }),
            Some((scheme, _)) => Err(ApiError::UnsupportedScheme(scheme.to_string())),
            None => Err(ApiError::UnsupportedScheme(base)),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    fn decode<T: DeserializeOwned>(
        result: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<Option<T>, ApiError> {
        let mut response = result.map_err(|error| ApiError::Unreachable(error.to_string()))?;
        let status = response.status().as_u16();
        let text = response
            .body_mut()
            .read_to_string()
            .map_err(|error| ApiError::Unreachable(error.to_string()))?;
        match status {
            200..=299 => serde_json::from_str(&text)
                .map(Some)
                .map_err(|error| ApiError::Decode(error.to_string())),
            401 | 403 => Err(ApiError::Unauthorized),
            404 => Ok(None),
            _ => match serde_json::from_str::<ApiErrorReply>(&text) {
                Ok(reply) => Err(ApiError::Http {
                    status,
                    code: reply.error.code,
                    message: reply.error.message,
                }),
                Err(error) => Err(ApiError::Decode(format!("HTTP {status}: {error}"))),
            },
        }
    }

    fn required<T>(value: Option<T>, path: &str) -> Result<T, ApiError> {
        value.ok_or_else(|| ApiError::Http {
            status: 404,
            code: "not_found".to_string(),
            message: path.to_string(),
        })
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<Option<T>, ApiError> {
        let result = self
            .read
            .get(&self.url(path))
            .header("Authorization", &format!("Bearer {}", self.key))
            .call();
        Self::decode(result)
    }

    fn post<B: Serialize, T: DeserializeOwned>(&self, path: &str, body: &B) -> Result<T, ApiError> {
        let text =
            serde_json::to_string(body).map_err(|error| ApiError::Decode(error.to_string()))?;
        let result = self
            .act
            .post(&self.url(path))
            .header("Authorization", &format!("Bearer {}", self.key))
            .header("Content-Type", "application/json")
            .send(text.as_str());
        Self::required(Self::decode(result)?, path)
    }

    pub fn snapshot(&self) -> Result<Snapshot, ApiError> {
        Self::required(self.get("/api/snapshot")?, "/api/snapshot")
    }

    pub fn recipes(&self, archived: bool) -> Result<Recipes, ApiError> {
        let path = if archived {
            "/api/recipes?archived=1"
        } else {
            "/api/recipes"
        };
        Self::required(self.get(path)?, path)
    }

    pub fn run_recipe(&self, id: &str, req: &RunRequest) -> Result<Job, ApiError> {
        self.post(&format!("/api/recipes/{id}/run"), req)
    }

    pub fn stop_run(&self, job_id: &str) -> Result<(), ApiError> {
        self.post::<_, serde_json::Value>(
            &format!("/api/runs/{job_id}/stop"),
            &serde_json::json!({}),
        )
        .map(|_| ())
    }

    pub fn stop_port(&self, port: u16) -> Result<(), ApiError> {
        self.post::<_, serde_json::Value>(
            &format!("/api/ports/{port}/stop"),
            &serde_json::json!({}),
        )
        .map(|_| ())
    }

    pub fn add_peer(&self, url: &str) -> Result<Vec<String>, ApiError> {
        let request = PeerRequest {
            url: url.to_string(),
            remove: None,
        };
        self.post::<_, PeersReply>("/api/peers", &request)
            .map(|reply| reply.peers)
    }

    pub fn live(&self, cursor: Option<u64>) -> Result<Option<Live>, ApiError> {
        match cursor {
            Some(cursor) => self.get(&format!("/api/live?cursor={cursor}")),
            None => self.get("/api/live"),
        }
    }
}
