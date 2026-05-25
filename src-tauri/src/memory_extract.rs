//! LLM-based memory extraction → curated anchors + embeddings.

use serde::Deserialize;

use crate::embedding;
use crate::memory::{AnchorType, ConversationMemory, MessageRole};
use crate::provider::{build_engine, ChatTurn, CompletionRequest};
use crate::settings::SettingsManager;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex as AsyncMutex;

/// One background memory pipeline at a time (extraction + embed) to reduce SQLite lock contention.
static MEMORY_PIPELINE: OnceLock<AsyncMutex<()>> = OnceLock::new();

fn memory_pipeline_lock() -> &'static AsyncMutex<()> {
    MEMORY_PIPELINE.get_or_init(|| AsyncMutex::new(()))
}

/// Max anchors to embed per background job (avoids blocking the UI on large backlogs).
const EMBED_MAX_PER_RUN: usize = 24;
const EMBED_BATCH_SIZE: usize = 8;

/// LLM extraction + embedding after a user message — runs off the chat hot path.
pub fn spawn_post_message_memory(
    http: reqwest::Client,
    settings: Arc<SettingsManager>,
    memory: Arc<dyn ConversationMemory + Send + Sync>,
    conversation_id: String,
    user_text: String,
) {
    if user_text.trim().is_empty() {
        return;
    }
    tokio::spawn(async move {
        let _guard = memory_pipeline_lock().lock().await;
        process_user_memory_turn(
            &http,
            &settings,
            memory.as_ref(),
            &conversation_id,
            &user_text,
        )
        .await;
    });
}

#[derive(Debug, Deserialize)]
struct ExtractResponse {
    #[serde(default)]
    memories: Vec<ExtractedMemoryItem>,
}

#[derive(Debug, Deserialize)]
struct ExtractedMemoryItem {
    #[serde(rename = "type", default = "default_memory_type")]
    memory_type: String,
    content: String,
    #[serde(default = "default_importance")]
    importance: i32,
    #[serde(default = "default_scope")]
    scope: String,
}

fn default_memory_type() -> String {
    "fact".into()
}

fn default_importance() -> i32 {
    3
}

fn default_scope() -> String {
    "global".into()
}

fn parse_anchor_type(s: &str) -> AnchorType {
    match s.trim().to_lowercase().as_str() {
        "insight" => AnchorType::Insight,
        "curated" => AnchorType::Curated,
        "raw" => AnchorType::Raw,
        _ => AnchorType::Fact,
    }
}

fn strip_json_fence(s: &str) -> &str {
    let t = s.trim();
    if t.starts_with("```") {
        let inner = t
            .trim_start_matches("```json")
            .trim_start_matches("```JSON")
            .trim_start_matches("```");
        inner.trim_end_matches("```").trim()
    } else {
        t
    }
}

const EXTRACT_SYSTEM: &str = r#"You extract durable user-specific memories for a long-term companion database.
Return ONLY valid JSON (no markdown): {"memories":[{"type":"fact|insight|curated","content":"...","importance":1-5,"scope":"global|thread"}]}
Rules:
- Store stable facts about the user (health, preferences, relationships, projects, accessibility needs).
- Do NOT store greetings, filler, or one-off questions.
- Each content string is one concise fact (under 200 characters).
- Use scope "global" for facts that apply across all chats; "thread" only for topic-specific context.
- If nothing worth storing, return {"memories":[]}."#;

/// Run LLM extraction and persist anchors; embed when semantic memory is enabled.
pub async fn process_user_memory_turn(
    http: &reqwest::Client,
    settings: &SettingsManager,
    memory: &dyn ConversationMemory,
    conversation_id: &str,
    user_text: &str,
) {
    let provider = settings.selected_provider();

    match memory.ingest_user_message_anchors(conversation_id, user_text) {
        Ok(ids) if !ids.is_empty() => {
            eprintln!(
                "persistent-sage: deterministic memory ingest stored {} raw anchor(s)",
                ids.len()
            );
        }
        Ok(_) => {}
        Err(e) => eprintln!("persistent-sage: deterministic memory ingest failed: {e}"),
    }

    if provider != "placeholder" && settings.memory_llm_extraction_enabled() {
        match extract_and_store(http, settings, memory, conversation_id, user_text).await {
            Ok(n) if n > 0 => eprintln!("persistent-sage: LLM memory extract stored {n} anchor(s)"),
            Ok(_) => {}
            Err(e) => eprintln!("persistent-sage: LLM memory extract failed: {e}"),
        }
    }

    if provider != "placeholder" && settings.memory_semantic_enabled() {
        if let Err(e) = embed_pending_anchors(http, settings, memory, EMBED_MAX_PER_RUN).await {
            eprintln!("persistent-sage: embedding anchors failed: {e}");
        }
    }
}

