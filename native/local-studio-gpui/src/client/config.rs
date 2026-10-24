use std::io;
use std::path::PathBuf;

use serde::Deserialize;

pub struct ClientConfig {
    pub url: String,
    pub fleet_key: String,
    pub peers: Vec<String>,
}

impl std::fmt::Debug for ClientConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClientConfig")
            .field("url", &self.url)
            .field("peers", &self.peers)
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub enum ConfigError {
    Missing(PathBuf),
    Unreadable {
        path: PathBuf,
        source: io::Error,
    },
    Invalid {
        path: PathBuf,
        source: serde_json::Error,
    },
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Missing(path) => write!(f, "No controller config at {}.", path.display()),
            ConfigError::Unreadable { path, source } => {
                write!(f, "Cannot read {}: {source}.", path.display())
            }
            ConfigError::Invalid { path, source } => {
                write!(f, "{} is not valid: {source}.", path.display())
            }
        }
    }
}

impl std::error::Error for ConfigError {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    url: String,
    fleet_key: String,
    #[serde(default)]
    peers: Vec<String>,
}

pub fn config_path() -> Result<PathBuf, ConfigError> {
    match std::env::var_os("LOCAL_STUDIO_T3_HOME") {
        Some(home) => Ok(PathBuf::from(home).join("config.json")),
        None => dirs::home_dir()
            .map(|home| home.join(".local-studio-t3").join("config.json"))
            .ok_or_else(|| ConfigError::Missing(PathBuf::from("~/.local-studio-t3/config.json"))),
    }
}

pub fn load_config() -> Result<ClientConfig, ConfigError> {
    let path = config_path()?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(source) if source.kind() == io::ErrorKind::NotFound => {
            return Err(ConfigError::Missing(path));
        }
        Err(source) => return Err(ConfigError::Unreadable { path, source }),
    };
    let file: ConfigFile =
        serde_json::from_str(&text).map_err(|source| ConfigError::Invalid { path, source })?;
    Ok(ClientConfig {
        url: file.url,
        fleet_key: file.fleet_key,
        peers: file.peers,
    })
}
