//! Chat send pipeline: MemoryAnchor context, settings-backed LLM, streamed assistant reply.

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use std::path::Path;

use crate::attachments::{self, model_supports_vision};
use crate::memory::{ConversationMemory, MessageRole, StoredMessage, DEFAULT_PERSONALITY_ID};
use std::time::Duration;
use crate::provider::{
    build_engine, ChatSendResult, ChatTurn, CompletionRequest, CompletionResponse, LLMProviderEngine,
    ProviderError, StreamChunk, ToolCall, ToolDefinition,
};
use crate::NovaState;

fn should_auto_memory_recall(user_text: &str) -> bool {
    let t = user_text.trim();
    if t.len() >= 140 {
        return true;
    }
    if t.split_whitespace().count() >= 14 {
        return true;
    }
    if t.contains('?') {
        return true;
    }
    let lower = t.to_lowercase();
    const KEYS: &[&str] = &[
        "remember",
        "last time",
        "earlier",
        "previously",
        "before we",
        "mentioned",
        "you said",
        "what did",
        "what is my",
        "what are my",
        "who is",
        "when did",
        "project",
        "recall",
        "context",
        "conversation about",
        "told me",
        "favorite",
        "preference",
        "previously said",
        "vision",
        "colorblind",
        "colourblind",
        "about my",
        "know about",
    ];
    KEYS.iter().any(|k| lower.contains(k))
}

fn emit_synthetic_stream_deltas(app: &AppHandle, conversation_id: &str, text: &str) {
    const CHUNK_CHARS: usize = 72;
    let mut buf = String::new();
    let mut n = 0usize;
    for ch in text.chars() {
        buf.push(ch);
        n += 1;
        if n >= CHUNK_CHARS {
            let _ = app.emit(
                "chat:stream",
                ChatStreamEvent {
                    conversation_id: conversation_id.to_string(),
                    delta: std::mem::take(&mut buf),
                    done: false,
                },
            );
            n = 0;
        }
    }
    if !buf.is_empty() {
        let _ = app.emit(
            "chat:stream",
            ChatStreamEvent {
                conversation_id: conversation_id.to_string(),
                delta: buf,
                done: false,
            },
        );
    }
    let _ = app.emit(
        "chat:stream",
        ChatStreamEvent {
            conversation_id: conversation_id.to_string(),
            delta: String::new(),
            done: true,
        },
    );
}

fn assistant_openai_message_with_tool_calls(resp: &CompletionResponse) -> serde_json::Value {
    let content_val = if resp.content.trim().is_empty() {
        serde_json::Value::Null
    } else {
        json!(resp.content)
    };
    let tool_calls_json: Vec<serde_json::Value> = resp
        .tool_calls
        .iter()
        .map(|tc| {
            json!({
                "id": &tc.id,
                "type": "function",
                "function": {
                    "name": &tc.name,
                    "arguments": &tc.arguments_json
                }
            })
        })
        .collect();
    json!({
        "role": "assistant",
        "content": content_val,
        "tool_calls": tool_calls_json,
    })
}

fn ollama_assistant_with_tool_calls(resp: &CompletionResponse) -> serde_json::Value {
    let tool_calls: Vec<serde_json::Value> = resp
        .tool_calls
        .iter()
        .enumerate()
        .map(|(i, tc)| {
            let args: serde_json::Value =
                serde_json::from_str(&tc.arguments_json).unwrap_or(json!({}));
            json!({
                "type": "function",
                "function": {
                    "index": i,
                    "name": &tc.name,
                    "arguments": args
                }
            })
        })
        .collect();
    json!({
        "role": "assistant",
        "content": resp.content.clone(),
        "tool_calls": tool_calls,
    })
}

