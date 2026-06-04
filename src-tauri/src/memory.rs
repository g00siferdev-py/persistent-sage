//! Persistent conversation memory for Persistent Sage.
//!
//! ## Memory Anchor model (raw + curated)
//!
//! - **Raw layer** — [`AnchorType::Raw`]: snippets from chat via per-message ingest and
//!   optional **Extract raw anchors** (bulk backfill for the active thread).
//! - **Curated layer** — [`AnchorType::Curated`], [`AnchorType::Fact`],
//!   [`AnchorType::Insight`]: user- or model-confirmed anchors worth recalling
//!   across sessions. Higher [`importance`] surfaces first in briefings.
//!
//! Chat transcripts live in `messages`; long-term recall uses `anchors`,
//! `projects`, and `preferences`. **Hybrid recall** combines FTS5 full-text
//! ranking with keyword `LIKE`, optional message hits, and cosine similarity when
//! [`embedding`] blobs are populated (see `embedding` + `memory_extract` modules).
//!
//! **Storage:** SQLite `TEXT` columns (e.g. `anchors.content`) are not limited to
//! 255 characters. Any fixed cap you see in **raw anchor extraction** is from
//! heuristics in [`MemoryAnchor::create_anchor_from_conversation`], not the schema.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

// --- Public data types --------------------------------------------------------

/// Who produced a stored message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
}

impl MessageRole {
    const fn as_db_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }

    fn parse_db(s: &str) -> Result<Self, MemoryError> {
        match s {
            "user" => Ok(Self::User),
            "assistant" => Ok(Self::Assistant),
            other => Err(MemoryError::InvalidRole(other.to_string())),
        }
    }
}

/// Long-term anchor classification (raw vs curated spectrum).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorType {
    /// Heuristic / auto-captured from conversation (ephemeral quality).
    Raw,
    /// User-approved or editor-refined anchor.
    Curated,
    /// Atomic factual claim.
    Fact,
    /// Higher-level takeaway.
    Insight,
}

impl AnchorType {
    fn as_db_str(self) -> &'static str {
        match self {
            Self::Raw => "raw",
            Self::Curated => "curated",
            Self::Fact => "fact",
            Self::Insight => "insight",
        }
    }

    fn parse_db(s: &str) -> Result<Self, MemoryError> {
        match s {
            "raw" => Ok(Self::Raw),
            "curated" => Ok(Self::Curated),
            "fact" => Ok(Self::Fact),
            "insight" => Ok(Self::Insight),
            other => Err(MemoryError::InvalidAnchorType(other.to_string())),
        }
    }
}

/// One row from the `messages` table, safe to return to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: i64,
    pub role: MessageRole,
    pub content: String,
    pub created_at: String,
    /// Relative path under the Persistent Sage data directory (`attachments/...`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_attachment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_mime: Option<String>,
    /// Absolute path for the webview (`convertFileSrc`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_display_path: Option<String>,
    /// Serialized [`crate::artifacts::ChatArtifact`] JSON when the assistant returned an artifact block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_json: Option<String>,
    /// Set when a row is returned from cross-thread recall (`memory_recall` with global scope).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_title: Option<String>,
}

/// A chat thread row for the sidebar and detail views.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

/// A durable memory anchor for recall and briefings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAnchor {
    pub id: String,
    pub conversation_id: Option<String>,
    pub anchor_type: String,
    pub content: String,
    pub importance: i32,
    pub has_embedding: bool,
    pub created_at: String,
}

/// User-defined project context (roadmap / workstream).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub created_at: String,
}

/// Result of [`ConversationMemory::memory_recall`] (FTS + keyword + scoped messages).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecallBundle {
    pub anchors: Vec<StoredAnchor>,
    pub messages: Vec<StoredMessage>,
}

/// Prepared recall query: primary tokens + rule-based associative expansions for FTS/LIKE.
#[derive(Debug, Clone)]
struct RecallQueryExpansion {
    primary: Vec<String>,
    expanded: Vec<String>,
    fts_terms: Vec<String>,
    message_terms: Vec<String>,
}

// --- Errors -------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum MemoryError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),

    #[error("invalid message role in database: {0}")]
    InvalidRole(String),

    #[error("invalid anchor type: {0}")]
    InvalidAnchorType(String),

    #[error("could not resolve application data directory")]
    NoDataDir,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error("memory store lock poisoned")]
    LockPoisoned,

    #[error("unknown conversation: {0}")]
    UnknownConversation(String),
}

// --- Trait --------------------------------------------------------------------

pub trait ConversationMemory: Send + Sync {
    fn store_message(
        &self,
        conversation_id: &str,
        role: MessageRole,
        content: &str,
        image_attachment: Option<&str>,
        image_mime: Option<&str>,
        artifact_json: Option<&str>,
    ) -> Result<(), MemoryError>;

