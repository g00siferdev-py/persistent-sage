//! OpenAI Chat Completions (`/v1/chat/completions`) with SSE streaming.

use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};

use super::engine::LLMProviderEngine;
use super::error::ProviderError;
use super::types::{
    CompletionRequest, CompletionResponse, ModelCatalogEntry, ModelInfo, StreamChunk, TokenUsage,
    ToolCall,
};
use crate::settings::SettingsManager;

/// Default context sizes for UI / budgeting (approximate).
const GPT4O_MINI_CTX: u32 = 128_000;
const GPT4O_CTX: u32 = 128_000;

/// OpenRouter attributes requests to the app on its dashboards/leaderboards.
const OPENROUTER_REFERER: &str = "https://persistentsage.com";
const OPENROUTER_TITLE: &str = "Persistent Sage";

/// Adds the OpenRouter attribution headers when talking to `openrouter.ai`.
fn with_openrouter_headers(
    req: reqwest::RequestBuilder,
    is_openrouter: bool,
) -> reqwest::RequestBuilder {
    if is_openrouter {
        req.header("HTTP-Referer", OPENROUTER_REFERER)
            .header("X-Title", OPENROUTER_TITLE)
    } else {
        req
    }
}

pub struct OpenAIProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
    provider_id: &'static str,
}

impl OpenAIProvider {
    pub fn from_settings(
        settings: &SettingsManager,
        http: &reqwest::Client,
    ) -> Result<Self, ProviderError> {
        let api_key = settings
            .decrypt_api_key("openai")?
            .filter(|s| !s.trim().is_empty())
            .ok_or(ProviderError::MissingApiKey("openai"))?;
        let model = settings.openai_model();
        let base_url = settings.openai_base_url().trim_end_matches('/').to_string();
        Ok(Self {
            client: http.clone(),
            api_key,
            model,
            base_url,
            provider_id: "openai",
        })
    }

    pub fn from_xai_settings(
        settings: &SettingsManager,
        http: &reqwest::Client,
    ) -> Result<Self, ProviderError> {
        let api_key = settings
            .decrypt_api_key("xai")?
            .filter(|s| !s.trim().is_empty())
            .ok_or(ProviderError::MissingApiKey("xai"))?;
        Ok(Self {
            client: http.clone(),
            api_key,
            model: settings.xai_model(),
            base_url: settings.xai_base_url().trim_end_matches('/').to_string(),
            provider_id: "xai",
        })
    }

    pub fn from_openrouter_settings(
        settings: &SettingsManager,
        http: &reqwest::Client,
    ) -> Result<Self, ProviderError> {
        Self::from_openrouter_with_model(settings, http, None)
    }