fn anthropic_assistant_with_tool_calls(resp: &CompletionResponse) -> serde_json::Value {
    let mut blocks = Vec::new();
    if !resp.content.trim().is_empty() {
        blocks.push(json!({"type": "text", "text": resp.content}));
    }
    for tc in &resp.tool_calls {
        let input: serde_json::Value =
            serde_json::from_str(&tc.arguments_json).unwrap_or(json!({}));
        blocks.push(json!({
            "type": "tool_use",
            "id": &tc.id,
            "name": &tc.name,
            "input": input
        }));
    }
    json!({ "role": "assistant", "content": blocks })
}

/// Native API tool calls, or XML/invoke blocks some models put in `content` (e.g. Kimi on Ollama Cloud).
fn resolve_tool_calls(resp: &CompletionResponse) -> Vec<ToolCall> {
    if !resp.tool_calls.is_empty() {
        return resp.tool_calls.clone();
    }
    crate::agent_tools::parse_text_embedded_tool_calls(&resp.content)
}

fn completion_for_tool_round(resp: &CompletionResponse, tool_calls: &[ToolCall]) -> CompletionResponse {
    let content = if tool_calls.is_empty() {
        resp.content.clone()
    } else {
        crate::agent_tools::strip_embedded_tool_call_markup(&resp.content)
    };
    CompletionResponse {
        content,
        tool_calls: tool_calls.to_vec(),
        finish_reason: resp.finish_reason.clone(),
        usage: resp.usage.clone(),
    }
}

fn anthropic_user_tool_results(tool_calls: &[ToolCall], bodies: &[String]) -> serde_json::Value {
    let blocks: Vec<serde_json::Value> = tool_calls
        .iter()
        .zip(bodies.iter())
        .map(|(tc, body)| {
            json!({
                "type": "tool_result",
                "tool_use_id": &tc.id,
                "content": body
            })
        })
        .collect();
    json!({ "role": "user", "content": blocks })
}

#[derive(Clone, Copy)]
enum AgentWebToolBackend {
    OpenAI,
    Ollama,
    Anthropic,
}

fn web_tool_backend_for_provider(provider_id: &str) -> Option<AgentWebToolBackend> {
    match provider_id {
        "openai" => Some(AgentWebToolBackend::OpenAI),
        "ollama" | "ollama_cloud" => Some(AgentWebToolBackend::Ollama),
        "anthropic" => Some(AgentWebToolBackend::Anthropic),
        _ => None,
    }
}

