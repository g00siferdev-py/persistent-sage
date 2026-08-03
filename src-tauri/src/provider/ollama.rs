//! Ollama native `/api/chat` — local-first, streaming-friendly.

use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};

use super::engine::LLMProviderEngine;
use super::error::ProviderError;
use super::types::{
    CompletionRequest, CompletionResponse, ModelCatalogEntry, ModelInfo, StreamChunk, ToolCall,
    ToolDefinition,
};
use crate::settings::SettingsManager;

/// `error_for_status` hides Ollama's JSON error body, which is where the useful message lives.
async fn ok_or_api_error(
    res: reqwest::Response,
    cloud_model: Option<&str>,
) -> Result<reqwest::Response, ProviderError> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    let body: String = body.trim().chars().take(2000).collect();
    let mut message = format!("HTTP {status}: {body}");
    if let Some(hint) = retirement_hint(status, &body, cloud_model) {
        message.push_str("\n\n");
        message.push_str(&hint);
    }
    Err(ProviderError::Api(message))
}

/// Ollama retires cloud models without notice, and the raw 404 does not say so.
fn retirement_hint(
    status: reqwest::StatusCode,
    body: &str,
    cloud_model: Option<&str>,
) -> Option<String> {
    let model = cloud_model?;
    let lower = body.to_ascii_lowercase();
    let looks_missing = status == reqwest::StatusCode::NOT_FOUND
        || lower.contains("not found")
        || lower.contains("does not exist")
        || lower.contains("unknown model");
    if !looks_missing {
        return None;
    }
    Some(format!(
        "`{model}` is not available on your Ollama Cloud account. Ollama retires cloud \
         models regularly, so this one was most likely withdrawn or renamed. Open \
         Settings → Provider → Ollama · Cloud and press Refresh Models to pick a model \
         that is offered today."
    ))
}

/// Typical context for recent Ollama models (conservative default).
const DEFAULT_OLLAMA_CTX: u32 = 128_000;

/// `num_predict` upper bound — avoids absurd values from shared presets.
const OLLAMA_NUM_PREDICT_CAP: u32 = 131_072;

pub struct OllamaProvider {
    client: reqwest::Client,
    base_url: String,
    model: String,
    /// When set, sends `Authorization: Bearer …` (Ollama Cloud).
    bearer_token: Option<String>,
}

impl OllamaProvider {
    pub fn from_settings(settings: &SettingsManager, http: &reqwest::Client) -> Self {
        let base_url = settings.ollama_base_url().trim_end_matches('/').to_string();
        let model = settings.ollama_model();
        Self {
            client: http.clone(),
            base_url,
            model,
            bearer_token: None,
        }
    }

    /// Remote Ollama host at `https://ollama.com` with API key from encrypted settings (`ollama` slot).
    pub fn from_cloud_settings(
        settings: &SettingsManager,
        http: &reqwest::Client,
    ) -> Result<Self, ProviderError> {
        let token = settings
            .decrypt_api_key("ollama")?
            .filter(|s| !s.trim().is_empty())
            .ok_or(ProviderError::MissingApiKey("ollama"))?;
        let model = settings.ollama_cloud_model();
        Ok(Self {
            client: http.clone(),
            base_url: "https://ollama.com".to_string(),
            model,
            bearer_token: Some(token),
        })
    }

    fn chat_url(&self) -> String {
        format!("{}/api/chat", self.base_url)
    }

    fn authorized(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.bearer_token {
            Some(t) => req.header("Authorization", format!("Bearer {t}")),
            None => req,
        }
    }

    /// The model name to blame in a retirement hint — cloud only; local misses are the user's pull.
    fn cloud_model(&self) -> Option<&str> {
        self.bearer_token.is_some().then_some(self.model.as_str())
    }

    fn build_messages(request: &CompletionRequest) -> Vec<Value> {
        request
            .messages
            .iter()
            .map(|m| {
                if let Some(ref raw) = m.ollama_message {
                    raw.clone()
                } else {
                    json!({"role": m.role, "content": m.content})
                }
            })
            .collect()
    }

