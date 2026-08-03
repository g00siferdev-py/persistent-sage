//! Agent tool for on-demand memory recall (keyword + optional semantic).

use std::time::Duration;

use serde_json::{json, Value};
use thiserror::Error;

use crate::embedding;
use crate::memory::{ConversationMemory, MemoryRecallBundle, MessageRole};
use crate::provider::{ProviderError, ToolDefinition};
use crate::settings::SettingsManager;

#[derive(Debug, Error)]
pub enum MemoryToolError {
    #[error("{0}")]
    Msg(String),
}

impl From<MemoryToolError> for ProviderError {
    fn from(e: MemoryToolError) -> Self {
        ProviderError::Api(e.to_string())
    }
}

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![ToolDefinition {
        name: "memory_search".into(),
        description: Some(
            "Search THIS companion profile's Memory Anchors (plus shared project anchors). \
             Use for the user's facts, preferences, and prior context from this agent. \
             Returns matching anchors and related past messages. Read-only."
                .into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language search query (what to look up in memory)"
                },
                "conversation_id": {
                    "type": "string",
                    "description": "Optional thread id to prefer thread-scoped anchors; omit for profile-wide search"
                },
                "anchor_limit": {
                    "type": "integer",
                    "description": "Max anchors to return (default 12, max 24)"
                },
                "message_limit": {
                    "type": "integer",
                    "description": "Max related past messages (default 8, max 16)"
                }
            },
            "required": ["query"]
        }),
    }]
}

/// Exclusive to the global Email Agent — full read-only search across every companion profile.
pub fn email_agent_tool_definitions() -> Vec<ToolDefinition> {
    vec![ToolDefinition {
        name: "memory_search_all".into(),
        description: Some(
            "Email Agent only: read-only search of Memory Anchors across ALL companion/coding agents \
             (every personality profile), plus shared anchors. Use when composing external correspondence \
             that may need facts another agent learned. Does not create or modify anchors."
                .into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language search across all agents' memories"
                },
                "anchor_limit": {
                    "type": "integer",
                    "description": "Max anchors total (default 16, max 32)"
                },
                "message_limit": {
                    "type": "integer",
                    "description": "Max related messages total (default 8, max 16)"
                }
            },
            "required": ["query"]
        }),
    }]
}

pub fn memory_system_hint() -> &'static str {
    "\n\n**Memory:** For questions about the user's past facts, preferences, or earlier conversations, \
     use **Memory Search** (`memory_search`) with a focused query before answering. Do not guess if memory may contain the answer. \
     This search is limited to the active companion profile (plus shared project anchors)."
}

pub fn email_agent_memory_system_hint() -> &'static str {
    "\n\n**Email Agent memory:** You alone may use **Memory Search All Agents** (`memory_search_all`) — \
     a read-only full search of every companion's Memory Anchors when correspondence needs cross-agent context. \
     Prefer `correspondence_sync` for relationship state; use `memory_search_all` for deep facts other agents stored. \
     Never invent memories. You cannot write/modify anchors via this tool."
}

#[must_use]
pub fn format_recall_for_prompt(bundle: &MemoryRecallBundle, max_chars: usize) -> String {
    let mut out = String::new();
    if !bundle.anchors.is_empty() {
        out.push_str("**Anchors**\n");
        for a in &bundle.anchors {
            out.push_str(&format!(
                "- [{}] (importance {}): {}\n",
                a.anchor_type, a.importance, a.content
            ));
        }
        out.push('\n');
    }
    if !bundle.messages.is_empty() {
        out.push_str("**Related past messages**\n");
        for m in &bundle.messages {
            let label = match m.role {
                MessageRole::User => "User",
                MessageRole::Assistant => "Assistant",
            };
            let snippet: String = m.content.chars().take(200).collect();
            let thread = match (&m.conversation_title, &m.conversation_id) {
                (Some(title), _) if !title.trim().is_empty() => format!(" [thread: {title}]"),
                (_, Some(id)) if !id.trim().is_empty() => format!(" [thread id: {id}]"),
                _ => String::new(),
            };
            out.push_str(&format!("- **{label}**{thread}: {snippet}\n"));
        }
    }
    if out.is_empty() {
        return "No matching memories found.".into();
    }
    if out.chars().count() > max_chars {
        out.chars()
            .take(max_chars.saturating_sub(1))
            .collect::<String>()
            + "…"
    } else {
        out
    }
}