async fn apply_tool_round_messages(
    http: &reqwest::Client,
    workspace_root: Option<&Path>,
    data_directory: &Path,
    database_app_data_enabled: bool,
    database_allow_write: bool,
    browser_ignore_robots: bool,
    personality: Option<&crate::personality::PersonalityManager>,
    memory_tools: Option<(&crate::settings::SettingsManager, &dyn ConversationMemory)>,
    messages: &mut Vec<ChatTurn>,
    round: &CompletionResponse,
    backend: AgentWebToolBackend,
) -> Result<(), ProviderError> {
    let mut personality_updated = false;
    match backend {
        AgentWebToolBackend::OpenAI => {
            messages.push(ChatTurn {
                role: "assistant".into(),
                content: round.content.clone(),
                openai_message: Some(assistant_openai_message_with_tool_calls(round)),
                ollama_message: None,
                anthropic_message: None,
            });
            for tc in &round.tool_calls {
                let body = crate::agent_tools::run_builtin_tool(
                    http,
                    workspace_root,
                    data_directory,
                    database_app_data_enabled,
                    database_allow_write,
                    browser_ignore_robots,
                    personality,
                    memory_tools,
                    &tc.name,
                    &tc.arguments_json,
                )
                .await
                .unwrap_or_else(|e| format!("Tool error: {e}"));
                if tc.name == "personality_update" && !body.starts_with("Tool error:") {
                    personality_updated = true;
                }
                messages.push(ChatTurn {
                    role: "tool".into(),
                    content: body.clone(),
                    openai_message: Some(json!({
                        "role": "tool",
                        "tool_call_id": &tc.id,
                        "content": body,
                    })),
                    ollama_message: None,
                    anthropic_message: None,
                });
            }
        }
        AgentWebToolBackend::Ollama => {
            messages.push(ChatTurn {
                role: "assistant".into(),
                content: round.content.clone(),
                openai_message: None,
                ollama_message: Some(ollama_assistant_with_tool_calls(round)),
                anthropic_message: None,
            });
            for tc in &round.tool_calls {
                let body = crate::agent_tools::run_builtin_tool(
                    http,
                    workspace_root,
                    data_directory,
                    database_app_data_enabled,
                    database_allow_write,
                    browser_ignore_robots,
                    personality,
                    memory_tools,
                    &tc.name,
                    &tc.arguments_json,
                )
                .await
                .unwrap_or_else(|e| format!("Tool error: {e}"));
                if tc.name == "personality_update" && !body.starts_with("Tool error:") {
                    personality_updated = true;
                }
                messages.push(ChatTurn {
                    role: "tool".into(),
                    content: body.clone(),
                    openai_message: None,
                    ollama_message: Some(json!({
                        "role": "tool",
                        "tool_name": &tc.name,
                        "content": body,
                    })),
                    anthropic_message: None,
                });
            }
        }
        AgentWebToolBackend::Anthropic => {
            messages.push(ChatTurn {
                role: "assistant".into(),
                content: round.content.clone(),
                openai_message: None,
                ollama_message: None,
                anthropic_message: Some(anthropic_assistant_with_tool_calls(round)),
            });
            let mut bodies: Vec<String> = Vec::with_capacity(round.tool_calls.len());
            for tc in &round.tool_calls {
                let body = crate::agent_tools::run_builtin_tool(
                    http,
                    workspace_root,
                    data_directory,
                    database_app_data_enabled,
                    database_allow_write,
                    browser_ignore_robots,
                    personality,
                    memory_tools,
                    &tc.name,
                    &tc.arguments_json,
                )
                .await
                .unwrap_or_else(|e| format!("Tool error: {e}"));
                if tc.name == "personality_update" && !body.starts_with("Tool error:") {
                    personality_updated = true;
                }
                bodies.push(body);
            }
            messages.push(ChatTurn {
                role: "user".into(),
                content: bodies.join("\n---\n"),
                openai_message: None,
                ollama_message: None,
                anthropic_message: Some(anthropic_user_tool_results(&round.tool_calls, &bodies)),
            });
        }
    }
    if personality_updated {
        if let Some(mgr) = personality {
            crate::personality_tools::refresh_system_persona_in_messages(messages, mgr);
            eprintln!("nova: refreshed system persona after personality_update");
        }
    }
    Ok(())
}

/// Non-streaming completion with tool rounds (OpenAI, Ollama, Anthropic).
async fn agent_complete_with_tools(
    engine: &(dyn LLMProviderEngine + Send + Sync),
    http: &reqwest::Client,
    workspace_root: Option<&Path>,
    data_directory: &Path,
    database_app_data_enabled: bool,
    database_allow_write: bool,
    browser_ignore_robots: bool,
    personality: Option<&crate::personality::PersonalityManager>,
    memory_tools: Option<(&crate::settings::SettingsManager, &dyn ConversationMemory)>,
    mut messages: Vec<ChatTurn>,
    max_tokens: Option<u32>,
    temperature: f32,
    backend: AgentWebToolBackend,
    tools: Vec<ToolDefinition>,
) -> Result<String, ProviderError> {
    const MAX_ROUNDS: usize = 8;
    if tools.is_empty() {
        return Err(ProviderError::Api("internal: no tools configured".into()));
    }
    for _ in 0..MAX_ROUNDS {
        let req = CompletionRequest {
            messages: messages.clone(),
            tools: Some(tools.clone()),
            max_tokens,
            temperature: Some(temperature),
        };
        let resp = engine.complete(&req).await?;
        let tool_calls = resolve_tool_calls(&resp);
        if tool_calls.is_empty() {
            if crate::agent_tools::content_has_embedded_tool_calls(&resp.content) {
                return Err(ProviderError::Api(
                    "The model returned tool-call XML in plain text, but Nova could not parse or run it. \
                     Try again, or use a model with native tool support (e.g. gpt-4o, Claude 3+, Llama 3.1+ tools)."
                        .into(),
                ));
            }
            return Ok(resp.content);
        }
        if resp.tool_calls.is_empty() {
            eprintln!(
                "nova: executing {} tool call(s) parsed from model text (native tool_calls empty)",
                tool_calls.len()
            );
        }
        let round = completion_for_tool_round(&resp, &tool_calls);
        apply_tool_round_messages(
            http,
            workspace_root,
            data_directory,
            database_app_data_enabled,
            database_allow_write,
            browser_ignore_robots,
            personality,
            memory_tools,
            &mut messages,
            &round,
            backend,
        )
        .await?;
    }
    Err(ProviderError::Api(
        "Agent stopped after maximum tool rounds — try a narrower question.".into(),
    ))
}

