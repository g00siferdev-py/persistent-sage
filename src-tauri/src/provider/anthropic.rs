//! Anthropic Messages API (`/v1/messages`) with SSE streaming and tool support.

use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::{json, Value};

use super::engine::LLMProviderEngine;
use super::error::ProviderError;
use super::types::{
    CompletionRequest, CompletionResponse, ModelInfo, StreamChunk, TokenUsage, ToolCall,
    ToolDefinition,
};
use crate::settings::SettingsManager;

const ANTHROPIC_API: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 8192;
const CLAUDE_CTX: u32 = 200_000;
const LEADING_ASSISTANT_USER_NOTE: &str =
    "(No user message was stored before the assistant reply that follows.)";

fn merge_message_content(left: &Value, right: &Value) -> Value {
    match (left, right) {
        (Value::String(a), Value::String(b)) => {
            if a.is_empty() {
                Value::String(b.clone())
            } else if b.is_empty() {
                Value::String(a.clone())
            } else {
                Value::String(format!("{a}\n\n{b}"))
            }
        }
        _ => {
            let mut blocks = content_as_blocks(left);
            blocks.extend(content_as_blocks(right));
            Value::Array(blocks)
        }
    }
}

fn content_as_blocks(content: &Value) -> Vec<Value> {
    match content {
        Value::String(s) => vec![json!({ "type": "text", "text": s })],
        Value::Array(arr) => arr.clone(),
        other => vec![json!({ "type": "text", "text": other.to_string() })],
    }
}

pub struct AnthropicProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl AnthropicProvider {
    pub fn from_settings(
        settings: &SettingsManager,
        http: &reqwest::Client,
    ) -> Result<Self, ProviderError> {
        let api_key = settings
            .decrypt_api_key("anthropic")?
            .filter(|s| !s.trim().is_empty())
            .ok_or(ProviderError::MissingApiKey("anthropic"))?;
        let model = settings.anthropic_model();
        Ok(Self {
            client: http.clone(),
            api_key,
            model,
        })
    }

    fn max_out_tokens(request: &CompletionRequest) -> u32 {
        request
            .max_tokens
            .unwrap_or(DEFAULT_MAX_TOKENS)
            .clamp(1, 128_000)
    }

    /// Split OpenAI-shaped transcript into Anthropic `system` + `messages` (no system role in messages).
    /// Turns with [`ChatTurn::anthropic_message`](super::types::ChatTurn::anthropic_message) are passed through verbatim.
    fn split_system_and_messages(request: &CompletionRequest) -> (Option<String>, Vec<Value>) {
        let mut system_parts: Vec<String> = Vec::new();
        let mut messages: Vec<Value> = Vec::new();
        for m in &request.messages {
            let role = m.role.to_lowercase();
            if role == "system" {
                if !m.content.trim().is_empty() {
                    system_parts.push(m.content.clone());
                }
                continue;
            }
            if let Some(ref raw) = m.anthropic_message {
                messages.push(raw.clone());
                continue;
            }
            if role == "user" || role == "assistant" {
                messages.push(json!({ "role": role, "content": m.content }));
            }
        }
        let system = if system_parts.is_empty() {
            None
        } else {
            Some(system_parts.join("\n\n"))
        };
        (system, Self::coalesce_alternating_messages(messages))
    }

    /// Anthropic rejects a request unless `user` and `assistant` alternate and the
    /// first message is `user`. Stored transcripts violate that after a Pulse, form,
    /// or email-agent reply (assistant row with no user row), after a failed send
    /// (two user rows), and once the 32-message window opens on an assistant turn.
    fn coalesce_alternating_messages(messages: Vec<Value>) -> Vec<Value> {
        let mut out: Vec<Value> = Vec::with_capacity(messages.len());
        for msg in messages {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if let Some(last) = out.last_mut() {
                let last_role = last.get("role").and_then(|r| r.as_str()).unwrap_or("");
                if !role.is_empty() && role == last_role {
                    let merged = merge_message_content(&last["content"], &msg["content"]);
                    last["content"] = merged;
                    continue;
                }
            }
            out.push(msg);
        }
        if out
            .first()
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            == Some("assistant")
        {
            out.insert(
                0,
                json!({
                    "role": "user",
                    "content": LEADING_ASSISTANT_USER_NOTE
                }),
            );
        }
        out
    }

