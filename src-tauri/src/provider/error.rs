//! Provider-facing errors (HTTP, JSON, configuration).

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("API error: {0}")]
    Api(String),

    #[error("missing API key for {0}; save it in Settings (encrypted storage)")]
    MissingApiKey(&'static str),

    #[error("invalid provider configuration: {0}")]
    Config(String),

    #[error("stream closed unexpectedly")]
    StreamClosed,

    #[error("memory / settings error: {0}")]
    Settings(String),
}

impl From<crate::memory::MemoryError> for ProviderError {
    fn from(e: crate::memory::MemoryError) -> Self {
        ProviderError::Settings(e.to_string())
    }
}

impl From<crate::settings::SettingsError> for ProviderError {
    fn from(e: crate::settings::SettingsError) -> Self {
        ProviderError::Config(e.to_string())
    }
}
