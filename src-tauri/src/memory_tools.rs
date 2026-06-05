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
            "Search Persistent Sage's long-term Memory Anchor database (facts, preferences, past threads). \
             Use when the user asks about something you should remember from earlier chats, \
             their preferences, health, projects, or prior context. Returns matching anchors \
             and related past messages."
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
                    "description": "Optional thread id to prefer thread-scoped anchors; omit for global search"
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

pub fn memory_system_hint() -> &'static str {
    "\n\n**Memory:** For questions about the user's past facts, preferences, or earlier conversations, \
     use **Memory Search** (invoke as `memory_search`) with a focused query before answering. Do not guess if memory may contain the answer. \
     Persistent Sage **project** anchors (`[project:slug] …`) are shared across all companion profiles."
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