    fn get_recent(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredMessage>, MemoryError>;

    /// Rich briefing: recent transcript + anchors + projects + preferences.
    fn get_startup_briefing(
        &self,
        conversation_id: &str,
        assistant_label: &str,
    ) -> Result<String, MemoryError>;

    /// Recomputes the rich briefing (same output as [`Self::get_startup_briefing`]).
    fn update_startup_briefing(
        &self,
        conversation_id: &str,
        assistant_label: &str,
    ) -> Result<String, MemoryError>;

    fn list_conversations(&self) -> Result<Vec<StoredConversation>, MemoryError>;

    fn get_conversation(&self, conversation_id: &str) -> Result<StoredConversation, MemoryError>;

    fn create_conversation(&self, title: &str) -> Result<String, MemoryError>;

    fn rename_conversation(&self, conversation_id: &str, title: &str) -> Result<(), MemoryError>;

    /// Deletes a thread and its messages (CASCADE). Anchors for this thread become `NULL` or are removed per schema.
    fn delete_conversation(&self, conversation_id: &str) -> Result<(), MemoryError>;

    /// Insert one anchor (`conversation_id` None = global).
    fn create_anchor(
        &self,
        conversation_id: Option<&str>,
        anchor_type: AnchorType,
        content: &str,
        importance: i32,
    ) -> Result<String, MemoryError>;

    /// Derives **raw** anchors from recent user turns (deterministic; replace with LLM later).
    fn create_anchor_from_conversation(
        &self,
        conversation_id: &str,
        max_anchors: usize,
    ) -> Result<Vec<String>, MemoryError>;

    /// After each user message: raw anchors on this thread + duplicate global anchors for cross-session recall.
    fn ingest_user_message_anchors(
        &self,
        conversation_id: &str,
        content: &str,
    ) -> Result<Vec<String>, MemoryError>;

    /// Keyword recall; optional scope to one thread (plus always matches global anchors).
    fn recall_anchors(
        &self,
        query: &str,
        scope_conversation_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError>;

    /// Hybrid FTS5 + keyword + optional semantic (cosine) recall over anchors.
    fn memory_recall(
        &self,
        query: &str,
        scope_conversation_id: Option<&str>,
        anchor_limit: usize,
        message_limit: usize,
        query_embedding: Option<&[f32]>,
    ) -> Result<MemoryRecallBundle, MemoryError>;

    /// Insert or skip duplicate memory (exact content match on scope).
    fn upsert_memory_anchor(
        &self,
        conversation_id: Option<&str>,
        anchor_type: AnchorType,
        content: &str,
        importance: i32,
    ) -> Result<String, MemoryError>;

    fn set_anchor_embedding(
        &self,
        anchor_id: &str,
        embedding_blob: &[u8],
        model_label: &str,
    ) -> Result<(), MemoryError>;

    fn list_anchors_without_embedding(
        &self,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError>;

    fn clear_all_embeddings(&self) -> Result<(), MemoryError>;

    fn count_anchors_with_embedding(&self) -> Result<u32, MemoryError>;

    /// Anchors for briefing / sidebar: this thread + global, by importance.
    fn list_anchors_for_thread(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError>;

    fn list_projects(&self, limit: usize) -> Result<Vec<StoredProject>, MemoryError>;

    /// Key-value prefs (e.g. `nova.provider.active`, API keys — encrypt at rest in a later milestone).
    fn preference_get(&self, key: &str) -> Result<Option<String>, MemoryError>;

    fn preference_set(&self, key: &str, value: &str) -> Result<(), MemoryError>;

    /// Remove a preference row (e.g. after migrating secrets to encrypted settings).
    fn preference_delete(&self, key: &str) -> Result<(), MemoryError>;

    /// Scope subsequent list/create/recall operations to this companion profile id (`default` if empty).
    fn set_active_personality(&self, personality_id: &str);

    /// Upsert a global project anchor visible to all companion profiles.
    fn upsert_project_anchor(&self, project_id: &str, title: &str) -> Result<String, MemoryError>;

    /// Deletes all conversations, messages, anchors, projects, and preferences; re-seeds the default thread.
    fn wipe_all_user_data(&self) -> Result<(), MemoryError>;
}

// --- Schema / migration -------------------------------------------------------

const SCHEMA_VERSION: i32 = 7;

/// SQLite value for legacy rows and the built-in profile id in `personality.json`.
pub const DEFAULT_PERSONALITY_ID: &str = "default";

/// Cross-companion anchors (OpenSage projects, shared facts). Visible to every personality at recall.
pub const SHARED_PERSONALITY_ID: &str = "__shared__";

fn is_global_anchor_content(content: &str) -> bool {
    let t = content.trim();
    t.starts_with("[project:") || t.starts_with("[shared]")
}

fn resolve_anchor_personality_and_content(active_pid: &str, content: &str) -> (String, String) {
    let trimmed = content.trim().to_string();
    if is_global_anchor_content(&trimmed) {
        (SHARED_PERSONALITY_ID.to_string(), trimmed)
    } else {
        (active_pid.to_string(), trimmed)
    }
}

const BRIEFING_MESSAGE_WINDOW: usize = 24;
const BRIEFING_SNIPPET_CHARS: usize = 280;
const BRIEFING_MAX_ANCHORS: usize = 12;
const BRIEFING_MAX_PROJECTS: usize = 8;
const BRIEFING_MAX_PREFS: usize = 12;

/// Minimum user-snippet length (**Unicode characters**) for heuristic raw-anchor extraction.
const ANCHOR_EXTRACT_MIN_CHARS: usize = 12;
/// Maximum characters per raw anchor from extraction (SQLite itself has no such cap).
const ANCHOR_EXTRACT_MAX_CHARS: usize = 16_384;
/// Cap auto-ingest per user turn so chat stays responsive.
const AUTO_INGEST_MAX_PER_MESSAGE: usize = 4;

/// Split `s` into substrings of at most `max_chars` Unicode scalars (final chunk may be shorter).
fn chunk_text_by_max_chars(s: &str, max_chars: usize) -> Vec<String> {
    if max_chars == 0 {
        return vec![];
    }
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut count = 0usize;
    for ch in s.chars() {
        if count >= max_chars {
            out.push(std::mem::take(&mut buf));
            count = 0;
        }
        buf.push(ch);
        count += 1;
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

/// Turn recent user text into anchor-sized candidates (sentence-ish splits + long-chunk folding).
fn anchor_candidates_from_user_message(content: &str) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    for part in content.split(|c| matches!(c, '\n' | '.' | '?' | '!' | ';')) {
        let s = part.trim();
        if s.chars().count() < ANCHOR_EXTRACT_MIN_CHARS {
            continue;
        }
        if s.chars().count() <= ANCHOR_EXTRACT_MAX_CHARS {
            candidates.push(s.to_string());
        } else {
            for chunk in chunk_text_by_max_chars(s, ANCHOR_EXTRACT_MAX_CHARS) {
                if chunk.chars().count() >= ANCHOR_EXTRACT_MIN_CHARS {
                    candidates.push(chunk);
                }
            }
        }
    }
    candidates
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn column_exists(conn: &Connection, table: &str, col: &str) -> Result<bool, rusqlite::Error> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&pragma)?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == col {
            return Ok(true);
        }
    }
    Ok(false)
}

fn migrate_schema(conn: &Connection) -> Result<(), MemoryError> {
    let mut ver: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if ver >= SCHEMA_VERSION {
        migrate_message_image_columns(conn)?;
        migrate_message_artifact_column(conn)?;
        ensure_seed_conversation(conn)?;
        return Ok(());
    }

    if ver < 2 {
        let messages_exists = table_exists(conn, "messages")?;
        if !messages_exists {
            create_fresh_current(conn)?;
        } else if !column_exists(conn, "messages", "conversation_id")? {
            migrate_legacy_messages(conn)?;
        } else {
            conn.execute_batch(
                r"CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
                );",
            )?;
        }
        ensure_seed_conversation(conn)?;
        conn.pragma_update(None, "user_version", 2)?;
        ver = 2;
    }

    if ver < 3 {
        if !column_exists(conn, "conversations", "created_at")? {
            migrate_add_conversation_created_at(conn)?;
        }
        ensure_seed_conversation(conn)?;
        conn.pragma_update(None, "user_version", 3)?;
    }

    ensure_memory_anchor_tables(conn)?;
    if ver < 5 {
        migrate_fts5_index(conn)?;
    }
    if ver < 6 {
        migrate_personality_isolation(conn)?;
    }
    migrate_message_image_columns(conn)?;
    migrate_message_artifact_column(conn)?;
    ensure_seed_conversation(conn)?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn migrate_message_artifact_column(conn: &Connection) -> Result<(), MemoryError> {
    if table_exists(conn, "messages")? && !column_exists(conn, "messages", "artifact_json")? {
        conn.execute("ALTER TABLE messages ADD COLUMN artifact_json TEXT", [])?;
    }
    Ok(())
}

/// FTS5 shadow index + triggers for hybrid anchor recall.
fn migrate_fts5_index(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r"CREATE VIRTUAL TABLE IF NOT EXISTS anchors_fts USING fts5(
            content,
            anchor_id UNINDEXED,
            conversation_id UNINDEXED,
            anchor_type UNINDEXED,
            importance UNINDEXED,
            created_at UNINDEXED,
            tokenize = 'porter unicode61'
        );

        DROP TRIGGER IF EXISTS anchors_ai_fts;
        DROP TRIGGER IF EXISTS anchors_au_fts;
        DROP TRIGGER IF EXISTS anchors_ad_fts;

        CREATE TRIGGER anchors_ai_fts AFTER INSERT ON anchors BEGIN
            INSERT INTO anchors_fts(content, anchor_id, conversation_id, anchor_type, importance, created_at)
            VALUES (new.content, new.id, new.conversation_id, new.anchor_type, new.importance, new.created_at);
        END;

        CREATE TRIGGER anchors_au_fts AFTER UPDATE ON anchors BEGIN
            DELETE FROM anchors_fts WHERE anchor_id = old.id;
            INSERT INTO anchors_fts(content, anchor_id, conversation_id, anchor_type, importance, created_at)
            VALUES (new.content, new.id, new.conversation_id, new.anchor_type, new.importance, new.created_at);
        END;

        CREATE TRIGGER anchors_ad_fts AFTER DELETE ON anchors BEGIN
            DELETE FROM anchors_fts WHERE anchor_id = old.id;
        END;",
    )?;

    let fts_count: i64 = conn.query_row("SELECT COUNT(*) FROM anchors_fts", [], |r| r.get(0))?;
    if fts_count == 0 {
        conn.execute(
            "INSERT INTO anchors_fts(content, anchor_id, conversation_id, anchor_type, importance, created_at)
             SELECT content, id, conversation_id, anchor_type, importance, created_at FROM anchors",
            [],
        )?;
    }
    Ok(())
}

/// Rebuild FTS shadow table and triggers to include `personality_id` (v6+).
fn rebuild_anchors_fts_with_personality(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r"DROP TRIGGER IF EXISTS anchors_ai_fts;
        DROP TRIGGER IF EXISTS anchors_au_fts;
        DROP TRIGGER IF EXISTS anchors_ad_fts;
        DROP TABLE IF EXISTS anchors_fts;

        CREATE VIRTUAL TABLE anchors_fts USING fts5(
            content,
            anchor_id UNINDEXED,
            conversation_id UNINDEXED,
            anchor_type UNINDEXED,
            importance UNINDEXED,
            created_at UNINDEXED,
            personality_id UNINDEXED,
            tokenize = 'porter unicode61'
        );

        CREATE TRIGGER anchors_ai_fts AFTER INSERT ON anchors BEGIN
            INSERT INTO anchors_fts(content, anchor_id, conversation_id, anchor_type, importance, created_at, personality_id)
            VALUES (new.content, new.id, new.conversation_id, new.anchor_type, new.importance, new.created_at, new.personality_id);
        END;

        CREATE TRIGGER anchors_au_fts AFTER UPDATE ON anchors BEGIN
            DELETE FROM anchors_fts WHERE anchor_id = old.id;
            INSERT INTO anchors_fts(content, anchor_id, conversation_id, anchor_type, importance, created_at, personality_id)
            VALUES (new.content, new.id, new.conversation_id, new.anchor_type, new.importance, new.created_at, new.personality_id);
        END;

        CREATE TRIGGER anchors_ad_fts AFTER DELETE ON anchors BEGIN
            DELETE FROM anchors_fts WHERE anchor_id = old.id;
        END;",
    )?;
    if table_exists(conn, "anchors")? {
        conn.execute(
            "INSERT INTO anchors_fts(content, anchor_id, conversation_id, anchor_type, importance, created_at, personality_id)
             SELECT content, id, conversation_id, anchor_type, importance, created_at, personality_id FROM anchors",
            [],
        )?;
    }
    Ok(())
}

fn migrate_personality_isolation(conn: &Connection) -> Result<(), MemoryError> {
    if table_exists(conn, "conversations")?
        && !column_exists(conn, "conversations", "personality_id")?
    {
        conn.execute(
            "ALTER TABLE conversations ADD COLUMN personality_id TEXT NOT NULL DEFAULT 'default'",
            [],
        )?;
    }
    if table_exists(conn, "messages")? && !column_exists(conn, "messages", "personality_id")? {
        conn.execute(
            "ALTER TABLE messages ADD COLUMN personality_id TEXT NOT NULL DEFAULT 'default'",
            [],
        )?;
    }
    if table_exists(conn, "anchors")? && !column_exists(conn, "anchors", "personality_id")? {
        conn.execute(
            "ALTER TABLE anchors ADD COLUMN personality_id TEXT NOT NULL DEFAULT 'default'",
            [],
        )?;
    }
    rebuild_anchors_fts_with_personality(conn)?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_conversations_personality_updated
         ON conversations (personality_id, updated_at)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_personality_conv
         ON messages (personality_id, conversation_id, id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_anchors_personality_conv
         ON anchors (personality_id, conversation_id, importance)",
        [],
    )?;
    Ok(())
}

fn migrate_message_image_columns(conn: &Connection) -> Result<(), MemoryError> {
    if table_exists(conn, "messages")? && !column_exists(conn, "messages", "image_attachment")? {
        conn.execute("ALTER TABLE messages ADD COLUMN image_attachment TEXT", [])?;
    }
    if table_exists(conn, "messages")? && !column_exists(conn, "messages", "image_mime")? {
        conn.execute("ALTER TABLE messages ADD COLUMN image_mime TEXT", [])?;
    }
    Ok(())
}