    fn build_tools_json(tools: &[ToolDefinition]) -> Vec<Value> {
        tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": &t.name,
                        "description": &t.description,
                        "parameters": &t.parameters,
                    }
                })
            })
            .collect()
    }

    fn attach_tools(body: &mut Value, tools: Option<&Vec<ToolDefinition>>) {
        let Some(list) = tools else { return };
        if list.is_empty() {
            return;
        }
        body.as_object_mut()
            .unwrap()
            .insert("tools".into(), json!(Self::build_tools_json(list)));
    }

    /// `/api/chat` final `message.content` may be a string or a list of content parts.
    fn stringify_message_content(content: &Value) -> String {
        match content {
            Value::String(s) => s.clone(),
            Value::Array(parts) => {
                let mut acc = String::new();
                for p in parts {
                    if let Some(s) = p.as_str() {
                        if !acc.is_empty() {
                            acc.push('\n');
                        }
                        acc.push_str(s);
                        continue;
                    }
                    if let Some(t) = p.get("text").and_then(|x| x.as_str()) {
                        if !acc.is_empty() {
                            acc.push('\n');
                        }
                        acc.push_str(t);
                    }
                }
                acc
            }
            Value::Null => String::new(),
            _ => String::new(),
        }
    }

    fn build_options(request: &CompletionRequest) -> Value {
        let mut o = json!({});
        if let Some(t) = request.temperature {
            o.as_object_mut()
                .unwrap()
                .insert("temperature".into(), json!(t));
        }
        if let Some(mt) = request.max_tokens {
            let capped = mt.min(OLLAMA_NUM_PREDICT_CAP).max(1);
            o.as_object_mut()
                .unwrap()
                .insert("num_predict".into(), json!(capped));
        }
        o
    }
}