    fn anthropic_tools(tools: &[ToolDefinition]) -> Vec<Value> {
        tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                })
            })
            .collect()
    }

    fn build_body(&self, request: &CompletionRequest, stream: bool) -> Value {
        let (system, messages) = Self::split_system_and_messages(request);
        let max_tokens = Self::max_out_tokens(request);
        let mut body = json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages,
            "stream": stream,
        });
        let obj = body.as_object_mut().unwrap();
        if let Some(s) = system {
            if !s.trim().is_empty() {
                obj.insert("system".into(), json!(s));
            }
        }
        if let Some(t) = request.temperature {
            obj.insert("temperature".into(), json!(t));
        }
        if let Some(ref tools) = request.tools {
            if !tools.is_empty() {
                obj.insert("tools".into(), json!(Self::anthropic_tools(tools)));
            }
        }
        body
    }

    fn parse_content_blocks(content: &Value) -> Result<(String, Vec<ToolCall>), ProviderError> {
        let mut text_out = String::new();
        let mut tool_calls = Vec::new();
        if let Some(s) = content.as_str() {
            if !s.is_empty() {
                text_out.push_str(s);
            }
            return Ok((text_out, tool_calls));
        }
        let Some(arr) = content.as_array() else {
            return Ok((String::new(), tool_calls));
        };
        for block in arr {
            let ty = block["type"].as_str().unwrap_or("");
            if ty == "text" {
                let t = block["text"].as_str().unwrap_or("");
                if !t.is_empty() {
                    if !text_out.is_empty() {
                        text_out.push('\n');
                    }
                    text_out.push_str(t);
                }
            } else if ty == "tool_use" {
                let id = block["id"].as_str().unwrap_or("").to_string();
                let name = block["name"].as_str().unwrap_or("").to_string();
                let input = block["input"].clone();
                let arguments_json =
                    serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
                tool_calls.push(ToolCall {
                    id,
                    name,
                    arguments_json,
                });
            }
        }
        Ok((text_out, tool_calls))
    }

    fn parse_message_response(v: &Value) -> Result<CompletionResponse, ProviderError> {
        if let Some(err) = v["error"]["message"].as_str() {
            return Err(ProviderError::Api(err.to_string()));
        }
        let (content, tool_calls) = Self::parse_content_blocks(&v["content"])?;
        let stop = v["stop_reason"].as_str().map(String::from);
        let usage = v["usage"].as_object().and_then(|u| {
            Some(TokenUsage {
                prompt_tokens: u["input_tokens"].as_u64().map(|x| x as u32),
                completion_tokens: u["output_tokens"].as_u64().map(|x| x as u32),
            })
        });
        Ok(CompletionResponse {
            content,
            tool_calls,
            finish_reason: stop,
            usage,
        })
    }

    fn apply_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
    }
}