fn enrich_message_image_paths(msg: &mut StoredMessage, data_dir: &Path) {
    if let Some(ref rel) = msg.image_attachment {
        let abs = crate::attachments::absolute_attachment_path(data_dir, rel);
        msg.image_display_path = Some(abs.to_string_lossy().into_owned());
    }
}

fn ensure_memory_anchor_tables(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r"CREATE TABLE IF NOT EXISTS anchors (
            id TEXT PRIMARY KEY,
            conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
            anchor_type TEXT NOT NULL,
            content TEXT NOT NULL,
            importance INTEGER NOT NULL DEFAULT 1,
            embedding BLOB,
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        );
        CREATE INDEX IF NOT EXISTS idx_anchors_conv ON anchors (conversation_id);
        CREATE INDEX IF NOT EXISTS idx_anchors_type ON anchors (anchor_type);
        CREATE INDEX IF NOT EXISTS idx_anchors_importance ON anchors (importance DESC);

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        );
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);

        CREATE TABLE IF NOT EXISTS preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        );",
    )?;
    Ok(())
}

fn create_fresh_current(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r"CREATE TABLE conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
            updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
            personality_id TEXT NOT NULL DEFAULT 'default'
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
            personality_id TEXT NOT NULL DEFAULT 'default'
        );
        CREATE INDEX idx_messages_conversation ON messages (conversation_id, id);
        CREATE INDEX idx_messages_created ON messages (created_at);

        CREATE TABLE anchors (
            id TEXT PRIMARY KEY,
            conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
            anchor_type TEXT NOT NULL,
            content TEXT NOT NULL,
            importance INTEGER NOT NULL DEFAULT 1,
            embedding BLOB,
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
            personality_id TEXT NOT NULL DEFAULT 'default'
        );
        CREATE INDEX idx_anchors_conv ON anchors (conversation_id);
        CREATE INDEX idx_anchors_type ON anchors (anchor_type);
        CREATE INDEX idx_anchors_importance ON anchors (importance DESC);

        CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        );
        CREATE INDEX idx_projects_status ON projects (status);

        CREATE TABLE preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        );

        INSERT INTO conversations (id, title, personality_id) VALUES ('default', 'General', 'default');",
    )?;
    Ok(())
}

fn migrate_legacy_messages(conn: &Connection) -> Result<(), MemoryError> {
    conn.execute_batch(
        r"CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        );
        INSERT OR IGNORE INTO conversations (id, title) VALUES ('default', 'General');
        CREATE TABLE messages_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            personality_id TEXT NOT NULL DEFAULT 'default'
        );
        INSERT INTO messages_new (conversation_id, role, content, created_at, personality_id)
            SELECT 'default', role, content, created_at, 'default' FROM messages;
        DROP TABLE messages;
        ALTER TABLE messages_new RENAME TO messages;
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, id);
        CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at);",
    )?;
    Ok(())
}

fn migrate_add_conversation_created_at(conn: &Connection) -> Result<(), MemoryError> {
    if !table_exists(conn, "conversations")? {
        return Ok(());
    }
    if column_exists(conn, "conversations", "created_at")? {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE conversations ADD COLUMN created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)",
        [],
    )?;
    conn.execute("UPDATE conversations SET created_at = updated_at", [])?;
    Ok(())
}

fn ensure_seed_conversation(conn: &Connection) -> Result<(), MemoryError> {
    if !table_exists(conn, "conversations")? {
        return Ok(());
    }
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM conversations", [], |r| r.get(0))?;
    if n == 0 {
        conn.execute(
            "INSERT INTO conversations (id, title, personality_id) VALUES ('default', 'General', 'default')",
            [],
        )?;
    }
    Ok(())
}

// --- LIKE escape --------------------------------------------------------------

fn escape_like(pattern: &str) -> String {
    let mut s = String::with_capacity(pattern.len() + 8);
    for c in pattern.chars() {
        match c {
            '\\' | '%' | '_' => {
                s.push('\\');
                s.push(c);
            }
            _ => s.push(c),
        }
    }
    s
}

// --- SQLite profiles ----------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SqliteProfile {
    Desktop,
    Portable,
}

pub fn sqlite_profile_from_env() -> SqliteProfile {
    let data_dir_set = std::env::var("PERSISTENT_SAGE_DATA_DIR")
        .or_else(|_| std::env::var("NOVA_DATA_DIR"))
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let portable_flag = std::env::var("PERSISTENT_SAGE_PORTABLE")
        .or_else(|_| std::env::var("NOVA_PORTABLE"))
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if data_dir_set || portable_flag {
        SqliteProfile::Portable
    } else {
        SqliteProfile::Desktop
    }
}

pub fn apply_profile_pragmas(
    conn: &Connection,
    profile: SqliteProfile,
) -> Result<(), rusqlite::Error> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Avoid indefinite hangs when chat + background memory jobs contend on the same file.
    conn.pragma_update(None, "busy_timeout", 10_000)?;
    match profile {
        SqliteProfile::Desktop => {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
        }
        SqliteProfile::Portable => {
            conn.pragma_update(None, "journal_mode", "DELETE")?;
            conn.pragma_update(None, "synchronous", "FULL")?;
        }
    }
    Ok(())
}

// --- MemoryAnchor -------------------------------------------------------------

pub struct MemoryAnchor {
    conn: Mutex<Connection>,
    data_directory: PathBuf,
    /// All list/create/recall operations scope to this companion profile id unless empty (`default`).
    active_personality_id: Mutex<String>,
}

impl MemoryAnchor {
    pub fn new(db_path: impl AsRef<Path>) -> Result<Self, MemoryError> {
        Self::new_with_profile(db_path, sqlite_profile_from_env())
    }

