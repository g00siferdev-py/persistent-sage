//! Google Gemini `generateContent` adapter.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::engine::LLMProviderEngine;
use super::error::ProviderError;
use super::types::{
    ChatTurn, CompletionRequest, CompletionResponse, ModelInfo, StreamChunk, TokenUsage,
};
use crate::settings::SettingsManager;

const GEMINI_CTX: u32 = 1_000_000;
const LEADING_MODEL_USER_NOTE: &str =
    "(No user message was stored before the assistant reply that follows.)";

pub struct GeminiProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
    base_url: String,
}

impl GeminiProvider {
    pub fn from_settings(
        settings: &SettingsManager,
        http: &reqwest::Client,
    ) -> Result<Self, ProviderError> {
        let api_key = settings
            .decrypt_api_key("gemini")?
            .filter(|s| !s.trim().is_empty())
            .ok_or(ProviderError::MissingApiKey("gemini"))?;
        Ok(Self {
            client: http.clone(),
            api_key,
            model: settings.gemini_model(),
            base_url: settings.gemini_base_url().trim_end_matches('/').to_string(),
        })
    }

    fn endpoint(&self, method: &str) -> String {
        let model = self
            .model
            .trim()
            .strip_prefix("models/")
            .unwrap_or(self.model.trim());
        format!(
            "{}/models/{}:{method}?key={}",
            self.base_url, model, self.api_key
        )
    }

    fn split_system_and_contents(messages: &[ChatTurn]) -> (Option<String>, Vec<Value>) {
        let mut system = Vec::new();
        let mut contents = Vec::new();
        for msg in messages {
            match msg.role.to_lowercase().as_str() {
                "system" => {
                    if !msg.content.trim().is_empty() {
                        system.push(msg.content.clone());
                    }
                }
                "assistant" => {
                    if !msg.content.trim().is_empty() {
                        contents.push(json!({
                            "role": "model",
                            "parts": [{ "text": msg.content }]
                        }));
                    }
                }
                "user" | "tool" => {
                    if !msg.content.trim().is_empty() {
                        contents.push(json!({
                            "role": "user",
                            "parts": [{ "text": msg.content }]
                        }));
                    }
                }
                _ => {}
            }
        }
        let system = (!system.is_empty()).then(|| system.join("\n\n"));
        (system, Self::coalesce_alternating_contents(contents))
    }

    /// Gemini `generateContent` rejects a request unless `user` and `model` alternate
    /// and the first content is `user`. The same stored-transcript gaps that break
    /// Claude (Pulse, form, and email-agent replies, a failed send, or a 32-message
    /// window that opens on an assistant turn) break Gemini too.
    fn coalesce_alternating_contents(contents: Vec<Value>) -> Vec<Value> {
        let mut out: Vec<Value> = Vec::with_capacity(contents.len());
        for msg in contents {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if let Some(last) = out.last_mut() {
                let last_role = last.get("role").and_then(|r| r.as_str()).unwrap_or("");
                if !role.is_empty() && role == last_role {
                    let mut parts = last
                        .get("parts")
                        .and_then(|p| p.as_array())
                        .cloned()
                        .unwrap_or_default();
                    if let Some(more) = msg.get("parts").and_then(|p| p.as_array()) {
                        parts.extend(more.iter().cloned());
                    }
                    last["parts"] = Value::Array(parts);
                    continue;
                }
            }
            out.push(msg);
        }
        if out.first().and_then(|m| m["role"].as_str()) == Some("model") {
            out.insert(
                0,
                json!({
                    "role": "user",
                    "parts": [{ "text": LEADING_MODEL_USER_NOTE }]
                }),
            );
        }
        out
    }

    fn thinking_budget(effort: Option<&str>) -> Option<i32> {
        match effort.unwrap_or("medium").trim().to_lowercase().as_str() {
            "low" => Some(1024),
            "medium" => Some(4096),
            "high" => Some(8192),
            _ => None,
        }
    }

    fn build_body(&self, request: &CompletionRequest) -> Value {
        let (system, contents) = Self::split_system_and_contents(&request.messages);
        let mut body = json!({ "contents": contents });
        let obj = body.as_object_mut().unwrap();
        if let Some(system) = system {
            obj.insert(
                "systemInstruction".into(),
                json!({ "parts": [{ "text": system }] }),
            );
        }

        let mut generation = serde_json::Map::new();
        if let Some(t) = request.temperature {
            generation.insert("temperature".into(), json!(t));
        }
        if let Some(max) = request.max_tokens {
            generation.insert("maxOutputTokens".into(), json!(max.clamp(1, 65_536)));
        }
        let model_supports_thinking = self.model.to_lowercase().contains("2.5");
        if model_supports_thinking {
            if let Some(budget) = Self::thinking_budget(request.thinking_effort.as_deref()) {
                generation.insert(
                    "thinkingConfig".into(),
                    json!({ "thinkingBudget": budget, "includeThoughts": false }),
                );
            }
        }
        if !generation.is_empty() {
            obj.insert("generationConfig".into(), Value::Object(generation));
        }
        body
    }