/// If the model printed tool XML on a non-tool code path, run tools and ask the model again.
async fn try_complete_after_embedded_tool_xml(
    engine: &(dyn LLMProviderEngine + Send + Sync),
    http: &reqwest::Client,
    workspace_root: Option<&Path>,
    data_directory: &Path,
    database_app_data_enabled: bool,
    database_allow_write: bool,
    browser_ignore_robots: bool,
    personality: Option<&crate::personality::PersonalityManager>,
    memory_tools: Option<(&crate::settings::SettingsManager, &dyn ConversationMemory)>,
    mut messages: Vec<ChatTurn>,
    assistant_xml: &str,
    max_tokens: Option<u32>,
    temperature: f32,
    backend: AgentWebToolBackend,
    tools: Vec<ToolDefinition>,
) -> Result<Option<String>, ProviderError> {
    let calls = crate::agent_tools::parse_text_embedded_tool_calls(assistant_xml);
    if calls.is_empty() {
        return Ok(None);
    }
    eprintln!(
        "nova: running {} embedded tool call(s) from model text (not native API)",
        calls.len()
    );
    let resp = CompletionResponse {
        content: assistant_xml.to_string(),
        tool_calls: calls.clone(),
        finish_reason: None,
        usage: None,
    };
    let round = completion_for_tool_round(&resp, &calls);
    apply_tool_round_messages(
        http,
        workspace_root,
        data_directory,
        database_app_data_enabled,
        database_allow_write,
        browser_ignore_robots,
        personality,
        memory_tools,
        &mut messages,
        &round,
        backend,
    )
    .await?;
    let text = agent_complete_with_tools(
        engine,
        http,
        workspace_root,
        data_directory,
        database_app_data_enabled,
        database_allow_write,
        browser_ignore_robots,
        personality,
        memory_tools,
        messages,
        max_tokens,
        temperature,
        backend,
        tools,
    )
    .await?;
    Ok(Some(text))
}