    pub fn new_with_profile(
        db_path: impl AsRef<Path>,
        profile: SqliteProfile,
    ) -> Result<Self, MemoryError> {
        let path = db_path.as_ref();
        let data_directory = path
            .parent()
            .map(Path::to_path_buf)
            .ok_or(MemoryError::NoDataDir)?;
        std::fs::create_dir_all(&data_directory)?;
        let conn = Connection::open(path)?;
        apply_profile_pragmas(&conn, profile)?;
        migrate_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            data_directory,
            active_personality_id: Mutex::new(String::from(DEFAULT_PERSONALITY_ID)),
        })
    }

    fn active_personality(&self) -> Result<String, MemoryError> {
        self.active_personality_id
            .lock()
            .map(|g| g.clone())
            .map_err(|_| MemoryError::LockPoisoned)
    }

    pub fn open_default() -> Result<Self, MemoryError> {
        Self::new(default_db_path()?)
    }

    fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, MemoryError> {
        self.conn.lock().map_err(|_| MemoryError::LockPoisoned)
    }

    fn assert_conversation_exists(&self, id: &str) -> Result<(), MemoryError> {
        let conn = self.conn()?;
        let pid = self.active_personality()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM conversations WHERE id = ?1 AND personality_id = ?2",
            params![id, pid],
            |r| r.get(0),
        )?;
        if n == 0 {
            return Err(MemoryError::UnknownConversation(id.to_string()));
        }
        Ok(())
    }

    fn row_to_conversation(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredConversation> {
        Ok(StoredConversation {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
        })
    }

    fn row_to_anchor(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredAnchor> {
        let emb: Option<Vec<u8>> = row.get(5)?;
        Ok(StoredAnchor {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            anchor_type: row.get(2)?,
            content: row.get(3)?,
            importance: row.get(4)?,
            has_embedding: emb.map(|b| !b.is_empty()).unwrap_or(false),
            created_at: row.get(6)?,
        })
    }

    fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredProject> {
        Ok(StoredProject {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            status: row.get(3)?,
            created_at: row.get(4)?,
        })
    }

    /// Builds the enriched briefing (transcript + anchors + projects + prefs).
    fn compose_enriched_briefing(
        &self,
        conversation_id: &str,
        assistant_label: &str,
    ) -> Result<String, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;

        let recent = self.get_recent(conversation_id, BRIEFING_MESSAGE_WINDOW)?;
        let anchors = self.list_anchors_for_thread(conversation_id, BRIEFING_MAX_ANCHORS)?;
        let projects = self.list_projects(BRIEFING_MAX_PROJECTS)?;
        let prefs = self.list_preferences_for_briefing(BRIEFING_MAX_PREFS)?;

        let mut out = String::new();

        let companion = assistant_label.trim();
        let companion = if companion.is_empty() {
            "Companion"
        } else {
            companion
        };

        out.push_str(&format!("# Session context ({companion})\n\n"));

        out.push_str("## Recent transcript\n");
        if recent.is_empty() {
            out.push_str("_No messages in this thread yet._\n\n");
        } else {
            for m in &recent {
                let label = match m.role {
                    MessageRole::User => "User",
                    MessageRole::Assistant => companion,
                };
                let snippet: String = m.content.chars().take(BRIEFING_SNIPPET_CHARS).collect();
                let suffix = if m.content.chars().count() > BRIEFING_SNIPPET_CHARS {
                    "…"
                } else {
                    ""
                };
                out.push_str(&format!("- **{label}**: {snippet}{suffix}\n"));
            }
            out.push('\n');
        }

        out.push_str("## Memory anchors (raw + curated)\n");
        if anchors.is_empty() {
            out.push_str("_No anchors yet. Extract from chat or add curated notes._\n\n");
        } else {
            for a in &anchors {
                out.push_str(&format!(
                    "- [{}] ({} · importance {}): {}\n",
                    a.anchor_type, a.id, a.importance, a.content
                ));
            }
            out.push('\n');
        }

        out.push_str("## Active projects\n");
        let active_projects: Vec<_> = projects
            .into_iter()
            .filter(|p| p.status != "archived")
            .collect();
        if active_projects.is_empty() {
            out.push_str("_No projects on file._\n\n");
        } else {
            for p in &active_projects {
                let desc: String = p.description.chars().take(200).collect();
                out.push_str(&format!("- **{}** [{}]: {}\n", p.title, p.status, desc));
            }
            out.push('\n');
        }

        out.push_str("## Saved preferences\n");
        if prefs.is_empty() {
            out.push_str("_No preferences stored._\n");
        } else {
            for (k, v) in prefs {
                let vv: String = v.chars().take(120).collect();
                out.push_str(&format!("- `{k}`: {vv}\n"));
            }
        }

        Ok(out)
    }

    fn list_preferences_for_briefing(
        &self,
        limit: usize,
    ) -> Result<Vec<(String, String)>, MemoryError> {
        let conn = self.conn()?;
        let lim: i64 = limit.try_into().unwrap_or(i64::MAX);
        let mut stmt =
            conn.prepare("SELECT key, value FROM preferences ORDER BY key ASC LIMIT ?1")?;
        let rows = stmt.query_map([lim], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let rows: Vec<(String, String)> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(MemoryError::from)?;
        Ok(rows
            .into_iter()
            .filter(|(k, _)| !k.contains("api_key") && !k.contains("secret"))
            .collect())
    }

    fn is_stop_token(t: &str) -> bool {
        matches!(
            t,
            "a" | "an"
                | "the"
                | "and"
                | "or"
                | "but"
                | "in"
                | "on"
                | "at"
                | "to"
                | "for"
                | "of"
                | "is"
                | "are"
                | "was"
                | "were"
                | "be"
                | "been"
                | "being"
                | "do"
                | "does"
                | "did"
                | "has"
                | "have"
                | "had"
                | "what"
                | "when"
                | "where"
                | "who"
                | "whom"
                | "which"
                | "why"
                | "how"
                | "my"
                | "your"
                | "our"
                | "their"
                | "its"
                | "i"
                | "you"
                | "we"
                | "they"
                | "me"
                | "him"
                | "her"
                | "us"
                | "them"
                | "this"
                | "that"
                | "these"
                | "those"
                | "it"
                | "there"
                | "here"
                | "from"
                | "with"
                | "as"
                | "by"
                | "not"
                | "no"
                | "yes"
                | "so"
                | "if"
                | "than"
                | "then"
                | "into"
                | "about"
                | "over"
                | "can"
                | "could"
                | "would"
                | "should"
                | "will"
                | "just"
                | "tell"
                | "please"
        )
    }

    /// Tokens for FTS / LIKE (skip short + stopwords) so questions match stored facts.
    fn substantive_tokens(raw: &str, max: usize) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for w in raw.split(|c: char| !c.is_alphanumeric()) {
            let t: String = w
                .chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
                .to_lowercase();
            if t.len() < 3 || Self::is_stop_token(t.as_str()) {
                continue;
            }
            if seen.insert(t.clone()) {
                out.push(t);
                if out.len() >= max {
                    break;
                }
            }
        }
        out
    }

    /// Rule-based associative expansions (no LLM) so questions like “any pets?” still surface “3 cats”.
    fn association_expansions(term: &str) -> &'static [&'static str] {
        match term {
            "pet" | "pets" | "animal" | "animals" | "creature" | "creatures" => &[
                "cat", "cats", "dog", "dogs", "bird", "birds", "fish", "rabbit", "hamster",
                "kitten", "kittens", "puppy", "puppies", "pet", "pets", "own", "owns", "have",
                "has", "furry",
            ],
            "cat" | "cats" | "kitten" | "kittens" | "feline" | "felines" => &[
                "pet", "pets", "animal", "dog", "dogs", "puppy", "kitten", "own", "have", "fur",
            ],
            "dog" | "dogs" | "puppy" | "puppies" | "canine" | "canines" => &[
                "pet", "pets", "animal", "cat", "cats", "kitten", "own", "have", "walk", "leash",
            ],
            "own" | "owns" | "owned" | "ownership" | "mine" => &[
                "have", "has", "had", "got", "keep", "keeping", "pet", "pets", "cat", "cats",
                "dog", "dogs",
            ],
            "have" | "has" | "having" | "had" | "got" | "keeping" | "keep" => &[
                "own", "owns", "owned", "pet", "pets", "cat", "cats", "dog", "dogs", "hold",
            ],
            "any" | "some" => &[
                "pet", "pets", "cat", "cats", "dog", "dogs", "have", "has", "own", "owns",
            ],
            "household" | "home" | "family" => &[
                "pet", "pets", "cat", "cats", "dog", "dogs", "kid", "kids", "live", "living",
            ],
            "vision" | "sight" | "seeing" | "eyesight" | "eye" | "eyes" | "visual" => &[
                "colorblind",
                "colourblind",
                "color",
                "colour",
                "blind",
                "blindness",
                "see",
                "sight",
                "protanopia",
                "deuteranopia",
                "tritanopia",
                "daltonism",
            ],
            "colorblind" | "colourblind" | "colorblindness" | "colourblindness" => &[
                "vision",
                "sight",
                "color",
                "colour",
                "blind",
                "eyes",
                "visual",
                "protanopia",
                "deuteranopia",
                "tritanopia",
            ],
            "color" | "colour" | "colors" | "colours" => &[
                "colorblind",
                "colourblind",
                "vision",
                "blind",
                "sight",
                "hue",
                "red",
                "green",
            ],
            "blind" | "blindness" => &[
                "colorblind",
                "colourblind",
                "vision",
                "sight",
                "visual",
                "see",
            ],
            _ => &[],
        }
    }

    fn semantic_anchor_scores(
        conn: &Connection,
        query_emb: &[f32],
        scope_conversation_id: Option<&str>,
        personality_id: &str,
        cap: usize,
    ) -> Result<Vec<(String, f32)>, MemoryError> {
        use crate::embedding::{cosine_similarity, deserialize_embedding};

        let scope = scope_conversation_id.filter(|s| !s.is_empty());
        let lim: i64 = cap.try_into().unwrap_or(256);
        let mut out: Vec<(String, f32)> = Vec::new();

        if let Some(cid) = scope {
            let mut stmt = conn.prepare(
                "SELECT id, embedding FROM anchors
                 WHERE personality_id IN (?1, ?2) AND embedding IS NOT NULL AND length(embedding) > 4
                   AND (conversation_id IS NULL OR conversation_id = ?3)
                 LIMIT ?4",
            )?;
            let rows = stmt.query_map(params![personality_id, SHARED_PERSONALITY_ID, cid, lim], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<Vec<u8>>>(1)?))
            })?;
            for row in rows {
                let (id, blob_opt) = row?;
                let Some(blob) = blob_opt else { continue };
                let Some(vec) = deserialize_embedding(&blob) else {
                    continue;
                };
                let sim = cosine_similarity(query_emb, &vec);
                if sim > 0.0 {
                    out.push((id, sim));
                }
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, embedding FROM anchors
                 WHERE personality_id IN (?1, ?2) AND embedding IS NOT NULL AND length(embedding) > 4
                 LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![personality_id, SHARED_PERSONALITY_ID, lim], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<Vec<u8>>>(1)?))
            })?;
            for row in rows {
                let (id, blob_opt) = row?;
                let Some(blob) = blob_opt else { continue };
                let Some(vec) = deserialize_embedding(&blob) else {
                    continue;
                };
                let sim = cosine_similarity(query_emb, &vec);
                if sim > 0.0 {
                    out.push((id, sim));
                }
            }
        }

        out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        out.truncate(cap);
        Ok(out)
    }

    fn anchor_id_for_content(
        conn: &Connection,
        conversation_id: Option<&str>,
        content: &str,
        personality_id: &str,
    ) -> Result<Option<String>, MemoryError> {
        let id: Result<String, rusqlite::Error> = match conversation_id {
            Some(cid) => conn.query_row(
                "SELECT id FROM anchors WHERE conversation_id = ?1 AND content = ?2 AND personality_id = ?3 LIMIT 1",
                params![cid, content, personality_id],
                |r| r.get(0),
            ),
            None => conn.query_row(
                "SELECT id FROM anchors WHERE conversation_id IS NULL AND content = ?2 AND personality_id = ?1 LIMIT 1",
                params![personality_id, content],
                |r| r.get(0),
            ),
        };
        match id {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Insert one anchor row using an already-held connection (avoids re-locking `conn` mutex).
    fn insert_anchor_row(
        conn: &Connection,
        conversation_id: Option<&str>,
        anchor_type: AnchorType,
        content: &str,
        importance: i32,
        personality_id: &str,
    ) -> Result<String, MemoryError> {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO anchors (id, conversation_id, anchor_type, content, importance, personality_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                conversation_id,
                anchor_type.as_db_str(),
                content,
                importance,
                personality_id
            ],
        )?;
        Ok(id)
    }

    fn anchor_content_exists(
        conn: &Connection,
        conversation_id: Option<&str>,
        content: &str,
        personality_id: &str,
    ) -> Result<bool, MemoryError> {
        let n: i64 = match conversation_id {
            Some(cid) => conn.query_row(
                "SELECT COUNT(*) FROM anchors WHERE conversation_id = ?1 AND content = ?2 AND personality_id = ?3",
                params![cid, content, personality_id],
                |r| r.get(0),
            )?,
            None => conn.query_row(
                "SELECT COUNT(*) FROM anchors WHERE conversation_id IS NULL AND content = ?2 AND personality_id = ?1",
                params![personality_id, content],
                |r| r.get(0),
            )?,
        };
        Ok(n > 0)
    }

    fn prepare_recall_query(raw: &str) -> RecallQueryExpansion {
        const MAX_PRIMARY: usize = 8;
        const MAX_EXPANDED: usize = 14;
        const MAX_FTS: usize = 20;
        const MAX_MSG: usize = 12;

        let primary = Self::substantive_tokens(raw, MAX_PRIMARY);
        let primary_set: HashSet<String> = primary.iter().cloned().collect();

        let mut expanded_seen = HashSet::new();
        let mut expanded: Vec<String> = Vec::new();
        for t in &primary {
            for e in Self::association_expansions(t.as_str()) {
                let es = (*e).to_string();
                if es.len() < 2 || primary_set.contains(&es) || expanded_seen.contains(&es) {
                    continue;
                }
                expanded_seen.insert(es.clone());
                expanded.push(es);
                if expanded.len() >= MAX_EXPANDED {
                    break;
                }
            }
            if expanded.len() >= MAX_EXPANDED {
                break;
            }
        }

        let mut fts_terms: Vec<String> = Vec::new();
        let mut fts_seen = HashSet::new();
        for t in primary.iter().chain(expanded.iter()) {
            if fts_seen.insert(t.clone()) && fts_terms.len() < MAX_FTS {
                fts_terms.push(t.clone());
            }
        }

        let mut message_terms: Vec<String> = Vec::new();
        let mut msg_seen = HashSet::new();
        for t in primary.iter().chain(expanded.iter()) {
            if msg_seen.insert(t.clone()) && message_terms.len() < MAX_MSG {
                message_terms.push(t.clone());
            }
        }

        RecallQueryExpansion {
            primary,
            expanded,
            fts_terms,
            message_terms,
        }
    }

    fn fts_match_expr_from_terms(terms: &[String]) -> Option<String> {
        let cells: Vec<String> = terms
            .iter()
            .filter(|t| !t.is_empty() && t.len() <= 64)
            .map(|t| format!("\"{}\"", t.replace('\"', "")))
            .collect();
        if cells.is_empty() {
            None
        } else {
            Some(cells.join(" OR "))
        }
    }

    fn fts_fallback_token_cells(raw: &str) -> Option<String> {
        let cells: Vec<String> = raw
            .split(|c: char| !c.is_alphanumeric())
            .filter_map(|w| {
                let t: String = w.chars().filter(|c| c.is_alphanumeric()).collect();
                if t.len() >= 2 && t.len() <= 64 {
                    Some(format!("\"{}\"", t.replace('\"', "")))
                } else {
                    None
                }
            })
            .take(6)
            .collect();
        if cells.is_empty() {
            None
        } else {
            Some(cells.join(" OR "))
        }
    }

    /// Extra score when anchor text hits **associative** terms (primary already covered by LIKE/FTS).
    fn expansion_content_bonus(content: &str, expanded: &[String]) -> f64 {
        let c = content.to_lowercase();
        let mut b = 0.0f64;
        for t in expanded {
            if t.len() >= 2 && c.contains(t.as_str()) {
                b += 0.32;
            }
        }
        b.min(2.4)
    }

    fn anchor_by_id(
        conn: &Connection,
        id: &str,
        personality_id: &str,
    ) -> Result<Option<StoredAnchor>, MemoryError> {
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
             FROM anchors WHERE id = ?1 AND personality_id IN (?2, ?3)",
        )?;
        let mut rows = stmt.query(params![id, personality_id, SHARED_PERSONALITY_ID])?;
        if let Some(row) = rows.next()? {
            Ok(Some(MemoryAnchor::row_to_anchor(&row)?))
        } else {
            Ok(None)
        }
    }

    /// FTS5 hits (anchor_id, bm25 rank — lower is better).
    fn fts_anchor_ids(
        conn: &Connection,
        match_expr: &str,
        scope: Option<&str>,
        take: i64,
        personality_id: &str,
    ) -> Result<Vec<(String, f64)>, MemoryError> {
        let rows: Vec<(String, f64)> = match scope {
            Some(cid) => {
                let mut stmt = conn.prepare(
                    "SELECT anchor_id, bm25(anchors_fts) AS r
                     FROM anchors_fts
                     WHERE anchors_fts MATCH ?1
                       AND anchors_fts.personality_id IN (?4, ?5)
                       AND (conversation_id IS NULL OR conversation_id = ?2)
                     ORDER BY r ASC
                     LIMIT ?3",
                )?;
                let rows = stmt.query_map(
                    params![match_expr, cid, take, personality_id, SHARED_PERSONALITY_ID],
                    |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
                    })?;
                rows.collect::<Result<Vec<_>, _>>()?
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT anchor_id, bm25(anchors_fts) AS r
                     FROM anchors_fts
                     WHERE anchors_fts MATCH ?1
                       AND anchors_fts.personality_id IN (?3, ?4)
                     ORDER BY r ASC
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(
                    params![match_expr, take, personality_id, SHARED_PERSONALITY_ID],
                    |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            }
        };
        Ok(rows)
    }

    fn keyword_like_anchors(
        conn: &Connection,
        pat: &str,
        scope: Option<&str>,
        take: i64,
        personality_id: &str,
    ) -> Result<Vec<StoredAnchor>, MemoryError> {
        let rows: Vec<StoredAnchor> = match scope {
            Some(cid) => {
                let mut stmt = conn.prepare(
                    "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
                     FROM anchors
                     WHERE content LIKE ?1 ESCAPE '\\'
                       AND personality_id IN (?4, ?5)
                       AND (conversation_id IS NULL OR conversation_id = ?2)
                     ORDER BY importance DESC, datetime(created_at) DESC
                     LIMIT ?3",
                )?;
                let rows = stmt.query_map(
                    params![pat, cid, take, personality_id, SHARED_PERSONALITY_ID],
                    MemoryAnchor::row_to_anchor,
                )?;
                rows.collect::<Result<Vec<_>, _>>()?
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
                     FROM anchors
                     WHERE content LIKE ?1 ESCAPE '\\'
                       AND personality_id IN (?3, ?4)
                     ORDER BY importance DESC, datetime(created_at) DESC
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(
                    params![pat, take, personality_id, SHARED_PERSONALITY_ID],
                    MemoryAnchor::row_to_anchor,
                )?;
                rows.collect::<Result<Vec<_>, _>>()?
            }
        };
        Ok(rows)
    }

    fn recall_messages_like(
        conn: &Connection,
        conversation_id: &str,
        pat: &str,
        take: i64,
        personality_id: &str,
    ) -> Result<Vec<StoredMessage>, MemoryError> {
        let mut stmt = conn.prepare(
            "SELECT id, role, content, created_at FROM messages
             WHERE conversation_id = ?1 AND personality_id = ?4 AND content LIKE ?2 ESCAPE '\\'
             ORDER BY id DESC LIMIT ?3",
        )?;
        let mut rows = stmt.query(params![conversation_id, pat, take, personality_id])?;
        let mut batch = Vec::new();
        while let Some(row) = rows.next()? {
            let role_str: String = row.get(1)?;
            batch.push(StoredMessage {
                id: row.get(0)?,
                role: MessageRole::parse_db(&role_str)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                image_attachment: None,
                image_mime: None,
                image_display_path: None,
                artifact_json: None,
                conversation_id: None,
                conversation_title: None,
            });
        }
        batch.reverse();
        Ok(batch)
    }

    /// Keyword search across **all** threads (expanded `terms` include associative recall).
    fn recall_messages_global_with_terms(
        conn: &Connection,
        query: &str,
        terms: &[String],
        take: usize,
        personality_id: &str,
    ) -> Result<Vec<StoredMessage>, MemoryError> {
        let take_i: i64 = take.max(1).min(32) as i64;
        let mut seen = HashSet::new();
        let mut out: Vec<StoredMessage> = Vec::new();

        let push_batch =
            |batch: Vec<StoredMessage>, seen: &mut HashSet<i64>, out: &mut Vec<StoredMessage>| {
                for m in batch {
                    if seen.insert(m.id) {
                        out.push(m);
                    }
                }
            };

        let full_needle: String = query.trim().chars().take(120).collect();
        if full_needle.chars().count() >= 3 {
            let pat = format!("%{}%", escape_like(&full_needle));
            let batch = Self::query_messages_global_one(conn, &pat, take_i, personality_id)?;
            push_batch(batch, &mut seen, &mut out);
        }

        if terms.is_empty() {
            if out.is_empty() && full_needle.chars().count() < 3 {
                return Ok(vec![]);
            }
        } else {
            let per_query = (take_i).min(12);
            for term in terms.iter().take(14) {
                let pat = format!("%{}%", escape_like(term));
                let batch = Self::query_messages_global_one(conn, &pat, per_query, personality_id)?;
                push_batch(batch, &mut seen, &mut out);
            }
        }

        out.sort_by(|a, b| b.id.cmp(&a.id));
        out.truncate(take.max(1).min(32));
        out.reverse();
        Ok(out)
    }

    fn query_messages_global_one(
        conn: &Connection,
        pat: &str,
        take: i64,
        personality_id: &str,
    ) -> Result<Vec<StoredMessage>, MemoryError> {
        let mut stmt = conn.prepare(
            "SELECT m.id, m.role, m.content, m.created_at, m.conversation_id, c.title
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE m.content LIKE ?1 ESCAPE '\\'
               AND m.personality_id = ?3
               AND c.personality_id = ?3
             ORDER BY m.id DESC
             LIMIT ?2",
        )?;
        let mut rows = stmt.query(params![pat, take, personality_id])?;
        let mut batch = Vec::new();
        while let Some(row) = rows.next()? {
            let role_str: String = row.get(1)?;
            batch.push(StoredMessage {
                id: row.get(0)?,
                role: MessageRole::parse_db(&role_str)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                image_attachment: None,
                image_mime: None,
                image_display_path: None,
                artifact_json: None,
                conversation_id: row.get(4)?,
                conversation_title: row.get(5)?,
            });
        }
        Ok(batch)
    }

    /// Hybrid: FTS5 + keyword + optional cosine similarity on anchor embeddings.
    fn hybrid_recall(
        &self,
        query: &str,
        scope_conversation_id: Option<&str>,
        anchor_limit: usize,
        message_limit: usize,
        query_embedding: Option<&[f32]>,
    ) -> Result<MemoryRecallBundle, MemoryError> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(MemoryRecallBundle {
                anchors: vec![],
                messages: vec![],
            });
        }

        let exp = Self::prepare_recall_query(q);
        eprintln!(
            "persistent-sage: hybrid_recall expansion primary={:?} expanded={:?} fts_term_count={} message_terms={:?}",
            exp.primary,
            exp.expanded,
            exp.fts_terms.len(),
            exp.message_terms
        );

        let personality_id = self.active_personality()?;
        let scope = scope_conversation_id.filter(|s| !s.is_empty());
        let alim: i64 = anchor_limit.max(1).min(64) as i64 * 3;
        let mlim: i64 = message_limit.max(0).min(24) as i64;

        eprintln!(
            "persistent-sage: hybrid_recall start — query_len={} scope={:?} personality_id={} anchor_limit={} message_limit={}",
            q.len(),
            scope,
            personality_id,
            anchor_limit,
            message_limit
        );

        let conn = self.conn()?;
        let fts_table = table_exists(&conn, "anchors_fts").unwrap_or(false);

        let mut scores: HashMap<String, f64> = HashMap::new();

        if fts_table {
            let mexpr_opt = Self::fts_match_expr_from_terms(&exp.fts_terms)
                .or_else(|| Self::fts_fallback_token_cells(q));
            if let Some(ref mexpr) = mexpr_opt {
                eprintln!("persistent-sage: hybrid_recall FTS MATCH expr: {mexpr}");
                match Self::fts_anchor_ids(&conn, mexpr, scope, alim, &personality_id) {
                    Ok(hits) => {
                        eprintln!(
                            "persistent-sage: hybrid_recall FTS raw hits: {}",
                            hits.len()
                        );
                        for (id, bm) in hits {
                            let base = -bm;
                            let bonus = scores.get(&id).copied().unwrap_or(0.0);
                            scores.insert(id, bonus + base + 2.0);
                        }
                    }
                    Err(e) => {
                        eprintln!("persistent-sage: memory FTS recall skipped ({e})");
                    }
                }
            } else {
                eprintln!("persistent-sage: hybrid_recall FTS skipped (no tokenized query)");
            }
        } else {
            eprintln!("persistent-sage: hybrid_recall FTS table missing; keyword/LIKE only");
        }

        let pat = format!("%{}%", escape_like(q));
        let pat_lower = format!("%{}%", escape_like(&q.to_lowercase()));
        for a in Self::keyword_like_anchors(&conn, &pat, scope, alim, &personality_id)? {
            let bump = 1.5 + (a.importance as f64).ln_1p() * 0.35;
            scores
                .entry(a.id.clone())
                .and_modify(|s| *s += bump)
                .or_insert(bump);
        }
        if pat_lower != pat {
            for a in Self::keyword_like_anchors(&conn, &pat_lower, scope, alim, &personality_id)? {
                let bump = 1.2 + (a.importance as f64).ln_1p() * 0.3;
                scores
                    .entry(a.id.clone())
                    .and_modify(|s| *s += bump)
                    .or_insert(bump);
            }
        }

        let primary_set: HashSet<String> = exp.primary.iter().cloned().collect();
        let expanded_only: HashSet<String> = exp.expanded.iter().cloned().collect();
        for term in &exp.message_terms {
            let tpat = format!("%{}%", escape_like(term));
            for a in Self::keyword_like_anchors(&conn, &tpat, scope, alim, &personality_id)? {
                let mut bump = 0.85 + (a.importance as f64).ln_1p() * 0.25;
                if expanded_only.contains(term) && !primary_set.contains(term) {
                    bump += 0.45;
                }
                scores
                    .entry(a.id.clone())
                    .and_modify(|s| *s += bump)
                    .or_insert(bump);
            }
        }

        let ids_for_assoc_bonus: Vec<String> = scores.keys().cloned().collect();
        for aid in ids_for_assoc_bonus {
            if let Some(a) = Self::anchor_by_id(&conn, &aid, &personality_id)? {
                let b = Self::expansion_content_bonus(&a.content, &exp.expanded);
                if b > 0.0 {
                    scores.entry(aid).and_modify(|s| *s += b);
                }
            }
        }

        if let Some(q_emb) = query_embedding {
            let semantic_hits = Self::semantic_anchor_scores(
                &conn,
                q_emb,
                scope,
                &personality_id,
                (alim as usize).saturating_mul(4),
            )?;
            eprintln!(
                "persistent-sage: hybrid_recall semantic hits: {} (query dim {})",
                semantic_hits.len(),
                q_emb.len()
            );
            for (id, sim) in semantic_hits {
                if sim < 0.28 {
                    continue;
                }
                let bump = (sim as f64) * 10.0 + 1.5;
                scores.entry(id).and_modify(|s| *s += bump).or_insert(bump);
            }
        }

        let mut anchor_ids: Vec<String> = scores.keys().cloned().collect();
        anchor_ids.sort_by(|a, b| {
            let sa = scores.get(a).copied().unwrap_or(0.0);
            let sb = scores.get(b).copied().unwrap_or(0.0);
            sb.partial_cmp(&sa).unwrap_or(Ordering::Equal)
        });
        anchor_ids.truncate(anchor_limit.max(1).min(64));

        let mut anchors: Vec<StoredAnchor> = Vec::new();
        for id in anchor_ids {
            if let Some(a) = Self::anchor_by_id(&conn, &id, &personality_id)? {
                anchors.push(a);
            }
        }

        anchors.sort_by(|a, b| {
            let sa = scores.get(&a.id).copied().unwrap_or(0.0);
            let sb = scores.get(&b.id).copied().unwrap_or(0.0);
            sb.partial_cmp(&sa)
                .unwrap_or(Ordering::Equal)
                .then_with(|| b.importance.cmp(&a.importance))
                .then_with(|| b.created_at.cmp(&a.created_at))
        });

        let anchor_preview: Vec<String> = anchors
            .iter()
            .take(6)
            .map(|a| {
                let sc = scores.get(&a.id).copied().unwrap_or(0.0);
                let snip: String = a.content.chars().take(56).collect();
                format!("(score={sc:.2}) {}", snip.replace('\n', " "))
            })
            .collect();
        eprintln!(
            "persistent-sage: hybrid_recall retrieved_anchors_top={}",
            anchor_preview.join(" ;; ")
        );

        let mut messages = Vec::new();
        if mlim > 0 {
            messages = if let Some(cid) = scope {
                eprintln!(
                    "persistent-sage: hybrid_recall thread message search ({cid}) full_query + {} expanded terms",
                    exp.message_terms.len()
                );
                let mut seen_ids = HashSet::<i64>::new();
                let mut merged: Vec<StoredMessage> = Vec::new();
                let push_m =
                    |m: StoredMessage, seen: &mut HashSet<i64>, acc: &mut Vec<StoredMessage>| {
                        if seen.insert(m.id) {
                            acc.push(m);
                        }
                    };
                for m in Self::recall_messages_like(&conn, cid, &pat, mlim, &personality_id)? {
                    push_m(m, &mut seen_ids, &mut merged);
                }
                let per = (mlim / 3).max(2).min(8);
                for term in exp.message_terms.iter().take(12) {
                    let tpat = format!("%{}%", escape_like(term));
                    for m in Self::recall_messages_like(&conn, cid, &tpat, per, &personality_id)? {
                        push_m(m, &mut seen_ids, &mut merged);
                    }
                }
                merged.sort_by(|a, b| b.id.cmp(&a.id));
                merged.truncate(mlim as usize);
                merged.reverse();
                merged
            } else {
                eprintln!("persistent-sage: hybrid_recall global message search (personality + expanded terms)");
                Self::recall_messages_global_with_terms(
                    &conn,
                    q,
                    &exp.message_terms,
                    mlim as usize,
                    &personality_id,
                )?
            };
        }

        let msg_preview: Vec<String> = messages
            .iter()
            .take(4)
            .map(|m| {
                let snip: String = m.content.chars().take(48).collect();
                format!("id={} {}", m.id, snip.replace('\n', " "))
            })
            .collect();
        eprintln!(
            "persistent-sage: hybrid_recall retrieved_messages_top={}",
            msg_preview.join(" ;; ")
        );

        eprintln!(
            "persistent-sage: hybrid_recall complete — scored_anchor_ids={}, returning anchors={}, messages={}",
            scores.len(),
            anchors.len(),
            messages.len()
        );

        Ok(MemoryRecallBundle { anchors, messages })
    }
}