    fn parse_response(v: &Value) -> Result<CompletionResponse, ProviderError> {
        if let Some(msg) = v["error"]["message"].as_str() {
            return Err(ProviderError::Api(msg.to_string()));
        }
        let mut text = String::new();
        if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
            for part in parts {
                if let Some(t) = part["text"].as_str() {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(t);
                }
            }
        }
        let finish_reason = v["candidates"][0]["finishReason"]
            .as_str()
            .map(String::from);
        let usage = (!v["usageMetadata"].is_null()).then(|| TokenUsage {
            prompt_tokens: v["usageMetadata"]["promptTokenCount"]
                .as_u64()
                .map(|x| x as u32),
            completion_tokens: v["usageMetadata"]["candidatesTokenCount"]
                .as_u64()
                .map(|x| x as u32),
        });
        Ok(CompletionResponse {
            content: text,
            tool_calls: Vec::new(),
            finish_reason,
            usage,
        })
    }
}

#[async_trait]
impl LLMProviderEngine for GeminiProvider {
    fn provider_id(&self) -> &'static str {
        "gemini"
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            provider_id: "gemini".into(),
            model_id: self.model.clone(),
            context_window_tokens: Some(GEMINI_CTX),
        }
    }

    async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionResponse, ProviderError> {
        let body = self.build_body(request);
        let res = self
            .client
            .post(self.endpoint("generateContent"))
            .json(&body)
            .timeout(Duration::from_secs(180))
            .send()
            .await?
            .error_for_status()?;
        let v: Value = res.json().await?;
        Self::parse_response(&v)
    }

    async fn stream(
        &self,
        request: &CompletionRequest,
        tx: tokio::sync::mpsc::Sender<Result<StreamChunk, ProviderError>>,
    ) -> Result<(), ProviderError> {
        // Gemini streaming uses a separate SSE shape. Keep the app behavior reliable by
        // aggregating one completion and emitting it as a single stream chunk.
        let response = self.complete(request).await?;
        if !response.content.is_empty() {
            let _ = tx
                .send(Ok(StreamChunk {
                    delta: response.content,
                    done: false,
                }))
                .await;
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

pub async fn fetch_gemini_model_ids(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Vec<String>, ProviderError> {
    let api_key = settings
        .decrypt_api_key("gemini")?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ProviderError::MissingApiKey("gemini"))?;
    let base = settings.gemini_base_url();
    let url = format!("{}/models?key={}", base.trim_end_matches('/'), api_key);
    let res = http
        .get(url)
        .timeout(Duration::from_secs(45))
        .send()
        .await?
        .error_for_status()?;
    let v: Value = res.json().await?;
    if let Some(msg) = v["error"]["message"].as_str() {
        return Err(ProviderError::Api(msg.to_string()));
    }
    let mut names = Vec::new();
    if let Some(models) = v["models"].as_array() {
        for m in models {
            let supports_generate = m["supportedGenerationMethods"]
                .as_array()
                .map(|arr| arr.iter().any(|x| x.as_str() == Some("generateContent")))
                .unwrap_or(true);
            if supports_generate {
                if let Some(name) = m["name"].as_str() {
                    names.push(name.strip_prefix("models/").unwrap_or(name).to_string());
                }
            }
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::ChatTurn;

    fn contents_of(turns: Vec<ChatTurn>) -> Vec<Value> {
        let (_, contents) = GeminiProvider::split_system_and_contents(&turns);
        contents
    }

    #[test]
    fn merges_consecutive_model_turns() {
        let contents = contents_of(vec![
            ChatTurn::text("system", "persona"),
            ChatTurn::text("user", "draft a budget"),
            ChatTurn::text("assistant", "Here is the form."),
            ChatTurn::text("assistant", "Updated the living document."),
            ChatTurn::text("user", "tighten rent"),
        ]);
        assert_eq!(contents.len(), 3);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[0]["parts"][0]["text"], "draft a budget");
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(contents[1]["parts"][0]["text"], "Here is the form.");
        assert_eq!(
            contents[1]["parts"][1]["text"],
            "Updated the living document."
        );
        assert_eq!(contents[2]["parts"][0]["text"], "tighten rent");
    }

    #[test]
    fn prefixes_user_when_context_window_opens_on_model() {
        let contents = contents_of(vec![
            ChatTurn::text("assistant", "Earlier reply that the window kept."),
            ChatTurn::text("user", "what did we decide?"),
        ]);
        assert_eq!(contents.len(), 3);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[0]["parts"][0]["text"], LEADING_MODEL_USER_NOTE);
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(
            contents[1]["parts"][0]["text"],
            "Earlier reply that the window kept."
        );
        assert_eq!(contents[2]["role"], "user");
        assert_eq!(contents[2]["parts"][0]["text"], "what did we decide?");
    }

    #[test]
    fn merges_consecutive_user_turns_after_a_failed_send() {
        let contents = contents_of(vec![
            ChatTurn::text("user", "first try"),
            ChatTurn::text("user", "second try"),
        ]);
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[0]["parts"][0]["text"], "first try");
        assert_eq!(contents[0]["parts"][1]["text"], "second try");
    }

    #[test]
    fn leaves_alternating_transcript_unchanged() {
        let contents = contents_of(vec![
            ChatTurn::text("user", "hello"),
            ChatTurn::text("assistant", "hi"),
        ]);
        assert_eq!(contents.len(), 2);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[0]["parts"].as_array().map(|p| p.len()), Some(1));
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(contents[1]["parts"][0]["text"], "hi");
    }
}
