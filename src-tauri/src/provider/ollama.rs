//! Ollama native `/api/chat` — local-first, streaming-friendly.

use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};

use super::engine::LLMProviderEngine;
use super::error::ProviderError;
use super::types::{
    CompletionRequest, CompletionResponse, ModelInfo, StreamChunk, ToolCall,
};
use crate::settings::SettingsManager;

/// Typical context for recent Ollama models (conservative default).
const DEFAULT_OLLAMA_CTX: u32 = 128_000;

pub struct OllamaProvider {
    client: reqwest::Client,
    base_url: String,
    model: String,
}

impl OllamaProvider {
    pub fn from_settings(settings: &SettingsManager, http: &reqwest::Client) -> Self {
        let base_url = settings.ollama_base_url().trim_end_matches('/').to_string();
        let model = settings.ollama_model();
        Self {
            client: http.clone(),
            base_url,
            model,
        }
    }

    fn chat_url(&self) -> String {
        format!("{}/api/chat", self.base_url)
    }

    fn build_messages(request: &CompletionRequest) -> Vec<Value> {
        request
            .messages
            .iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect()
    }

    fn build_options(request: &CompletionRequest) -> Value {
        let mut o = json!({});
        if let Some(t) = request.temperature {
            o.as_object_mut().unwrap().insert("temperature".into(), json!(t));
        }
        if let Some(mt) = request.max_tokens {
            o.as_object_mut()
                .unwrap()
                .insert("num_predict".into(), json!(mt));
        }
        o
    }
}

#[async_trait]
impl LLMProviderEngine for OllamaProvider {
    fn provider_id(&self) -> &'static str {
        "ollama"
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            provider_id: "ollama".to_string(),
            model_id: self.model.clone(),
            context_window_tokens: Some(DEFAULT_OLLAMA_CTX),
        }
    }

    async fn complete(&self, request: &CompletionRequest) -> Result<CompletionResponse, ProviderError> {
        let body = json!({
            "model": self.model,
            "messages": Self::build_messages(request),
            "stream": false,
            "options": Self::build_options(request),
        });
        let res = self
            .client
            .post(self.chat_url())
            .json(&body)
            .timeout(Duration::from_secs(300))
            .send()
            .await?
            .error_for_status()?;

        let v: Value = res.json().await?;
        if let Some(err) = v["error"].as_str() {
            return Err(ProviderError::Api(err.to_string()));
        }
        let content = v["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let mut tool_calls = Vec::new();
        if let Some(tc) = v["message"]["tool_calls"].as_array() {
            for t in tc {
                let id = t["id"].as_str().unwrap_or("").to_string();
                let name = t["function"]["name"].as_str().unwrap_or("").to_string();
                let args = t["function"]["arguments"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| t["function"]["arguments"].to_string());
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments_json: args,
                });
            }
        }

        Ok(CompletionResponse {
            content,
            tool_calls,
            finish_reason: v["done"].as_bool().and_then(|d| d.then_some("stop".to_string())),
            usage: None,
        })
    }

    async fn stream(
        &self,
        request: &CompletionRequest,
        tx: tokio::sync::mpsc::Sender<Result<StreamChunk, ProviderError>>,
    ) -> Result<(), ProviderError> {
        let body = json!({
            "model": self.model,
            "messages": Self::build_messages(request),
            "stream": true,
            "options": Self::build_options(request),
        });
        let res = self
            .client
            .post(self.chat_url())
            .json(&body)
            .timeout(Duration::from_secs(300))
            .send()
            .await?
            .error_for_status()?;

        let mut stream = res.bytes_stream();
        let mut line_buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(ProviderError::Http)?;
            line_buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = line_buf.find('\n') {
                let line = line_buf[..pos].trim().to_string();
                line_buf = line_buf[pos + 1..].to_string();
                if line.is_empty() {
                    continue;
                }
                let v: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let Some(err) = v["error"].as_str() {
                    let _ = tx.send(Err(ProviderError::Api(err.to_string()))).await;
                    return Ok(());
                }
                let piece = v["message"]["content"].as_str().unwrap_or("");
                if !piece.is_empty() {
                    let _ = tx
                        .send(Ok(StreamChunk {
                            delta: piece.to_string(),
                            done: false,
                        }))
                        .await;
                }
                if v["done"].as_bool() == Some(true) {
                    let _ = tx
                        .send(Ok(StreamChunk {
                            delta: String::new(),
                            done: true,
                        }))
                        .await;
                    return Ok(());
                }
            }
        }

        let _ = tx
            .send(Ok(StreamChunk {
                delta: String::new(),
                done: true,
            }))
            .await;
        Ok(())
    }
}