    /// OpenRouter engine with an optional model override (subagents / one-off missions).
    pub fn from_openrouter_with_model(
        settings: &SettingsManager,
        http: &reqwest::Client,
        model_override: Option<&str>,
    ) -> Result<Self, ProviderError> {
        let api_key = settings
            .decrypt_api_key("openrouter")?
            .filter(|s| !s.trim().is_empty())
            .ok_or(ProviderError::MissingApiKey("openrouter"))?;
        let model = model_override
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| settings.openrouter_model());
        Ok(Self {
            client: http.clone(),
            api_key,
            model,
            base_url: settings
                .openrouter_base_url()
                .trim_end_matches('/')
                .to_string(),
            provider_id: "openrouter",
        })
    }

    fn is_openrouter(&self) -> bool {
        self.provider_id == "openrouter"
    }

    fn context_for_model(model: &str) -> Option<u32> {
        let m = model.to_lowercase();
        if m.contains("gpt-4o") {
            Some(GPT4O_CTX)
        } else if m.contains("gpt-4") || m.contains("gpt-3.5") {
            Some(GPT4O_MINI_CTX)
        } else {
            Some(128_000)
        }
    }

    /// Chat Completions `max_tokens` is an output cap; never send values the API rejects.
    fn clamp_completion_tokens_for_model(model: &str, requested: u32) -> u32 {
        let m = model.to_lowercase();
        let cap = if m.contains("gpt-3.5") && !m.contains("16k") && !m.contains("1106") {
            4096u32
        } else if m.contains("gpt-4") || m.contains("gpt-3.5") || m.contains("gpt-4o") {
            16_384
        } else {
            16_384
        };
        requested.min(cap).max(1)
    }

    fn build_body(&self, request: &CompletionRequest, stream: bool) -> Value {
        let mut body = json!({
            "model": self.model,
            "messages": request.messages.iter().map(|m| {
                if let Some(ref raw) = m.openai_message {
                    raw.clone()
                } else {
                    json!({"role": &m.role, "content": &m.content})
                }
            }).collect::<Vec<_>>(),
            "stream": stream,
        });
        if let Some(t) = request.temperature {
            body.as_object_mut()
                .unwrap()
                .insert("temperature".into(), json!(t));
        }
        if let Some(mt) = request.max_tokens {
            let capped = Self::clamp_completion_tokens_for_model(&self.model, mt);
            body.as_object_mut()
                .unwrap()
                .insert("max_tokens".into(), json!(capped));
        }
        if let Some(effort) = request.thinking_effort.as_deref() {
            let effort = effort.trim().to_lowercase();
            let m = self.model.to_lowercase();
            let supports_reasoning_effort = self.provider_id == "xai"
                || m.starts_with("o1")
                || m.starts_with("o3")
                || m.starts_with("o4")
                || m.contains("reasoning");
            if supports_reasoning_effort && matches!(effort.as_str(), "low" | "medium" | "high") {
                body.as_object_mut()
                    .unwrap()
                    .insert("reasoning_effort".into(), json!(effort));
            }
        }
        if let Some(ref tools) = request.tools {
            if !tools.is_empty() {
                let tjson: Vec<Value> = tools
                    .iter()
                    .map(|t| {
                        json!({
                            "type": "function",
                            "function": {
                                "name": t.name,
                                "description": t.description,
                                "parameters": t.parameters,
                            }
                        })
                    })
                    .collect();
                body.as_object_mut()
                    .unwrap()
                    .insert("tools".into(), json!(tjson));
            }
        }
        body
    }

    /// Chat Completions `message.content` may be a string or a parts array (newer models / multimodal).
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
                    match p.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(t) = p.get("text").and_then(|x| x.as_str()) {
                                if !acc.is_empty() {
                                    acc.push('\n');
                                }
                                acc.push_str(t);
                            }
                        }
                        Some("refusal") => {
                            if let Some(t) = p.get("refusal").and_then(|x| x.as_str()) {
                                if !acc.is_empty() {
                                    acc.push('\n');
                                }
                                acc.push_str(t);
                            }
                        }
                        _ => {}
                    }
                }
                acc
            }
            Value::Null => String::new(),
            _ => String::new(),
        }
    }

    fn parse_message(v: &Value) -> Result<(String, Vec<ToolCall>, Option<String>), ProviderError> {
        let choice = &v["choices"][0];
        let msg = &choice["message"];
        let mut content = Self::stringify_message_content(&msg["content"]);
        if content.is_empty() {
            if let Some(r) = msg["refusal"].as_str() {
                content = r.to_string();
            }
        }
        let finish = choice["finish_reason"].as_str().map(String::from);

        let mut tool_calls = Vec::new();
        if let Some(arr) = msg["tool_calls"].as_array() {
            for tc in arr {
                let id = tc["id"].as_str().unwrap_or("").to_string();
                let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                let args = tc["function"]["arguments"]
                    .as_str()
                    .unwrap_or("{}")
                    .to_string();
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments_json: args,
                });
            }
        }
        Ok((content, tool_calls, finish))
    }

    fn parse_usage(v: &Value) -> Option<TokenUsage> {
        let u = &v["usage"];
        if u.is_null() {
            return None;
        }
        Some(TokenUsage {
            prompt_tokens: u["prompt_tokens"].as_u64().map(|x| x as u32),
            completion_tokens: u["completion_tokens"].as_u64().map(|x| x as u32),
        })
    }
}