impl ConversationMemory for MemoryAnchor {
    fn store_message(
        &self,
        conversation_id: &str,
        role: MessageRole,
        content: &str,
        image_attachment: Option<&str>,
        image_mime: Option<&str>,
        artifact_json: Option<&str>,
    ) -> Result<(), MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, personality_id, image_attachment, image_mime, artifact_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                conversation_id,
                role.as_db_str(),
                content,
                pid,
                image_attachment,
                image_mime,
                artifact_json
            ],
        )?;
        conn.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND personality_id = ?2",
            params![conversation_id, pid],
        )?;
        Ok(())
    }

    fn get_recent(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredMessage>, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let pid = self.active_personality()?;
        let limit_i: i64 = limit.try_into().unwrap_or(i64::MAX);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, role, content, created_at, image_attachment, image_mime, artifact_json FROM messages
             WHERE conversation_id = ?1 AND personality_id = ?2
             ORDER BY id DESC LIMIT ?3",
        )?;
        let mut rows = stmt.query(params![conversation_id, pid, limit_i])?;
        let mut batch = Vec::new();
        while let Some(row) = rows.next()? {
            let role_str: String = row.get(1)?;
            let mut msg = StoredMessage {
                id: row.get(0)?,
                role: MessageRole::parse_db(&role_str)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                image_attachment: row.get(4)?,
                image_mime: row.get(5)?,
                image_display_path: None,
                artifact_json: row.get(6)?,
                conversation_id: None,
                conversation_title: None,
            };
            enrich_message_image_paths(&mut msg, &self.data_directory);
            batch.push(msg);
        }
        batch.reverse();
        Ok(batch)
    }

    fn get_startup_briefing(
        &self,
        conversation_id: &str,
        assistant_label: &str,
    ) -> Result<String, MemoryError> {
        self.compose_enriched_briefing(conversation_id, assistant_label)
    }

    fn update_startup_briefing(
        &self,
        conversation_id: &str,
        assistant_label: &str,
    ) -> Result<String, MemoryError> {
        self.compose_enriched_briefing(conversation_id, assistant_label)
    }

    fn list_conversations(&self) -> Result<Vec<StoredConversation>, MemoryError> {
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at FROM conversations
             WHERE personality_id = ?1
             ORDER BY datetime(updated_at) DESC, id DESC",
        )?;
        let rows = stmt.query_map([pid], MemoryAnchor::row_to_conversation)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(MemoryError::from)
    }

    fn get_conversation(&self, conversation_id: &str) -> Result<StoredConversation, MemoryError> {
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        let row = conn.query_row(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?1 AND personality_id = ?2",
            params![conversation_id, pid],
            MemoryAnchor::row_to_conversation,
        );
        match row {
            Ok(c) => Ok(c),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(MemoryError::UnknownConversation(
                conversation_id.to_string(),
            )),
            Err(e) => Err(MemoryError::from(e)),
        }
    }

    fn create_conversation(&self, title: &str) -> Result<String, MemoryError> {
        let id = Uuid::new_v4().to_string();
        let pid = self.active_personality()?;
        eprintln!(
            "persistent-sage: memory_create_conversation personality_id={pid} conversation_id={id} title_len={}",
            title.len()
        );
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO conversations (id, title, personality_id) VALUES (?1, ?2, ?3)",
            params![id, title, pid],
        )?;
        Ok(id)
    }

    fn rename_conversation(&self, conversation_id: &str, title: &str) -> Result<(), MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        let n = conn.execute(
            "UPDATE conversations SET title = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND personality_id = ?3",
            params![conversation_id, title, pid],
        )?;
        if n == 0 {
            return Err(MemoryError::UnknownConversation(
                conversation_id.to_string(),
            ));
        }
        Ok(())
    }

    fn delete_conversation(&self, conversation_id: &str) -> Result<(), MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        conn.execute(
            "DELETE FROM conversations WHERE id = ?1 AND personality_id = ?2",
            params![conversation_id, pid],
        )?;
        Ok(())
    }

    fn create_anchor(
        &self,
        conversation_id: Option<&str>,
        anchor_type: AnchorType,
        content: &str,
        importance: i32,
    ) -> Result<String, MemoryError> {
        if let Some(cid) = conversation_id {
            self.assert_conversation_exists(cid)?;
        }
        let active = self.active_personality()?;
        let (pid, body) = resolve_anchor_personality_and_content(&active, content);
        let conn = self.conn()?;
        Self::insert_anchor_row(
            &conn,
            conversation_id,
            anchor_type,
            &body,
            importance,
            &pid,
        )
    }

    fn upsert_project_anchor(&self, project_id: &str, title: &str) -> Result<String, MemoryError> {
        let id = project_id.trim();
        let title = title.trim();
        if id.is_empty() || title.is_empty() {
            return Err(MemoryError::InvalidAnchorType(
                "project id and title required".into(),
            ));
        }
        let body = format!(
            "[project:{id}] Collaborative project \"{title}\". Living document: workspace/projects/{id}/document.md"
        );
        let conn = self.conn()?;
        if let Some(existing) =
            Self::anchor_id_for_content(&conn, None, &body, SHARED_PERSONALITY_ID)?
        {
            let imp = 4_i32;
            conn.execute(
                "UPDATE anchors SET importance = MAX(importance, ?1), content = ?2 WHERE id = ?3 AND personality_id = ?4",
                params![imp, body, existing, SHARED_PERSONALITY_ID],
            )?;
            return Ok(existing);
        }
        Self::insert_anchor_row(
            &conn,
            None,
            AnchorType::Curated,
            &body,
            4,
            SHARED_PERSONALITY_ID,
        )
    }

    fn create_anchor_from_conversation(
        &self,
        conversation_id: &str,
        max_anchors: usize,
    ) -> Result<Vec<String>, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let recent = self.get_recent(conversation_id, 40)?;
        let mut candidates: Vec<String> = Vec::new();

        for m in recent.iter().filter(|m| m.role == MessageRole::User) {
            candidates.extend(anchor_candidates_from_user_message(&m.content));
        }

        candidates.sort_by(|a, b| b.chars().count().cmp(&a.chars().count()));
        candidates.dedup();

        let mut ids = Vec::new();
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        for text in candidates.into_iter().take(max_anchors) {
            if !Self::anchor_content_exists(&conn, Some(conversation_id), &text, &pid)? {
                ids.push(Self::insert_anchor_row(
                    &conn,
                    Some(conversation_id),
                    AnchorType::Raw,
                    &text,
                    1,
                    &pid,
                )?);
            }
            if !Self::anchor_content_exists(&conn, None, &text, &pid)? {
                let _ = Self::insert_anchor_row(&conn, None, AnchorType::Raw, &text, 2, &pid)?;
            }
        }
        Ok(ids)
    }

    fn ingest_user_message_anchors(
        &self,
        conversation_id: &str,
        content: &str,
    ) -> Result<Vec<String>, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let trimmed = content.trim();
        if trimmed.chars().count() < ANCHOR_EXTRACT_MIN_CHARS {
            return Ok(vec![]);
        }

        let candidates: Vec<String> = anchor_candidates_from_user_message(trimmed)
            .into_iter()
            .take(AUTO_INGEST_MAX_PER_MESSAGE)
            .collect();
        if candidates.is_empty() {
            return Ok(vec![]);
        }

        let pid = self.active_personality()?;
        let conn = self.conn()?;
        let mut ids = Vec::new();

        for text in candidates {
            if !Self::anchor_content_exists(&conn, Some(conversation_id), &text, &pid)? {
                let id = Self::insert_anchor_row(
                    &conn,
                    Some(conversation_id),
                    AnchorType::Raw,
                    &text,
                    1,
                    &pid,
                )?;
                ids.push(id);
            }
            if !Self::anchor_content_exists(&conn, None, &text, &pid)? {
                let _ = Self::insert_anchor_row(&conn, None, AnchorType::Raw, &text, 2, &pid)?;
            }
        }

        if !ids.is_empty() {
            eprintln!(
                "persistent-sage: auto-ingested {} thread anchor(s) from user message (global copies when new)",
                ids.len()
            );
        }
        Ok(ids)
    }

    fn recall_anchors(
        &self,
        query: &str,
        scope_conversation_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError> {
        Ok(self
            .hybrid_recall(query, scope_conversation_id, limit, 0, None)?
            .anchors)
    }

    fn memory_recall(
        &self,
        query: &str,
        scope_conversation_id: Option<&str>,
        anchor_limit: usize,
        message_limit: usize,
        query_embedding: Option<&[f32]>,
    ) -> Result<MemoryRecallBundle, MemoryError> {
        self.hybrid_recall(
            query,
            scope_conversation_id,
            anchor_limit.max(1).min(64),
            message_limit.max(0).min(24),
            query_embedding,
        )
    }

    fn upsert_memory_anchor(
        &self,
        conversation_id: Option<&str>,
        anchor_type: AnchorType,
        content: &str,
        importance: i32,
    ) -> Result<String, MemoryError> {
        if let Some(cid) = conversation_id {
            self.assert_conversation_exists(cid)?;
        }
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Err(MemoryError::InvalidAnchorType(
                "anchor content is empty".into(),
            ));
        }
        let active = self.active_personality()?;
        let (pid, body) = resolve_anchor_personality_and_content(&active, trimmed);
        let conn = self.conn()?;
        if let Some(existing) = Self::anchor_id_for_content(&conn, conversation_id, &body, &pid)? {
            let imp = importance.clamp(1, 5);
            conn.execute(
                "UPDATE anchors SET importance = MAX(importance, ?1) WHERE id = ?2 AND personality_id = ?3",
                params![imp, existing, pid],
            )?;
            return Ok(existing);
        }
        Self::insert_anchor_row(
            &conn,
            conversation_id,
            anchor_type,
            &body,
            importance.clamp(1, 5),
            &pid,
        )
    }

    fn set_anchor_embedding(
        &self,
        anchor_id: &str,
        embedding_blob: &[u8],
        _model_label: &str,
    ) -> Result<(), MemoryError> {
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        let n = conn.execute(
            "UPDATE anchors SET embedding = ?1 WHERE id = ?2 AND personality_id = ?3",
            params![embedding_blob, anchor_id, pid],
        )?;
        if n == 0 {
            return Err(MemoryError::InvalidAnchorType(format!(
                "anchor not found: {anchor_id}"
            )));
        }
        Ok(())
    }

    fn list_anchors_without_embedding(
        &self,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError> {
        let pid = self.active_personality()?;
        let lim: i64 = limit.try_into().unwrap_or(i64::MAX);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
             FROM anchors
             WHERE personality_id = ?1 AND (embedding IS NULL OR length(embedding) < 5)
             ORDER BY datetime(created_at) DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pid, lim], MemoryAnchor::row_to_anchor)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(MemoryError::from)
    }

    fn clear_all_embeddings(&self) -> Result<(), MemoryError> {
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        conn.execute(
            "UPDATE anchors SET embedding = NULL WHERE personality_id = ?1",
            [pid],
        )?;
        Ok(())
    }

    fn count_anchors_with_embedding(&self) -> Result<u32, MemoryError> {
        let pid = self.active_personality()?;
        let conn = self.conn()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM anchors
             WHERE personality_id = ?1 AND embedding IS NOT NULL AND length(embedding) > 4",
            [pid],
            |r| r.get(0),
        )?;
        Ok(n.try_into().unwrap_or(0))
    }

    fn list_anchors_for_thread(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let pid = self.active_personality()?;
        let lim: i64 = limit.try_into().unwrap_or(i64::MAX);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
             FROM anchors
             WHERE personality_id IN (?1, ?2) AND (conversation_id IS NULL OR conversation_id = ?3)
             ORDER BY importance DESC, datetime(created_at) DESC
             LIMIT ?4",
        )?;
        let rows = stmt.query_map(
            params![pid, SHARED_PERSONALITY_ID, conversation_id, lim],
            MemoryAnchor::row_to_anchor,
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(MemoryError::from)
    }

    fn list_projects(&self, limit: usize) -> Result<Vec<StoredProject>, MemoryError> {
        let lim: i64 = limit.try_into().unwrap_or(i64::MAX);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, created_at FROM projects
             ORDER BY datetime(created_at) DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([lim], MemoryAnchor::row_to_project)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(MemoryError::from)
    }

    fn preference_get(&self, key: &str) -> Result<Option<String>, MemoryError> {
        let conn = self.conn()?;
        let r = conn.query_row(
            "SELECT value FROM preferences WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn preference_set(&self, key: &str, value: &str) -> Result<(), MemoryError> {
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO preferences (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        )?;
        Ok(())
    }

    fn preference_delete(&self, key: &str) -> Result<(), MemoryError> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM preferences WHERE key = ?1", [key])?;
        Ok(())
    }

    fn set_active_personality(&self, personality_id: &str) {
        let mut s = personality_id.trim().to_string();
        if s.is_empty() {
            s = DEFAULT_PERSONALITY_ID.to_string();
        }
        eprintln!("persistent-sage: MemoryAnchor active personality_id -> {s}");
        if let Ok(mut g) = self.active_personality_id.lock() {
            *g = s;
        }
    }

    fn wipe_all_user_data(&self) -> Result<(), MemoryError> {
        let conn = self.conn()?;
        eprintln!("persistent-sage: wipe_all_user_data — clearing SQLite user tables");
        conn.execute_batch(
            r"
            PRAGMA foreign_keys = OFF;
            DELETE FROM messages;
            DELETE FROM anchors;
            DELETE FROM projects;
            DELETE FROM preferences;
            DELETE FROM conversations;
            PRAGMA foreign_keys = ON;
            ",
        )?;
        ensure_seed_conversation(&conn)?;
        if let Err(e) = conn.execute("VACUUM", []) {
            eprintln!("persistent-sage: database_wipe_all VACUUM skipped: {e}");
        }
        Ok(())
    }
}