fn user_facing_tool_markup_message(provider_id: &str, has_images: bool) -> String {
    if has_images && matches!(provider_id, "ollama" | "ollama_cloud") {
        return "I tried to call a built-in tool, but tools are disabled for this message because an \
                image is attached with local Ollama. Send the request without an image, or switch provider."
            .into();
    }
    "I tried to call a built-in tool, but tool execution was not active for this turn. Use OpenAI/Ollama/Anthropic \
     (not Placeholder) with a tool-capable model. Enable **Allow web tools** in Settings → Tools if needed; \
     **Memory Search** is available whenever a real provider is selected."
        .into()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamStart {
    pub conversation_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEvent {
    pub conversation_id: String,
    pub delta: String,
    pub done: bool,
}

/// Shared LLM path after `messages` (system + transcript) is built: tools or stream, then persist assistant.
async fn run_chat_completion(
    app: &AppHandle,
    state: &NovaState,
    conversation_id: &str,
    engine: &std::sync::Arc<dyn LLMProviderEngine + Send + Sync>,
    mut messages: Vec<ChatTurn>,
) -> Result<String, String> {
    let configured = state.settings.max_tokens();
    let max_tokens = match configured {
        Some(n) => Some(n),
        None => engine.model_info().context_window_tokens,
    };

    let temperature = state.settings.temperature();

    let mut tool_definitions: Vec<ToolDefinition> = Vec::new();
    if state.settings.agent_web_tools_enabled() {
        tool_definitions.extend(crate::agent_tools::builtin_tool_definitions());
        if state.settings.agent_browser_fetch_enabled() {
            tool_definitions.push(crate::agent_tools::browser_fetch_tool_definition(
                state.settings.agent_browser_ignore_robots(),
            ));
        }
    }
    if state.settings.agent_workspace_enabled() {
        tool_definitions.extend(crate::agent_tools::workspace_tool_definitions());
    }
    let database_tools_enabled =
        state.settings.agent_workspace_enabled() || state.settings.database_app_data_enabled();
    if database_tools_enabled {
        tool_definitions.extend(crate::database_query::tool_definitions());
    }
    let personality_edit_enabled = state.settings.agent_personality_edit_enabled();
    if personality_edit_enabled {
        tool_definitions.extend(crate::personality_tools::tool_definitions());
    }
    let provider_id = engine.provider_id();
    let memory_tools_active = provider_id != "placeholder";
    if memory_tools_active {
        tool_definitions.extend(crate::memory_tools::tool_definitions());
    }
    let memory_tools_ctx = memory_tools_active.then(|| {
        (
            &*state.settings,
            state.memory.as_ref() as &dyn ConversationMemory,
        )
    });
    let workspace_root_for_tools = state
        .settings
        .agent_workspace_enabled()
        .then_some(state.workspace_root.as_path());
    let database_app_data_enabled = state.settings.database_app_data_enabled();
    let database_allow_write = state.settings.database_allow_write();
    let browser_ignore_robots = state.settings.agent_browser_ignore_robots();
    let personality_for_tools =
        personality_edit_enabled.then(|| state.personality.as_ref());

    let has_images = attachments::messages_include_images(&messages);
    // Ollama often ignores `images` when `tools` are present — prefer vision over tools for that turn.
    let agent_tool_backend = (!tool_definitions.is_empty())
        .then(|| web_tool_backend_for_provider(provider_id))
        .flatten()
        .filter(|_| {
            !(has_images && matches!(provider_id, "ollama" | "ollama_cloud"))
        });

    if !tool_definitions.is_empty() {
        let names: Vec<&str> = tool_definitions.iter().map(|t| t.name.as_str()).collect();
        eprintln!(
            "nova: {} agent tool(s) configured: {}",
            names.len(),
            names.join(", ")
        );
        // Only teach XML tool syntax when Nova will actually execute tools (avoids raw XML on stream path).
        if agent_tool_backend.is_some() {
            if let Some(system) = messages
                .first_mut()
                .filter(|m| m.role == "system")
            {
                system.content
                    .push_str(&crate::agent_tools::tools_system_appendix(&tool_definitions));
                if personality_edit_enabled {
                    system.content
                        .push_str(crate::personality_tools::personality_system_hint());
                }
                if memory_tools_active {
                    system.content.push_str(crate::memory_tools::memory_system_hint());
                }
            }
        }
    }

    if !tool_definitions.is_empty() && agent_tool_backend.is_none() {
        eprintln!(
            "nova: warning: tools are enabled in settings but inactive this turn \
             (provider={provider_id}, has_images={has_images}). Enable web tools for your provider \
             in Settings, or use a tool-capable model without an image attachment."
        );
    }

    let messages_for_tool_recovery = messages.clone();

    if has_images {
        eprintln!(
            "nova: chat completion includes image(s) for provider={provider_id} tools={}",
            agent_tool_backend.is_some()
        );
    }

    let mut full = String::new();

    if let Some(backend) = agent_tool_backend {
        match agent_complete_with_tools(
            engine.as_ref(),
            &state.http,
            workspace_root_for_tools,
            state.data_directory.as_path(),
            database_app_data_enabled,
            database_allow_write,
            browser_ignore_robots,
            personality_for_tools,
            memory_tools_ctx,
            messages,
            max_tokens,
            temperature,
            backend,
            tool_definitions,
        )
        .await
        {
            Ok(text) => {
                full = text;
                emit_synthetic_stream_deltas(app, conversation_id, &full);
            }
            Err(e) => {
                let msg = e.to_string();
                let _ = app.emit("chat:stream-error", msg.clone());
                return Err(msg);
            }
        }
    } else {
        let req = CompletionRequest {
            messages,
            tools: None,
            max_tokens,
            temperature: Some(temperature),
        };

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<StreamChunk, ProviderError>>(64);
        let engine_clone = engine.clone();
        let send_task = tokio::spawn(async move { engine_clone.stream(&req, tx).await });

        let mut saw_done = false;
        while let Some(item) = rx.recv().await {
            match item {
                Ok(chunk) => {
                    if !chunk.delta.is_empty() {
                        full.push_str(&chunk.delta);
                        let _ = app.emit(
                            "chat:stream",
                            ChatStreamEvent {
                                conversation_id: conversation_id.to_string(),
                                delta: chunk.delta,
                                done: false,
                            },
                        );
                    }
                    if chunk.done {
                        saw_done = true;
                        let _ = app.emit(
                            "chat:stream",
                            ChatStreamEvent {
                                conversation_id: conversation_id.to_string(),
                                delta: String::new(),
                                done: true,
                            },
                        );
                        break;
                    }
                }
                Err(e) => {
                    let msg = e.to_string();
                    let _ = app.emit("chat:stream-error", msg.clone());
                    send_task.abort();
                    return Err(msg);
                }
            }
        }

        match send_task.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let msg = e.to_string();
                let _ = app.emit("chat:stream-error", msg.clone());
                return Err(msg);
            }
            Err(j) => {
                let msg = j.to_string();
                let _ = app.emit("chat:stream-error", msg.clone());
                return Err(msg);
            }
        }

        if !saw_done {
            let _ = app.emit(
                "chat:stream",
                ChatStreamEvent {
                    conversation_id: conversation_id.to_string(),
                    delta: String::new(),
                    done: true,
                },
            );
        }

        if crate::agent_tools::content_has_embedded_tool_calls(&full) {
            if let Some(backend) = agent_tool_backend {
                match try_complete_after_embedded_tool_xml(
                    engine.as_ref(),
                    &state.http,
                    workspace_root_for_tools,
                    state.data_directory.as_path(),
                    database_app_data_enabled,
                    database_allow_write,
                    browser_ignore_robots,
                    personality_for_tools,
                    memory_tools_ctx,
                    messages_for_tool_recovery,
                    &full,
                    max_tokens,
                    temperature,
                    backend,
                    tool_definitions.clone(),
                )
                .await
                {
                    Ok(Some(text)) => {
                        full = text;
                        emit_synthetic_stream_deltas(app, conversation_id, &full);
                    }
                    Ok(None) | Err(_) => {
                        full = user_facing_tool_markup_message(provider_id, has_images);
                    }
                }
            } else {
                full = user_facing_tool_markup_message(provider_id, has_images);
            }
        }
    }

    let mut reply = full;
    if reply.trim().is_empty() {
        reply = "(no text in model response)".into();
    }
    if crate::agent_tools::content_has_embedded_tool_calls(&reply) {
        reply = user_facing_tool_markup_message(provider_id, has_images);
    }

    state
        .memory
        .store_message(conversation_id, MessageRole::Assistant, &reply, None, None)
        .map_err(|e| e.to_string())?;

    Ok(reply)
}