#[async_trait]
impl LLMProviderEngine for OpenAIProvider {
    fn provider_id(&self) -> &'static str {
        self.provider_id
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            provider_id: self.provider_id.to_string(),
            model_id: self.model.clone(),
            context_window_tokens: Self::context_for_model(&self.model),
        }
    }

    async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionResponse, ProviderError> {
        let url = format!("{}/chat/completions", self.base_url);
        let body = self.build_body(request, false);
        let res = with_openrouter_headers(self.client.post(&url), self.is_openrouter())
            .bearer_auth(&self.api_key)
            .json(&body)
            .timeout(Duration::from_secs(120))
            .send()
            .await?
            .error_for_status()?;

        let v: Value = res.json().await?;
        if let Some(err) = v["error"]["message"].as_str() {
            return Err(ProviderError::Api(err.to_string()));
        }
        let (content, tool_calls, finish_reason) = Self::parse_message(&v)?;
        Ok(CompletionResponse {
            content,
            tool_calls,
            finish_reason,
            usage: Self::parse_usage(&v),
        })
    }

    async fn stream(
        &self,
        request: &CompletionRequest,
        tx: tokio::sync::mpsc::Sender<Result<StreamChunk, ProviderError>>,
    ) -> Result<(), ProviderError> {
        let url = format!("{}/chat/completions", self.base_url);
        let body = self.build_body(request, true);
        let res = with_openrouter_headers(self.client.post(&url), self.is_openrouter())
            .bearer_auth(&self.api_key)
            .json(&body)
            .timeout(Duration::from_secs(120))
            .send()
            .await?
            .error_for_status()?;

        let mut stream = res.bytes_stream();
        let mut line_buf = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| ProviderError::Http(e))?;
            let s = String::from_utf8_lossy(&chunk);
            line_buf.push_str(&s);

            while let Some(pos) = line_buf.find('\n') {
                let line = line_buf[..pos].trim().to_string();
                line_buf = line_buf[pos + 1..].to_string();
                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                if let Some(data) = line.strip_prefix("data:").map(str::trim) {
                    if data == "[DONE]" {
                        let _ = tx
                            .send(Ok(StreamChunk {
                                delta: String::new(),
                                done: true,
                            }))
                            .await;
                        return Ok(());
                    }
                    let v: Value = match serde_json::from_str(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if let Some(err) = v["error"]["message"].as_str() {
                        let _ = tx.send(Err(ProviderError::Api(err.to_string()))).await;
                        return Ok(());
                    }
                    let delta = v["choices"][0]["delta"]["content"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    if !delta.is_empty() {
                        let _ = tx.send(Ok(StreamChunk { delta, done: false })).await;
                    }
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

/// Substrings that mark a model as something other than a text chat model.
const NON_CHAT_MARKERS: &[&str] = &[
    "embedding",
    "embed",
    "whisper",
    "tts",
    "realtime",
    "moderation",
    "dall-e",
    "dall_e",
    "gpt-image",
    "image-1",
    "sora",
    "audio",
    "transcribe",
    "speech",
    "video",
    "text-similarity",
    "text-search",
    "rerank",
    "guard",
];

/// Legacy completion-only families that are never valid on `/chat/completions`.
const LEGACY_COMPLETION_FAMILIES: &[&str] = &["ada", "babbage", "curie", "davinci"];

fn model_id_is_non_chat(lowered: &str) -> bool {
    if NON_CHAT_MARKERS.iter().any(|m| lowered.contains(m)) {
        return true;
    }
    lowered
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|seg| LEGACY_COMPLETION_FAMILIES.contains(&seg))
}

/// Whether an OpenAI model id looks like a chat model usable with `/chat/completions` + tools.
#[must_use]
pub fn openai_model_is_compatible_chat(id: &str) -> bool {
    let lowered = id.trim().to_ascii_lowercase();
    if lowered.is_empty() || model_id_is_non_chat(&lowered) {
        return false;
    }
    // `gpt-3.5-turbo-instruct` is a completions-only sibling of the chat models.
    if lowered.contains("instruct") {
        return false;
    }
    lowered.starts_with("gpt-")
        || lowered.starts_with("chatgpt")
        || lowered.starts_with("o1")
        || lowered.starts_with("o3")
        || lowered.starts_with("o4")
        || lowered.contains("gpt")
}

/// xAI ships a small catalog; keep everything that is not an image/audio endpoint.
#[must_use]
pub fn xai_model_is_compatible_chat(id: &str) -> bool {
    let lowered = id.trim().to_ascii_lowercase();
    !lowered.is_empty() && !model_id_is_non_chat(&lowered)
}

fn openai_model_supports_vision(id: &str) -> bool {
    let m = id.to_ascii_lowercase();
    m.contains("gpt-4o")
        || m.contains("gpt-4.1")
        || m.contains("gpt-5")
        || m.contains("chatgpt-4o")
        || (m.contains("gpt-4") && (m.contains("turbo") || m.contains("vision")))
        || m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4")
}

fn xai_model_supports_vision(id: &str) -> bool {
    let m = id.to_ascii_lowercase();
    m.contains("vision") || m.contains("grok-4") || m.contains("grok-3")
}

async fn fetch_openai_style_model_ids(
    http: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, ProviderError> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let res = http
        .get(&url)
        .bearer_auth(api_key.trim())
        .timeout(Duration::from_secs(45))
        .send()
        .await?
        .error_for_status()?;
    let v: Value = res.json().await?;
    if let Some(msg) = v["error"]["message"].as_str() {
        return Err(ProviderError::Api(msg.to_string()));
    }
    let mut ids = Vec::new();
    if let Some(data) = v["data"].as_array() {
        for m in data {
            if let Some(id) = m["id"].as_str() {
                ids.push(id.to_string());
            }
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Chat-capable models from OpenAI-compatible `GET {base}/models` (requires saved OpenAI API key).
pub async fn fetch_openai_model_ids(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Vec<ModelCatalogEntry>, ProviderError> {
    let api_key = settings
        .decrypt_api_key("openai")?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ProviderError::MissingApiKey("openai"))?;
    let ids = fetch_openai_style_model_ids(http, &settings.openai_base_url(), &api_key).await?;
    Ok(ids
        .into_iter()
        .filter(|id| openai_model_is_compatible_chat(id))
        .map(|id| ModelCatalogEntry {
            supports_tools: true,
            supports_vision: openai_model_supports_vision(&id),
            context_length: None,
            is_free: false,
            label: id.clone(),
            id,
        })
        .collect())
}

pub async fn fetch_xai_model_ids(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Vec<ModelCatalogEntry>, ProviderError> {
    let api_key = settings
        .decrypt_api_key("xai")?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ProviderError::MissingApiKey("xai"))?;
    let ids = fetch_openai_style_model_ids(http, &settings.xai_base_url(), &api_key).await?;
    Ok(ids
        .into_iter()
        .filter(|id| xai_model_is_compatible_chat(id))
        .map(|id| ModelCatalogEntry {
            supports_tools: true,
            supports_vision: xai_model_supports_vision(&id),
            context_length: None,
            is_free: false,
            label: id.clone(),
            id,
        })
        .collect())
}

fn json_strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(items) => items
            .iter()
            .filter_map(|i| i.as_str())
            .map(|s| s.to_ascii_lowercase())
            .collect(),
        Value::String(s) => vec![s.to_ascii_lowercase()],
        _ => Vec::new(),
    }
}

fn pricing_is_zero(pricing: &Value, key: &str) -> bool {
    match &pricing[key] {
        Value::String(s) => s.trim().parse::<f64>().map(|n| n == 0.0).unwrap_or(false),
        Value::Number(n) => n.as_f64().map(|n| n == 0.0).unwrap_or(false),
        _ => false,
    }
}

/// `true` when `raw` is an ISO date/timestamp strictly before `today` (`YYYY-MM-DD`).
/// Unparseable values are treated as "not expired" so we never hide a usable model.
fn is_expired_on(raw: &str, today: &str) -> bool {
    let date = raw.trim();
    if date.len() < 10 {
        return false;
    }
    let (day, _) = date.split_at(10);
    if !day
        .as_bytes()
        .iter()
        .enumerate()
        .all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() })
    {
        return false;
    }
    day < today
}

/// Maps one OpenRouter `/models` entry to a catalog entry, or `None` when it is filtered out.
#[must_use]
pub fn openrouter_entry_from_value(v: &Value, today: &str) -> Option<ModelCatalogEntry> {
    let id = v["id"]
        .as_str()
        .or_else(|| v["canonical_slug"].as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;

    if let Some(exp) = v["expiration_date"].as_str() {
        if is_expired_on(exp, today) {
            return None;
        }
    }

    let supported: Vec<String> = {
        let top = json_strings(&v["supported_parameters"]);
        if top.is_empty() {
            json_strings(&v["architecture"]["supported_parameters"])
        } else {
            top
        }
    };
    if !supported.iter().any(|p| p == "tools") {
        return None;
    }

    let architecture = &v["architecture"];
    let modality = architecture["modality"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let output_modalities = json_strings(&architecture["output_modalities"]);
    let outputs_text = if output_modalities.is_empty() {
        // `text+image->text` style strings: only the right-hand side is output.
        modality.is_empty()
            || modality
                .rsplit("->")
                .next()
                .map(|out| out.contains("text"))
                .unwrap_or(true)
    } else {
        output_modalities.iter().any(|m| m.contains("text"))
    };
    if !outputs_text {
        return None;
    }

    let input_modalities = json_strings(&architecture["input_modalities"]);
    let supports_vision = input_modalities.iter().any(|m| m.contains("image"))
        || modality
            .split("->")
            .next()
            .map(|inp| inp.contains("image"))
            .unwrap_or(false);

    let pricing = &v["pricing"];
    let is_free = id.to_ascii_lowercase().ends_with(":free")
        || (pricing_is_zero(pricing, "prompt") && pricing_is_zero(pricing, "completion"));

    let context_length = v["context_length"]
        .as_u64()
        .or_else(|| v["top_provider"]["context_length"].as_u64())
        .and_then(|n| u32::try_from(n).ok());

    let label = v["name"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(id)
        .to_string();

    Some(ModelCatalogEntry {
        id: id.to_string(),
        label,
        supports_tools: true,
        supports_vision,
        context_length,
        is_free,
    })
}

/// Tool-capable text models available to the signed-in OpenRouter account.
pub async fn fetch_openrouter_model_catalog(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Vec<ModelCatalogEntry>, ProviderError> {
    let api_key = settings
        .decrypt_api_key("openrouter")?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ProviderError::MissingApiKey("openrouter"))?;
    let base = settings.openrouter_base_url();
    let base = base.trim_end_matches('/');

    let mut value: Option<Value> = None;
    // `/models/user` reflects the account's provider preferences; older keys only have `/models`.
    for url in [format!("{base}/models/user"), format!("{base}/models")] {
        let res = with_openrouter_headers(http.get(&url), true)
            .bearer_auth(api_key.trim())
            .timeout(Duration::from_secs(45))
            .send()
            .await?;
        if !res.status().is_success() {
            if url.ends_with("/models/user") {
                continue;
            }
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            let body: String = body.chars().take(2000).collect();
            return Err(ProviderError::Api(format!("HTTP {status}: {body}")));
        }
        value = Some(res.json().await?);
        break;
    }
    let v = value.ok_or_else(|| ProviderError::Api("OpenRouter returned no model list".into()))?;
    if let Some(msg) = v["error"]["message"].as_str() {
        return Err(ProviderError::Api(msg.to_string()));
    }

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut entries: Vec<ModelCatalogEntry> = v["data"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| openrouter_entry_from_value(row, &today))
                .collect()
        })
        .unwrap_or_default();
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    entries.dedup_by(|a, b| a.id == b.id);
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_openai_chat_models_only() {
        for id in ["gpt-4o-mini", "gpt-4.1", "o3-mini", "chatgpt-4o-latest"] {
            assert!(openai_model_is_compatible_chat(id), "{id} should be kept");
        }
        for id in [
            "text-embedding-3-small",
            "whisper-1",
            "tts-1-hd",
            "dall-e-3",
            "gpt-image-1",
            "gpt-4o-realtime-preview",
            "gpt-4o-audio-preview",
            "omni-moderation-latest",
            "davinci-002",
            "babbage-002",
            "gpt-3.5-turbo-instruct",
            "sora-2",
        ] {
            assert!(!openai_model_is_compatible_chat(id), "{id} should be dropped");
        }
    }

    #[test]
    fn openrouter_entry_reads_capabilities() {
        let row = json!({
            "id": "anthropic/claude-3.5-sonnet",
            "name": "Anthropic: Claude 3.5 Sonnet",
            "context_length": 200000,
            "supported_parameters": ["tools", "temperature"],
            "architecture": {
                "modality": "text+image->text",
                "input_modalities": ["text", "image"],
                "output_modalities": ["text"]
            },
            "pricing": { "prompt": "0.000003", "completion": "0.000015" }
        });
        let entry = openrouter_entry_from_value(&row, "2026-07-30").expect("kept");
        assert_eq!(entry.id, "anthropic/claude-3.5-sonnet");
        assert_eq!(entry.label, "Anthropic: Claude 3.5 Sonnet");
        assert!(entry.supports_tools);
        assert!(entry.supports_vision);
        assert!(!entry.is_free);
        assert_eq!(entry.context_length, Some(200_000));
    }

    #[test]
    fn openrouter_entry_drops_toolless_and_expired() {
        let no_tools = json!({
            "id": "some/model",
            "supported_parameters": ["temperature"],
            "architecture": { "output_modalities": ["text"] }
        });
        assert!(openrouter_entry_from_value(&no_tools, "2026-07-30").is_none());

        let expired = json!({
            "id": "old/model",
            "expiration_date": "2026-01-01",
            "supported_parameters": ["tools"],
            "architecture": { "output_modalities": ["text"] }
        });
        assert!(openrouter_entry_from_value(&expired, "2026-07-30").is_none());

        let image_out = json!({
            "id": "some/image-gen",
            "supported_parameters": ["tools"],
            "architecture": { "output_modalities": ["image"] }
        });
        assert!(openrouter_entry_from_value(&image_out, "2026-07-30").is_none());
    }

    #[test]
    fn openrouter_entry_marks_free_models() {
        let free_suffix = json!({
            "id": "meta-llama/llama-3.3-70b-instruct:free",
            "supported_parameters": ["tools"],
            "architecture": { "output_modalities": ["text"] }
        });
        assert!(openrouter_entry_from_value(&free_suffix, "2026-07-30")
            .expect("kept")
            .is_free);

        let zero_priced = json!({
            "id": "vendor/model",
            "supported_parameters": ["tools"],
            "architecture": { "output_modalities": ["text"] },
            "pricing": { "prompt": "0", "completion": "0" }
        });
        assert!(openrouter_entry_from_value(&zero_priced, "2026-07-30")
            .expect("kept")
            .is_free);
    }
}