/// Directory containing `nova_memory.sqlite` and `settings.json` (same layout as DB parent).
#[must_use]
pub fn default_data_dir() -> Result<PathBuf, MemoryError> {
    default_db_path().and_then(|p| {
        p.parent()
            .map(Path::to_path_buf)
            .ok_or(MemoryError::NoDataDir)
    })
}

pub fn default_db_path() -> Result<PathBuf, MemoryError> {
    if let Ok(raw) =
        std::env::var("PERSISTENT_SAGE_DATA_DIR").or_else(|_| std::env::var("NOVA_DATA_DIR"))
    {
        let dir = PathBuf::from(raw.trim());
        if dir.as_os_str().is_empty() {
            return Err(MemoryError::NoDataDir);
        }
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("nova_memory.sqlite"));
    }

    let portable = std::env::var("PERSISTENT_SAGE_PORTABLE")
        .or_else(|_| std::env::var("NOVA_PORTABLE"))
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if portable {
        let exe = std::env::current_exe()?;
        let base = exe.parent().ok_or(MemoryError::NoDataDir)?;
        let data = base.join("data");
        std::fs::create_dir_all(&data)?;
        return Ok(data.join("nova_memory.sqlite"));
    }

    let dirs = directories::ProjectDirs::from("app", "Persistent Sage", "Persistent Sage")
        .ok_or(MemoryError::NoDataDir)?;
    std::fs::create_dir_all(dirs.data_dir())?;
    Ok(dirs.data_dir().join("nova_memory.sqlite"))
}