#[async_trait]
impl LLMProviderEngine for OllamaProvider {
    fn provider_id(&self) -> &'static str {
        if self.bearer_token.is_some() {
            "ollama_cloud"
        } else {
            "ollama"
        }
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            provider_id: self.provider_id().to_string(),
            model_id: self.model.clone(),
            context_window_tokens: Some(DEFAULT_OLLAMA_CTX),
        }
    }

    async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionResponse, ProviderError> {
        let mut body = json!({
            "model": self.model,
            "messages": Self::build_messages(request),
            "stream": false,
            "options": Self::build_options(request),
        });
        Self::attach_tools(&mut body, request.tools.as_ref());
        let res = self
            .authorized(self.client.post(self.chat_url()).json(&body))
            .timeout(Duration::from_secs(300))
            .send()
            .await?;
        let res = ok_or_api_error(res, self.cloud_model()).await?;

        let v: Value = res.json().await?;
        if let Some(err) = v["error"].as_str() {
            return Err(ProviderError::Api(err.to_string()));
        }
        let content = Self::stringify_message_content(&v["message"]["content"]);

        let mut tool_calls = Vec::new();
        if let Some(tc) = v["message"]["tool_calls"].as_array() {
            for (i, t) in tc.iter().enumerate() {
                let id = t["id"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .unwrap_or_else(|| format!("ollama_tool_{i}"));
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
            finish_reason: v["done"]
                .as_bool()
                .and_then(|d| d.then_some("stop".to_string())),
            usage: None,
        })
    }

    async fn stream(
        &self,
        request: &CompletionRequest,
        tx: tokio::sync::mpsc::Sender<Result<StreamChunk, ProviderError>>,
    ) -> Result<(), ProviderError> {
        let mut body = json!({
            "model": self.model,
            "messages": Self::build_messages(request),
            "stream": true,
            "options": Self::build_options(request),
        });
        Self::attach_tools(&mut body, request.tools.as_ref());
        let res = self
            .authorized(self.client.post(self.chat_url()).json(&body))
            .timeout(Duration::from_secs(300))
            .send()
            .await?;
        let res = ok_or_api_error(res, self.cloud_model()).await?;

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

// --- Model catalogs ----------------------------------------------------------

/// How many `/api/show` probes run at once while building a catalog.
const SHOW_CONCURRENCY: usize = 4;

async fn fetch_model_tags(
    http: &reqwest::Client,
    base: &str,
    token: Option<&str>,
) -> Result<Vec<String>, ProviderError> {
    let url = format!("{}/api/tags", base.trim_end_matches('/'));
    let mut req = http.get(&url).timeout(Duration::from_secs(45));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t.trim()));
    }
    // Listing tags is not tied to one selected model, so retirement guidance
    // cannot name a model here.
    let res = ok_or_api_error(req.send().await?, None).await?;
    let v: Value = res.json().await?;
    if let Some(msg) = v["error"].as_str() {
        return Err(ProviderError::Api(msg.to_string()));
    }
    let mut names = Vec::new();
    if let Some(models) = v["models"].as_array() {
        for m in models {
            if let Some(n) = m["name"].as_str() {
                names.push(n.to_string());
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// Capabilities reported by `POST {base}/api/show` (`completion`, `tools`, `vision`, …).
/// `None` means the probe failed or the field was absent.
async fn fetch_model_capabilities(
    http: &reqwest::Client,
    base: &str,
    model: &str,
    token: Option<&str>,
) -> Option<Vec<String>> {
    let url = format!("{}/api/show", base.trim_end_matches('/'));
    let mut req = http
        .post(&url)
        .json(&json!({ "model": model }))
        .timeout(Duration::from_secs(30));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {}", t.trim()));
    }
    let res = req.send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let v: Value = res.json().await.ok()?;
    let caps: Vec<String> = v["capabilities"]
        .as_array()?
        .iter()
        .filter_map(|c| c.as_str())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if caps.is_empty() {
        None
    } else {
        Some(caps)
    }
}

/// Local models with no `capabilities` (older Ollama builds): drop the obvious non-chat ones.
fn local_name_looks_like_chat_model(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    !(n.contains("embed") || n.contains("rerank") || n.contains("bge") || n.contains("minilm"))
}

fn name_looks_vision_capable(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("llava")
        || n.contains("vision")
        || n.contains("bakllava")
        || n.contains("moondream")
        || n.contains("minicpm-v")
        || n.contains("-vl")
        || n.contains("_vl")
}

async fn build_ollama_catalog(
    http: &reqwest::Client,
    base: &str,
    token: Option<&str>,
    local: bool,
) -> Result<Vec<ModelCatalogEntry>, ProviderError> {
    let names = fetch_model_tags(http, base, token).await?;
    let probes = names.into_iter().map(|name| async move {
        let caps = fetch_model_capabilities(http, base, &name, token).await;
        (name, caps)
    });
    let probed: Vec<(String, Option<Vec<String>>)> = futures_util::stream::iter(probes)
        .buffer_unordered(SHOW_CONCURRENCY)
        .collect()
        .await;

    let mut entries: Vec<ModelCatalogEntry> = Vec::new();
    for (name, caps) in probed {
        let entry = match caps {
            Some(caps) => {
                let usable = caps.iter().any(|c| c == "completion")
                    && caps.iter().any(|c| c == "tools");
                if !usable {
                    continue;
                }
                ModelCatalogEntry {
                    supports_vision: caps.iter().any(|c| c == "vision"),
                    label: name.clone(),
                    id: name,
                    supports_tools: true,
                    context_length: None,
                    is_free: local,
                }
            }
            // Cloud always reports capabilities; a missing answer there means "don't offer it".
            None if !local || !local_name_looks_like_chat_model(&name) => continue,
            None => ModelCatalogEntry {
                supports_vision: name_looks_vision_capable(&name),
                label: name.clone(),
                id: name,
                supports_tools: true,
                context_length: None,
                is_free: true,
            },
        };
        entries.push(entry);
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    entries.dedup_by(|a, b| a.id == b.id);
    Ok(entries)
}

/// Tool-capable models on Ollama Cloud (`https://ollama.com`) using the encrypted `ollama` API key.
pub async fn fetch_ollama_cloud_model_tags(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Vec<ModelCatalogEntry>, ProviderError> {
    let token = settings
        .decrypt_api_key("ollama")?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ProviderError::MissingApiKey("ollama"))?;
    build_ollama_catalog(http, "https://ollama.com", Some(token.trim()), false).await
}

/// Tool-capable models pulled locally (`{base}/api/tags`, no API key).
pub async fn fetch_ollama_local_model_tags(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Vec<ModelCatalogEntry>, ProviderError> {
    let base = settings.ollama_base_url();
    build_ollama_catalog(http, base.trim_end_matches('/'), None, true).await
}

#[cfg(test)]
mod tests {
    use super::{local_name_looks_like_chat_model, name_looks_vision_capable, retirement_hint};
    use reqwest::StatusCode;

    #[test]
    fn explains_retired_cloud_models() {
        let hint = retirement_hint(StatusCode::NOT_FOUND, "model not found", Some("kimi-k2.5"))
            .expect("hint for a missing cloud model");
        assert!(hint.contains("kimi-k2.5"));
        assert!(hint.contains("Refresh Models"));
    }

    #[test]
    fn leaves_unrelated_cloud_failures_alone() {
        // Auth and rate-limit problems are not retirements; don't misdirect the user.
        assert!(retirement_hint(StatusCode::UNAUTHORIZED, "invalid key", Some("kimi-k2.6")).is_none());
        assert!(
            retirement_hint(StatusCode::TOO_MANY_REQUESTS, "slow down", Some("kimi-k2.6")).is_none()
        );
        // Local Ollama has no cloud model to blame.
        assert!(retirement_hint(StatusCode::NOT_FOUND, "model not found", None).is_none());
    }

    #[test]
    fn drops_embedding_only_local_models_without_capabilities() {
        assert!(!local_name_looks_like_chat_model("nomic-embed-text:latest"));
        assert!(!local_name_looks_like_chat_model("bge-m3"));
        assert!(local_name_looks_like_chat_model("llama3.2:latest"));
    }

    #[test]
    fn detects_vision_models_by_name() {
        assert!(name_looks_vision_capable("llama3.2-vision:11b"));
        assert!(name_looks_vision_capable("qwen2.5-vl:7b"));
        assert!(!name_looks_vision_capable("llama3.2:latest"));
    }
}