pub async fn run_memory_search(
    http: &reqwest::Client,
    settings: &SettingsManager,
    memory: &dyn ConversationMemory,
    args: &Value,
) -> Result<String, MemoryToolError> {
    let query = args["query"].as_str().unwrap_or("").trim();
    if query.is_empty() {
        return Err(MemoryToolError::Msg(
            "memory_search requires a non-empty query".into(),
        ));
    }
    let scope = args["conversation_id"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let anchor_limit = args["anchor_limit"]
        .as_u64()
        .map(|n| n as usize)
        .unwrap_or(12)
        .clamp(1, 24);
    let message_limit = args["message_limit"]
        .as_u64()
        .map(|n| n as usize)
        .unwrap_or(8)
        .clamp(0, 16);

    let query_emb = if settings.memory_semantic_enabled() {
        match embedding::resolve_embedding_spec(settings) {
            Ok(spec) => {
                const EMBED_TIMEOUT: Duration = Duration::from_secs(12);
                match tokio::time::timeout(EMBED_TIMEOUT, embedding::embed_one(http, &spec, query))
                    .await
                {
                    Ok(Ok(v)) => Some(v),
                    Ok(Err(e)) => {
                        eprintln!("persistent-sage: memory_search embed failed: {e}");
                        None
                    }
                    Err(_) => {
                        eprintln!("persistent-sage: memory_search embed timed out after {EMBED_TIMEOUT:?}");
                        None
                    }
                }
            }
            Err(e) => {
                eprintln!("persistent-sage: memory_search embed skipped: {e}");
                None
            }
        }
    } else {
        None
    };

    let bundle = memory
        .memory_recall(
            query,
            scope,
            anchor_limit,
            message_limit,
            query_emb.as_deref(),
        )
        .map_err(|e| MemoryToolError::Msg(e.to_string()))?;

    Ok(format_recall_for_prompt(&bundle, 6_000))
}

/// Read-only recall across every personality profile (Email Agent exclusive).
pub async fn run_memory_search_all(
    http: &reqwest::Client,
    settings: &SettingsManager,
    memory: &dyn ConversationMemory,
    args: &Value,
) -> Result<String, MemoryToolError> {
    let query = args["query"].as_str().unwrap_or("").trim();
    if query.is_empty() {
        return Err(MemoryToolError::Msg(
            "memory_search_all requires a non-empty query".into(),
        ));
    }
    let anchor_limit = args["anchor_limit"]
        .as_u64()
        .map(|n| n as usize)
        .unwrap_or(16)
        .clamp(1, 32);
    let message_limit = args["message_limit"]
        .as_u64()
        .map(|n| n as usize)
        .unwrap_or(8)
        .clamp(0, 16);

    let query_emb = if settings.memory_semantic_enabled() {
        match embedding::resolve_embedding_spec(settings) {
            Ok(spec) => {
                const EMBED_TIMEOUT: Duration = Duration::from_secs(12);
                match tokio::time::timeout(EMBED_TIMEOUT, embedding::embed_one(http, &spec, query))
                    .await
                {
                    Ok(Ok(v)) => Some(v),
                    Ok(Err(e)) => {
                        eprintln!("persistent-sage: memory_search_all embed failed: {e}");
                        None
                    }
                    Err(_) => {
                        eprintln!(
                            "persistent-sage: memory_search_all embed timed out after {EMBED_TIMEOUT:?}"
                        );
                        None
                    }
                }
            }
            Err(e) => {
                eprintln!("persistent-sage: memory_search_all embed skipped: {e}");
                None
            }
        }
    } else {
        None
    };

    let personalities = memory
        .list_personality_ids_for_recall()
        .map_err(|e| MemoryToolError::Msg(e.to_string()))?;
    if personalities.is_empty() {
        return Ok("No agent memories found.".into());
    }

    let prev = memory.active_personality_id();
    let per_agent_anchors = ((anchor_limit + personalities.len() - 1) / personalities.len()).max(4);
    let per_agent_messages = if message_limit == 0 {
        0
    } else {
        ((message_limit + personalities.len() - 1) / personalities.len()).max(2)
    };

    let mut out = String::from(
        "**Cross-agent memory search (read-only)**\n\
         Results from every companion profile. Do not treat this as permission to write anchors.\n\n",
    );
    let mut any = false;

    for pid in &personalities {
        memory.set_active_personality(pid);
        let bundle = memory
            .memory_recall(
                query,
                None,
                per_agent_anchors.min(24),
                per_agent_messages.min(16),
                query_emb.as_deref(),
            )
            .map_err(|e| {
                memory.set_active_personality(&prev);
                MemoryToolError::Msg(e.to_string())
            })?;
        if bundle.anchors.is_empty() && bundle.messages.is_empty() {
            continue;
        }
        any = true;
        let label = if pid == crate::memory::SHARED_PERSONALITY_ID {
            "shared".to_string()
        } else {
            pid.clone()
        };
        out.push_str(&format!("### Agent profile: {label}\n"));
        out.push_str(&format_recall_for_prompt(&bundle, 2_500));
        out.push_str("\n\n");
    }

    memory.set_active_personality(&prev);

    if !any {
        return Ok("No matching memories across agents.".into());
    }
    if out.chars().count() > 8_000 {
        out = out.chars().take(7_999).collect::<String>() + "…";
    }
    Ok(out)
}