/// Saved image for the user turn about to be stored.
pub struct PendingImage {
    pub rel_path: String,
    pub mime: String,
}

/// Messages loaded into the model context (smaller = faster prep on long threads).
const CHAT_CONTEXT_RECENT: usize = 32;
const CHAT_PREP_TIMEOUT: Duration = Duration::from_secs(12);

/// One user turn on an existing conversation — same path for manual send and scheduled Pulse.
pub async fn execute_chat_turn(
    app: &AppHandle,
    state: &NovaState,
    conversation_id: &str,
    message: &str,
    personality_id: &str,
    pending_image: Option<PendingImage>,
) -> Result<String, String> {
    let text = message.trim();
    if text.is_empty() && pending_image.is_none() {
        return Err("message content is empty".into());
    }

    let pid = personality_id.trim();
    let pid = if pid.is_empty() {
        DEFAULT_PERSONALITY_ID
    } else {
        pid
    };

    let _ = app.emit(
        "chat:stream-start",
        ChatStreamStart {
            conversation_id: conversation_id.to_string(),
        },
    );

    state
        .personality
        .set_active_profile_id(pid)
        .map_err(|e| format!("companion persona sync: {e}"))?;
    ConversationMemory::set_active_personality(&*state.memory, pid);

    let engine: std::sync::Arc<dyn LLMProviderEngine + Send + Sync> =
        match build_engine(&state.http, &state.settings) {
            Ok(e) => {
                *state.llm.write().await = e.clone();
                e
            }
            Err(e) => return Err(e.to_string()),
        };

    if pending_image.is_some() && !model_supports_vision(engine.provider_id(), &engine.model_info().model_id) {
        return Err(format!(
            "The active model ({}) does not support image input. Switch to a vision-capable model (e.g. gpt-4o, Claude 3+, or a llava/vision Ollama model).",
            engine.model_info().model_id
        ));
    }

    let (img_rel, img_mime) = match &pending_image {
        Some(p) => (Some(p.rel_path.clone()), Some(p.mime.clone())),
        None => (None, None),
    };

    let companion_label = state.personality.companion_display_name();
    let memory = state.memory.clone();
    let conv_id = conversation_id.to_string();
    let user_text = text.to_string();
    let recall_source = if !text.is_empty() {
        text.to_string()
    } else {
        "image attachment".into()
    };
    let companion_for_prep = companion_label.clone();

    let prep = tokio::time::timeout(
        CHAT_PREP_TIMEOUT,
        tokio::task::spawn_blocking(move || -> Result<(String, Vec<StoredMessage>), String> {
            memory
                .store_message(
                    &conv_id,
                    MessageRole::User,
                    &user_text,
                    img_rel.as_deref(),
                    img_mime.as_deref(),
                )
                .map_err(|e| e.to_string())?;

            let mut briefing = memory
                .get_startup_briefing(&conv_id, &companion_for_prep)
                .map_err(|e| e.to_string())?;

            if should_auto_memory_recall(&recall_source) {
                let recall_q: String = recall_source.chars().take(520).collect();
                match memory.memory_recall(&recall_q, None, 8, 4, None) {
                    Ok(bundle)
                        if !bundle.anchors.is_empty() || !bundle.messages.is_empty() =>
                    {
                        let block = crate::memory_tools::format_recall_for_prompt(&bundle, 1_800);
                        briefing.push_str("\n\n## Retrieved memory (auto)\n\n");
                        briefing.push_str(&block);
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("nova: memory auto-recall failed: {e}"),
                }
            }

            let recent = memory
                .get_recent(&conv_id, CHAT_CONTEXT_RECENT)
                .map_err(|e| e.to_string())?;
            Ok((briefing, recent))
        }),
    )
    .await;

    let (briefing, recent) = match prep {
        Ok(Ok(Ok(ok))) => ok,
        Ok(Ok(Err(e))) => return Err(e),
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            eprintln!(
                "nova: chat prep timed out after {:?} — continuing with reduced context",
                CHAT_PREP_TIMEOUT
            );
            let recent = state
                .memory
                .get_recent(conversation_id, CHAT_CONTEXT_RECENT)
                .unwrap_or_default();
            (
                format!(
                    "# Session context\n\n_Memory prep timed out; using transcript only._\n"
                ),
                recent,
            )
        }
    };

    if !text.is_empty() {
        if !state.settings.memory_llm_extraction_enabled() {
            let memory = state.memory.clone();
            let conv = conversation_id.to_string();
            let t = text.to_string();
            tokio::task::spawn_blocking(move || {
                if let Err(e) = memory.ingest_user_message_anchors(&conv, &t) {
                    eprintln!("nova: auto-ingest anchors failed: {e}");
                }
            });
        }
        crate::memory_extract::spawn_post_message_memory(
            state.http.clone(),
            state.settings.clone(),
            state.memory.clone(),
            conversation_id.to_string(),
            text.to_string(),
        );
    }

    let persona = state.personality.system_prompt_prefix();
    let system_content = {
        let p = persona.trim();
        if p.is_empty() {
            briefing.clone()
        } else {
            format!("{p}\n\n---\n\n# Memory & session context\n\n{briefing}")
        }
    };

    let provider_id = engine.provider_id().to_string();
    let data_dir = state.data_directory.as_path();

    let image_turn_id = recent
        .iter()
        .filter(|m| m.role == MessageRole::User && m.image_attachment.is_some())
        .max_by_key(|m| m.id)
        .map(|m| m.id);

    let mut messages: Vec<ChatTurn> = Vec::with_capacity(recent.len() + 1);
    messages.push(ChatTurn::text("system", system_content));
    for m in recent {
        let include_image = image_turn_id == Some(m.id);
        let mut turn = attachments::chat_turn_from_stored_with_image_policy(
            &provider_id,
            data_dir,
            &m,
            include_image,
        )?;
        if m.role == MessageRole::Assistant
            && crate::agent_tools::content_has_embedded_tool_calls(&turn.content)
        {
            turn.content = crate::agent_tools::strip_embedded_tool_call_markup(&turn.content);
            if turn.content.trim().is_empty() {
                turn.content = "(Earlier tool-call markup was not executed; continue from context below.)"
                    .into();
            }
        }
        messages.push(turn);
    }

    run_chat_completion(app, state, conversation_id, &engine, messages).await
}

