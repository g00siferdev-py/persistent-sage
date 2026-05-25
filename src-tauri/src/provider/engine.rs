//! Async [`LLMProviderEngine`] — completion + streaming + tool-ready payloads.

use async_trait::async_trait;

use super::error::ProviderError;
use super::types::{CompletionRequest, CompletionResponse, ModelInfo, StreamChunk, ToolDefinition};

#[async_trait]
pub trait LLMProviderEngine: Send + Sync {
    fn provider_id(&self) -> &'static str;

    fn model_info(&self) -> ModelInfo;

    /// Non-streaming completion (aggregates model output).
    async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionResponse, ProviderError>;

    /// Token/delta stream; send [`StreamChunk`] with `done: true` as the final message.
    async fn stream(
        &self,
        request: &CompletionRequest,
        tx: tokio::sync::mpsc::Sender<Result<StreamChunk, ProviderError>>,
    ) -> Result<(), ProviderError>;

    /// Optional: tools the model may call (OpenAI format). Default: use request.tools.
    fn merge_tools<'a>(&self, request: &'a CompletionRequest) -> Option<&'a Vec<ToolDefinition>> {
        request.tools.as_ref()
    }
}
