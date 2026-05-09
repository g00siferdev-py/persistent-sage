//! Chat send pipeline: MemoryAnchor context, settings-backed LLM, streamed assistant reply.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::memory::MessageRole;
use crate::provider::{
    build_engine, ChatSendResult, ChatTurn, CompletionRequest, LLMProviderEngine, ProviderError,
    StreamChunk, ToolCall,
};
use crate::NovaState;

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

#[tauri::command]
pub async fn chat_send_message(
    app: AppHandle,
    state: State<'_, NovaState>,
    conversation_id: String,
    message: String,
) -> Result<ChatSendResult, String> {
    let content = message.trim().to_string();
    if content.is_empty() {
        return Err("message content is empty".into());
    }

    state
        .memory
        .store_message(&conversation_id, MessageRole::User, &content)
        .map_err(|e| e.to_string())?;

    let engine: std::sync::Arc<dyn LLMProviderEngine + Send + Sync> =
        match build_engine(&state.http, &state.settings) {
            Ok(e) => {
                *state.llm.write().await = e.clone();
                e
            }
            Err(e) => return Err(e.to_string()),
        };

    let _ = app.emit(
        "chat:stream-start",
        ChatStreamStart {
            conversation_id: conversation_id.clone(),
        },
    );

    let briefing = state
        .memory
        .get_startup_briefing(&conversation_id)
        .map_err(|e| e.to_string())?;

    let recent = state
        .memory
        .get_recent(&conversation_id, 48)
        .map_err(|e| e.to_string())?;

    let persona = state.personality.system_prompt_prefix();
    let system_content = {
        let p = persona.trim();
        if p.is_empty() {
            briefing
        } else {
            format!("{p}\n\n---\n\n# Memory & session context\n\n{briefing}")
        }
    };

    let mut messages: Vec<ChatTurn> = Vec::with_capacity(recent.len() + 1);
    messages.push(ChatTurn {
        role: "system".into(),
        content: system_content,
    });
    for m in recent {
        let role = match m.role {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
        };
        messages.push(ChatTurn {
            role: role.into(),
            content: m.content,
        });
    }

    let req = CompletionRequest {
        messages,
        tools: None,
        max_tokens: state.settings.max_tokens(),
        temperature: Some(state.settings.temperature()),
    };

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<StreamChunk, ProviderError>>(64);
    let engine_clone = engine.clone();
    let send_task = tokio::spawn(async move { engine_clone.stream(&req, tx).await });

    let mut full = String::new();
    let mut saw_done = false;

    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => {
                if !chunk.delta.is_empty() {
                    full.push_str(&chunk.delta);
                    let _ = app.emit(
                        "chat:stream",
                        ChatStreamEvent {
                            conversation_id: conversation_id.clone(),
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
                            conversation_id: conversation_id.clone(),
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
                conversation_id: conversation_id.clone(),
                delta: String::new(),
                done: true,
            },
        );
    }

    let mut reply = full;
    if reply.trim().is_empty() {
        reply = "(no text in model response)".into();
    }

    state
        .memory
        .store_message(&conversation_id, MessageRole::Assistant, &reply)
        .map_err(|e| e.to_string())?;

    let info = engine.model_info();
    Ok(ChatSendResult {
        reply,
        tool_calls: Vec::<ToolCall>::new(),
        provider_id: info.provider_id,
        model_id: info.model_id,
    })
}