#[tauri::command]
pub async fn chat_send_message(
    app: AppHandle,
    state: State<'_, NovaState>,
    conversation_id: String,
    message: String,
    personality_id: Option<String>,
    image_base64: Option<String>,
    image_mime: Option<String>,
) -> Result<ChatSendResult, String> {
    let pid = personality_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_PERSONALITY_ID);

    let engine_probe = build_engine(&state.http, &state.settings).map_err(|e| e.to_string())?;
    let pending_image = match (image_base64, image_mime) {
        (Some(b64), Some(mime)) if !b64.trim().is_empty() => {
            let info = engine_probe.model_info();
            if !model_supports_vision(engine_probe.provider_id(), &info.model_id) {
                return Err(format!(
                    "The active model ({}) does not support image input. Switch to a vision-capable model (e.g. gpt-4o, Claude 3+, or a llava/vision Ollama model).",
                    info.model_id
                ));
            }
            let (rel, mime) = attachments::save_image_attachment(
                &state.data_directory,
                conversation_id.trim(),
                &mime,
                &b64,
            )?;
            Some(PendingImage { rel_path: rel, mime })
        }
        (Some(_), None) => return Err("imageMime is required when sending an image".into()),
        (None, Some(_)) => return Err("image data missing".into()),
        _ => None,
    };

    let reply = execute_chat_turn(
        &app,
        &state,
        conversation_id.trim(),
        &message,
        pid,
        pending_image,
    )
    .await?;

    let engine = state.llm.read().await.clone();
    let info = engine.model_info();
    Ok(ChatSendResult {
        reply,
        tool_calls: Vec::<ToolCall>::new(),
        provider_id: info.provider_id,
        model_id: info.model_id,
    })
}

#[tauri::command]
pub async fn chat_vision_supported(state: State<'_, NovaState>) -> Result<bool, String> {
    let engine = state.llm.read().await.clone();
    let info = engine.model_info();
    Ok(model_supports_vision(&info.provider_id, &info.model_id))
}