#[cfg(test)]
mod anchor_storage_tests {
    use super::*;

    #[test]
    fn image_columns_migrate_on_already_v6_db() {
        let dir = std::env::temp_dir().join(format!("nova_mem_img_mig_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("nova_memory.sqlite");
        {
            let conn = Connection::open(&path).expect("open");
            conn.execute_batch(
                r"PRAGMA user_version = 6;
                CREATE TABLE conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
                    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
                    personality_id TEXT NOT NULL DEFAULT 'default'
                );
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
                    personality_id TEXT NOT NULL DEFAULT 'default'
                );
                INSERT INTO conversations (id, title, personality_id) VALUES ('default', 'General', 'default');
                INSERT INTO messages (conversation_id, role, content, personality_id)
                    VALUES ('default', 'user', 'hello', 'default');",
            )
            .expect("seed");
        }
        let mem =
            MemoryAnchor::new_with_profile(&path, SqliteProfile::Portable).expect("open migrates");
        let msgs = ConversationMemory::get_recent(&mem, "default", 10).expect("get_recent");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "hello");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sqlite_anchor_content_roundtrips_long_unicode() {
        let dir = std::env::temp_dir().join(format!("nova_mem_anchor_test_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("m.sqlite");
        let mem = MemoryAnchor::new_with_profile(&path, SqliteProfile::Portable).expect("open db");
        let conv_id =
            ConversationMemory::create_conversation(&mem, "anchor-len-test").expect("conv");
        let body = "η".repeat(4000);
        let aid =
            ConversationMemory::create_anchor(&mem, Some(&conv_id), AnchorType::Fact, &body, 2)
                .expect("insert anchor");
        let list = ConversationMemory::list_anchors_for_thread(&mem, &conv_id, 50).expect("list");
        let got = list.iter().find(|a| a.id == aid).expect("row");
        assert_eq!(got.content, body);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn recall_query_vision_expands_to_colorblind() {
        let exp = MemoryAnchor::prepare_recall_query("Do you know anything about my vision?");
        assert!(exp.primary.iter().any(|t| t == "vision"));
        assert!(
            exp.expanded.iter().any(|t| t == "colorblind"),
            "vision queries should expand to colorblind for lexical recall: {:?}",
            exp.expanded
        );
    }

    #[test]
    fn extract_anchors_from_conversation_inserts_without_deadlock() {
        let dir = std::env::temp_dir().join(format!("nova_mem_extract_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("m.sqlite");
        let mem = MemoryAnchor::new_with_profile(&path, SqliteProfile::Portable).expect("open db");
        let conv = ConversationMemory::create_conversation(&mem, "extract-test").expect("conv");
        ConversationMemory::store_message(
            &mem,
            &conv,
            MessageRole::User,
            "I am colorblind and prefer high-contrast themes for all UI work.",
            None,
            None,
            None,
        )
        .expect("msg");
        let ids = ConversationMemory::create_anchor_from_conversation(&mem, &conv, 8)
            .expect("extract must not deadlock on conn mutex");
        assert!(!ids.is_empty());
        let list = ConversationMemory::list_anchors_for_thread(&mem, &conv, 50).expect("list");
        assert!(!list.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ingest_user_message_creates_global_anchor() {
        let dir = std::env::temp_dir().join(format!("nova_mem_ingest_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("m.sqlite");
        let mem = MemoryAnchor::new_with_profile(&path, SqliteProfile::Portable).expect("open db");
        let conv = ConversationMemory::create_conversation(&mem, "t1").expect("conv");
        let ids = ConversationMemory::ingest_user_message_anchors(
            &mem,
            &conv,
            "I am colorblind and prefer high-contrast themes.",
        )
        .expect("ingest");
        assert!(!ids.is_empty());
        let bundle =
            ConversationMemory::memory_recall(&mem, "vision", None, 8, 4, None).expect("recall");
        assert!(
            bundle
                .anchors
                .iter()
                .any(|a| a.content.to_lowercase().contains("colorblind"))
                || bundle
                    .messages
                    .iter()
                    .any(|m| m.content.to_lowercase().contains("colorblind")),
            "vision recall should surface colorblind fact: anchors={:?} msgs={:?}",
            bundle.anchors,
            bundle.messages
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn anchor_extraction_splits_long_clause_by_chars_not_512_bytes() {
        let sentence = "word ".repeat(200); // >512 bytes, many short “words”
        let c = anchor_candidates_from_user_message(&(sentence.clone() + "."));
        assert!(
            c.iter().any(|s| s.chars().count() > 512),
            "expected a chunk >512 chars, got {c:?}"
        );
    }
}
