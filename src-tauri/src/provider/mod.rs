//! Multi-backend LLM layer: OpenAI, Ollama, placeholders; async completion + streaming.

mod engine;
mod error;
mod ollama;
mod openai;
mod placeholder;
mod types;

pub use engine::LLMProviderEngine;
pub use error::ProviderError;
pub use ollama::OllamaProvider;
pub use openai::OpenAIProvider;
pub use placeholder::{AnthropicPlaceholder, PlaceholderEngine};
pub use types::{
    ChatSendResult, ChatTurn, CompletionRequest, CompletionResponse, ModelInfo, ProviderDescriptor,
    StreamChunk, TokenUsage, ToolCall, ToolDefinition,
};

use std::sync::Arc;

use crate::settings::SettingsManager;

/// Static catalog for the settings UI (`provider_list_available`).
#[must_use]
pub fn list_provider_descriptors() -> Vec<ProviderDescriptor> {
    vec![
        ProviderDescriptor {
            id: "placeholder".into(),
            label: "Placeholder (offline)".into(),
            local_first: true,
            requires_api_key: false,
        },
        ProviderDescriptor {
            id: "openai".into(),
            label: "OpenAI".into(),
            local_first: false,
            requires_api_key: true,
        },
        ProviderDescriptor {
            id: "ollama".into(),
            label: "Ollama (local)".into(),
            local_first: true,
            requires_api_key: false,
        },
        ProviderDescriptor {
            id: "anthropic".into(),
            label: "Anthropic (planned)".into(),
            local_first: false,
            requires_api_key: true,
        },
    ]
}

/// Build the active engine from encrypted [`SettingsManager`] (and mirrored public prefs).
pub fn build_engine(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Arc<dyn LLMProviderEngine + Send + Sync>, ProviderError> {
    let active = settings.selected_provider();
    let engine: Arc<dyn LLMProviderEngine + Send + Sync> = match active.trim() {
        "openai" => Arc::new(OpenAIProvider::from_settings(settings, http)?),
        "ollama" => Arc::new(OllamaProvider::from_settings(settings, http)),
        "anthropic" => Arc::new(AnthropicPlaceholder::new()),
        _ => Arc::new(PlaceholderEngine::new()),
    };
    Ok(engine)
}
