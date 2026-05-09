//! Persistent conversation memory for Nova.
//!
//! ## Memory Anchor model (raw + curated)
//!
//! - **Raw layer** — [`AnchorType::Raw`]: auto-ingested snippets derived from chat
//!   (deterministic heuristics today; LLM extraction can replace later).
//! - **Curated layer** — [`AnchorType::Curated`], [`AnchorType::Fact`],
//!   [`AnchorType::Insight`]: user- or model-confirmed anchors worth recalling
//!   across sessions. Higher [`importance`] surfaces first in briefings.
//!
//! Chat transcripts live in `messages`; long-term recall uses `anchors`,
//! `projects`, and `preferences`. [`embedding`] is reserved for future semantic
//! search (local vectors); [`recall_anchors`] uses keyword search until then.

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
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: i64,
    pub role: MessageRole,
    pub content: String,
    pub created_at: String,
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
    ) -> Result<(), MemoryError>;

    fn get_recent(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredMessage>, MemoryError>;

    /// Rich briefing: recent transcript + anchors + projects + preferences.
    fn get_startup_briefing(&self, conversation_id: &str) -> Result<String, MemoryError>;

    /// Recomputes the rich briefing (same output as [`Self::get_startup_briefing`]).
    fn update_startup_briefing(&self, conversation_id: &str) -> Result<String, MemoryError>;

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

    /// Keyword recall; optional scope to one thread (plus always matches global anchors).
    fn recall_anchors(
        &self,
        query: &str,
        scope_conversation_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError>;

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
}

// --- Schema / migration -------------------------------------------------------

const SCHEMA_VERSION: i32 = 4;

const BRIEFING_MESSAGE_WINDOW: usize = 24;
const BRIEFING_SNIPPET_CHARS: usize = 280;
const BRIEFING_MAX_ANCHORS: usize = 12;
const BRIEFING_MAX_PROJECTS: usize = 8;
const BRIEFING_MAX_PREFS: usize = 12;

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
    ensure_seed_conversation(conn)?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
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
            updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
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
            created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
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

        INSERT INTO conversations (id, title) VALUES ('default', 'General');",
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
            created_at TEXT NOT NULL
        );
        INSERT INTO messages_new (conversation_id, role, content, created_at)
            SELECT 'default', role, content, created_at FROM messages;
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
            "INSERT INTO conversations (id, title) VALUES ('default', 'General')",
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
    let data_dir_set = std::env::var("NOVA_DATA_DIR")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let portable_flag = std::env::var("NOVA_PORTABLE")
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if data_dir_set || portable_flag {
        SqliteProfile::Portable
    } else {
        SqliteProfile::Desktop
    }
}