async fn extract_and_store(
    http: &reqwest::Client,
    settings: &SettingsManager,
    memory: &dyn ConversationMemory,
    conversation_id: &str,
    user_text: &str,
) -> Result<usize, String> {
    let engine = build_engine(http, settings).map_err(|e| e.to_string())?;
    if engine.provider_id() == "placeholder" {
        return Ok(0);
    }

    let recent = memory
        .get_recent(conversation_id, 8)
        .map_err(|e| e.to_string())?;
    let mut context = String::new();
    for m in recent.iter().filter(|m| m.role == MessageRole::User) {
        let snip: String = m.content.chars().take(300).collect();
        context.push_str(&format!("User: {snip}\n"));
    }

    let user_block =
        format!("Recent thread context:\n{context}\nLatest user message:\n{user_text}");

    let req = CompletionRequest {
        messages: vec![
            ChatTurn::text("system", EXTRACT_SYSTEM),
            ChatTurn::text("user", user_block),
        ],
        tools: None,
        max_tokens: Some(600),
        temperature: Some(0.1),
        thinking_effort: None,
    };

    let resp = engine.complete(&req).await.map_err(|e| e.to_string())?;

    let json_str = strip_json_fence(&resp.content);
    let parsed: ExtractResponse = serde_json::from_str(json_str).map_err(|e| {
        format!(
            "memory extract JSON parse: {e}; model said: {}",
            resp.content.chars().take(200).collect::<String>()
        )
    })?;

    let mut stored = 0usize;
    for item in parsed.memories {
        let content = item.content.trim();
        if content.chars().count() < 8 {
            continue;
        }
        let ty = parse_anchor_type(&item.memory_type);
        let importance = item.importance.clamp(1, 5);
        let scope_global = item.scope.trim().eq_ignore_ascii_case("global");
        let conv_scope = if scope_global {
            None
        } else {
            Some(conversation_id)
        };

        match memory.upsert_memory_anchor(conv_scope, ty, content, importance) {
            Ok(id) => {
                stored += 1;
                eprintln!(
                    "persistent-sage: memory extract anchor {id} ({importance}): {}",
                    content.chars().take(80).collect::<String>()
                );
            }
            Err(e) => eprintln!("persistent-sage: upsert memory anchor: {e}"),
        }
    }
    Ok(stored)
}

async fn embed_pending_anchors(
    http: &reqwest::Client,
    settings: &SettingsManager,
    memory: &dyn ConversationMemory,
    max_anchors: usize,
) -> Result<(), String> {
    let spec = embedding::resolve_embedding_spec(settings).map_err(|e| e.to_string())?;
    let pending = memory
        .list_anchors_without_embedding(max_anchors)
        .map_err(|e| e.to_string())?;
    if pending.is_empty() {
        return Ok(());
    }

    let mut embedded_total = 0usize;
    for chunk in pending.chunks(EMBED_BATCH_SIZE) {
        let texts: Vec<String> = chunk.iter().map(|a| a.content.clone()).collect();
        let vectors = embedding::embed_texts(http, &spec, &texts)
            .await
            .map_err(|e| e.to_string())?;
        for (anchor, vec) in chunk.iter().zip(vectors.iter()) {
            let blob = embedding::serialize_embedding(vec);
            memory
                .set_anchor_embedding(&anchor.id, &blob, &spec.model)
                .map_err(|e| e.to_string())?;
            embedded_total += 1;
        }
    }
    eprintln!(
        "persistent-sage: embedded {embedded_total} anchor(s) with model {} (batch size {EMBED_BATCH_SIZE})",
        spec.model
    );
    Ok(())
}

/// Re-embed all anchors for the active personality (settings model change / backfill).
pub async fn reindex_all_embeddings(
    http: &reqwest::Client,
    settings: &SettingsManager,
    memory: &dyn ConversationMemory,
) -> Result<u32, String> {
    memory.clear_all_embeddings().map_err(|e| e.to_string())?;
    loop {
        embed_pending_anchors(http, settings, memory, 32).await?;
        if memory
            .list_anchors_without_embedding(1)
            .map_err(|e| e.to_string())?
            .is_empty()
        {
            break;
        }
    }
    let n = memory
        .count_anchors_with_embedding()
        .map_err(|e| e.to_string())?;
    Ok(n)
}