#[async_trait]
impl LLMProviderEngine for AnthropicProvider {
    fn provider_id(&self) -> &'static str {
        "anthropic"
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            provider_id: "anthropic".to_string(),
            model_id: self.model.clone(),
            context_window_tokens: Some(CLAUDE_CTX),
        }
    }

    async fn complete(
        &self,
        request: &CompletionRequest,
    ) -> Result<CompletionResponse, ProviderError> {
        let body = self.build_body(request, false);
        let res = self
            .apply_auth(self.client.post(ANTHROPIC_API).json(&body))
            .timeout(Duration::from_secs(180))
            .send()
            .await?
            .error_for_status()?;

        let v: Value = res.json().await?;
        Self::parse_message_response(&v)
    }

    async fn stream(
        &self,
        request: &CompletionRequest,
        tx: tokio::sync::mpsc::Sender<Result<StreamChunk, ProviderError>>,
    ) -> Result<(), ProviderError> {
        let body = self.build_body(request, true);
        let res = self
            .apply_auth(self.client.post(ANTHROPIC_API).json(&body))
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
                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                    continue;
                };
                let v: Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if let Some(err) = v["error"]["message"].as_str() {
                    let _ = tx.send(Err(ProviderError::Api(err.to_string()))).await;
                    return Ok(());
                }
                let ty = v["type"].as_str().unwrap_or("");
                if ty == "error" {
                    let msg = v["error"]["message"]
                        .as_str()
                        .or_else(|| v["error"].as_str())
                        .unwrap_or("Anthropic stream error");
                    let _ = tx.send(Err(ProviderError::Api(msg.to_string()))).await;
                    return Ok(());
                }
                if ty == "content_block_delta" {
                    let delta = &v["delta"];
                    let dty = delta["type"].as_str().unwrap_or("");
                    if dty == "text_delta" {
                        let piece = delta["text"].as_str().unwrap_or("");
                        if !piece.is_empty() {
                            let _ = tx
                                .send(Ok(StreamChunk {
                                    delta: piece.to_string(),
                                    done: false,
                                }))
                                .await;
                        }
                    }
                } else if ty == "message_stop" {
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

const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models";

/// Lists Claude model ids from `GET /v1/models` (requires saved Anthropic API key).
pub async fn fetch_anthropic_model_ids(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Vec<String>, ProviderError> {
    let api_key = settings
        .decrypt_api_key("anthropic")?
        .filter(|s| !s.trim().is_empty())
        .ok_or(ProviderError::MissingApiKey("anthropic"))?;
    let res = http
        .get(ANTHROPIC_MODELS_URL)
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .timeout(Duration::from_secs(45))
        .send()
        .await?
        .error_for_status()?;
    let v: Value = res.json().await?;
    if let Some(msg) = v["error"]["message"].as_str() {
        return Err(ProviderError::Api(msg.to_string()));
    }
    let mut names = Vec::new();
    if let Some(arr) = v["data"].as_array().or_else(|| v["models"].as_array()) {
        for m in arr {
            if let Some(id) = m["id"].as_str() {
                names.push(id.to_string());
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

    fn messages_of(turns: Vec<ChatTurn>) -> Vec<Value> {
        let (_, messages) = AnthropicProvider::split_system_and_messages(&CompletionRequest {
            messages: turns,
            ..CompletionRequest::default()
        });
        messages
    }

    #[test]
    fn merges_consecutive_assistant_replies() {
        let messages = messages_of(vec![
            ChatTurn::text("system", "persona"),
            ChatTurn::text("user", "draft a budget"),
            ChatTurn::text("assistant", "Here is the form."),
            ChatTurn::text("assistant", "Updated the living document."),
            ChatTurn::text("user", "tighten rent"),
        ]);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "draft a budget");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(
            messages[1]["content"],
            "Here is the form.\n\nUpdated the living document."
        );
        assert_eq!(messages[2]["content"], "tighten rent");
    }

    #[test]
    fn prefixes_user_when_context_window_opens_on_assistant() {
        let messages = messages_of(vec![
            ChatTurn::text("assistant", "Earlier reply that the window kept."),
            ChatTurn::text("user", "what did we decide?"),
        ]);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], LEADING_ASSISTANT_USER_NOTE);
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(
            messages[1]["content"],
            "Earlier reply that the window kept."
        );
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"], "what did we decide?");
    }

    #[test]
    fn merges_consecutive_user_turns_after_a_failed_send() {
        let messages = messages_of(vec![
            ChatTurn::text("user", "first try"),
            ChatTurn::text("user", "second try"),
            ChatTurn::text("assistant", "answer"),
        ]);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "first try\n\nsecond try");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"], "answer");
    }

    #[test]
    fn leaves_alternating_transcript_unchanged() {
        let messages = messages_of(vec![
            ChatTurn::text("user", "hello"),
            ChatTurn::text("assistant", "hi"),
        ]);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["content"], "hello");
        assert_eq!(messages[1]["content"], "hi");
    }

    #[test]
    fn keeps_tool_result_attached_when_a_user_turn_follows() {
        let messages = messages_of(vec![
            ChatTurn::text("user", "look at the screenshot"),
            ChatTurn {
                role: "assistant".into(),
                content: String::new(),
                openai_message: None,
                ollama_message: None,
                anthropic_message: Some(json!({
                    "role": "assistant",
                    "content": [
                        { "type": "tool_use", "id": "toolu_1", "name": "workspace_view_image", "input": {} }
                    ]
                })),
            },
            ChatTurn {
                role: "user".into(),
                content: "loaded".into(),
                openai_message: None,
                ollama_message: None,
                anthropic_message: Some(json!({
                    "role": "user",
                    "content": [
                        { "type": "tool_result", "tool_use_id": "toolu_1", "content": "loaded" }
                    ]
                })),
            },
            ChatTurn {
                role: "user".into(),
                content: "image follows".into(),
                openai_message: None,
                ollama_message: None,
                anthropic_message: Some(json!({
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "image follows" },
                        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "abc" } }
                    ]
                })),
            },
        ]);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"][0]["type"], "tool_use");
        assert_eq!(messages[2]["role"], "user");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
        assert_eq!(messages[2]["content"][1]["type"], "text");
        assert_eq!(messages[2]["content"][2]["type"], "image");
    }
}