pub fn apply_profile_pragmas(conn: &Connection, profile: SqliteProfile) -> Result<(), rusqlite::Error> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
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
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        apply_profile_pragmas(&conn, profile)?;
        migrate_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn open_default() -> Result<Self, MemoryError> {
        Self::new(default_db_path()?)
    }

    fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, MemoryError> {
        self.conn.lock().map_err(|_| MemoryError::LockPoisoned)
    }

    fn assert_conversation_exists(&self, id: &str) -> Result<(), MemoryError> {
        let conn = self.conn()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM conversations WHERE id = ?1",
            [id],
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
    fn compose_enriched_briefing(&self, conversation_id: &str) -> Result<String, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;

        let recent = self.get_recent(conversation_id, BRIEFING_MESSAGE_WINDOW)?;
        let anchors = self.list_anchors_for_thread(conversation_id, BRIEFING_MAX_ANCHORS)?;
        let projects = self.list_projects(BRIEFING_MAX_PROJECTS)?;
        let prefs = self.list_preferences_for_briefing(BRIEFING_MAX_PREFS)?;

        let mut out = String::new();

        out.push_str("# Nova session context\n\n");

        out.push_str("## Recent transcript\n");
        if recent.is_empty() {
            out.push_str("_No messages in this thread yet._\n\n");
        } else {
            for m in &recent {
                let label = match m.role {
                    MessageRole::User => "User",
                    MessageRole::Assistant => "Nova",
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
                out.push_str(&format!(
                    "- **{}** [{}]: {}\n",
                    p.title, p.status, desc
                ));
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
        let mut stmt = conn.prepare(
            "SELECT key, value FROM preferences ORDER BY key ASC LIMIT ?1",
        )?;
        let rows = stmt.query_map([lim], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let rows: Vec<(String, String)> = rows.collect::<Result<Vec<_>, _>>().map_err(MemoryError::from)?;
        Ok(rows
            .into_iter()
            .filter(|(k, _)| !k.contains("api_key") && !k.contains("secret"))
            .collect())
    }
}

impl ConversationMemory for MemoryAnchor {
    fn store_message(
        &self,
        conversation_id: &str,
        role: MessageRole,
        content: &str,
    ) -> Result<(), MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?1, ?2, ?3)",
            params![conversation_id, role.as_db_str(), content],
        )?;
        conn.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [conversation_id],
        )?;
        Ok(())
    }

    fn get_recent(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredMessage>, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let limit_i: i64 = limit.try_into().unwrap_or(i64::MAX);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, role, content, created_at FROM messages
             WHERE conversation_id = ?1
             ORDER BY id DESC LIMIT ?2",
        )?;
        let mut rows = stmt.query(params![conversation_id, limit_i])?;
        let mut batch = Vec::new();
        while let Some(row) = rows.next()? {
            let role_str: String = row.get(1)?;
            batch.push(StoredMessage {
                id: row.get(0)?,
                role: MessageRole::parse_db(&role_str)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
            });
        }
        batch.reverse();
        Ok(batch)
    }

    fn get_startup_briefing(&self, conversation_id: &str) -> Result<String, MemoryError> {
        self.compose_enriched_briefing(conversation_id)
    }

    fn update_startup_briefing(&self, conversation_id: &str) -> Result<String, MemoryError> {
        self.compose_enriched_briefing(conversation_id)
    }

    fn list_conversations(&self) -> Result<Vec<StoredConversation>, MemoryError> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at FROM conversations
             ORDER BY datetime(updated_at) DESC, id DESC",
        )?;
        let rows = stmt.query_map([], MemoryAnchor::row_to_conversation)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(MemoryError::from)
    }

    fn get_conversation(&self, conversation_id: &str) -> Result<StoredConversation, MemoryError> {
        let conn = self.conn()?;
        let row = conn.query_row(
            "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?1",
            [conversation_id],
            MemoryAnchor::row_to_conversation,
        );
        match row {
            Ok(c) => Ok(c),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(MemoryError::UnknownConversation(conversation_id.to_string()))
            }
            Err(e) => Err(MemoryError::from(e)),
        }
    }

    fn create_conversation(&self, title: &str) -> Result<String, MemoryError> {
        let id = Uuid::new_v4().to_string();
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO conversations (id, title) VALUES (?1, ?2)",
            params![id, title],
        )?;
        Ok(id)
    }

    fn rename_conversation(&self, conversation_id: &str, title: &str) -> Result<(), MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let conn = self.conn()?;
        let n = conn.execute(
            "UPDATE conversations SET title = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![conversation_id, title],
        )?;
        if n == 0 {
            return Err(MemoryError::UnknownConversation(conversation_id.to_string()));
        }
        Ok(())
    }

    fn delete_conversation(&self, conversation_id: &str) -> Result<(), MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let conn = self.conn()?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", [conversation_id])?;
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
        let id = Uuid::new_v4().to_string();
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO anchors (id, conversation_id, anchor_type, content, importance)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                conversation_id,
                anchor_type.as_db_str(),
                content,
                importance
            ],
        )?;
        Ok(id)
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
            for part in m
                .content
                .split(|c| matches!(c, '\n' | '.' | '?' | '!' | ';'))
            {
                let s = part.trim();
                if s.len() >= 12 && s.len() <= 512 {
                    candidates.push(s.to_string());
                }
            }
        }

        candidates.sort_by(|a, b| b.len().cmp(&a.len()));
        candidates.dedup();

        let mut ids = Vec::new();
        for text in candidates.into_iter().take(max_anchors) {
            let dup: i64 = {
                let conn = self.conn()?;
                conn.query_row(
                    "SELECT COUNT(*) FROM anchors WHERE conversation_id = ?1 AND content = ?2",
                    params![conversation_id, &text],
                    |r| r.get(0),
                )?
            };
            if dup > 0 {
                continue;
            }
            ids.push(self.create_anchor(
                Some(conversation_id),
                AnchorType::Raw,
                &text,
                1,
            )?);
        }
        Ok(ids)
    }

    fn recall_anchors(
        &self,
        query: &str,
        scope_conversation_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let lim: i64 = limit.try_into().unwrap_or(i64::MAX);
        let pat = format!("%{}%", escape_like(query.trim()));
        let conn = self.conn()?;

        let mut out: Vec<StoredAnchor> = match scope_conversation_id {
            Some(cid) => {
                self.assert_conversation_exists(cid)?;
                let mut stmt = conn.prepare(
                    "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
                     FROM anchors
                     WHERE content LIKE ?1 ESCAPE '\\'
                       AND (conversation_id IS NULL OR conversation_id = ?2)
                     ORDER BY importance DESC, datetime(created_at) DESC
                     LIMIT ?3",
                )?;
                let rows = stmt.query_map(params![pat, cid, lim], MemoryAnchor::row_to_anchor)?;
                rows.collect::<Result<Vec<_>, _>>()?
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
                     FROM anchors
                     WHERE content LIKE ?1 ESCAPE '\\'
                     ORDER BY importance DESC, datetime(created_at) DESC
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![pat, lim], MemoryAnchor::row_to_anchor)?;
                rows.collect::<Result<Vec<_>, _>>()?
            }
        };

        out.sort_by(|a, b| b.importance.cmp(&a.importance));
        Ok(out)
    }

    fn list_anchors_for_thread(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> Result<Vec<StoredAnchor>, MemoryError> {
        self.assert_conversation_exists(conversation_id)?;
        let lim: i64 = limit.try_into().unwrap_or(i64::MAX);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, anchor_type, content, importance, embedding, created_at
             FROM anchors
             WHERE conversation_id IS NULL OR conversation_id = ?1
             ORDER BY importance DESC, datetime(created_at) DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![conversation_id, lim], MemoryAnchor::row_to_anchor)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(MemoryError::from)
    }

    fn list_projects(&self, limit: usize) -> Result<Vec<StoredProject>, MemoryError> {
        let lim: i64 = limit.try_into().unwrap_or(i64::MAX);
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, description, status, created_at FROM projects
             ORDER BY datetime(created_at) DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([lim], MemoryAnchor::row_to_project)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(MemoryError::from)
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
    if let Ok(raw) = std::env::var("NOVA_DATA_DIR") {
        let dir = PathBuf::from(raw.trim());
        if dir.as_os_str().is_empty() {
            return Err(MemoryError::NoDataDir);
        }
        std::fs::create_dir_all(&dir)?;
        return Ok(dir.join("nova_memory.sqlite"));
    }

    if std::env::var("NOVA_PORTABLE")
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        let exe = std::env::current_exe()?;
        let base = exe.parent().ok_or(MemoryError::NoDataDir)?;
        let data = base.join("data");
        std::fs::create_dir_all(&data)?;
        return Ok(data.join("nova_memory.sqlite"));
    }

    let dirs =
        directories::ProjectDirs::from("app", "Nova", "Nova").ok_or(MemoryError::NoDataDir)?;
    std::fs::create_dir_all(dirs.data_dir())?;
    Ok(dirs.data_dir().join("nova_memory.sqlite"))
}
