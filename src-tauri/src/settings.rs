//! Persistent app settings with AES-256-GCM encrypted API keys.
//!
//! **IKM (input keying material)** is stored in `{data_dir}/.nova_crypto/ikm`
//! (32 bytes). That file is authoritative: the OS keyring is only used to
//! migrate older installs or as a best-effort mirror so keyring-only setups
//! still converge to a stable on-disk secret. Argon2id + a persisted salt
//! derives the AES-256-GCM key used for API keys in `settings.json`.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use argon2::{Argon2, Params};
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::SecureRandom;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use thiserror::Error;

use crate::database_query::{PREF_DATABASE_ALLOW_WRITE, PREF_DATABASE_APP_DATA};
use crate::memory::{ConversationMemory, MemoryError};

const KEYRING_SERVICE: &str = "Persistent Sage";
const LEGACY_KEYRING_SERVICE: &str = "Nova";
const KEYRING_USER: &str = "settings_master_ikm";
const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("crypto: {0}")]
    Crypto(String),

    #[error("memory: {0}")]
    Memory(#[from] MemoryError),

    #[error("invalid API key slot `{0}`")]
    InvalidKeySlot(String),
}

// --- Disk format -------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedApiKeyBlob {
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub selected_provider: String,
    #[serde(default)]
    pub openai_model: String,
    #[serde(default)]
    pub openai_base_url: String,
    #[serde(default)]
    pub ollama_model: String,
    #[serde(default = "default_ollama_cloud_model")]
    pub ollama_cloud_model: String,
    #[serde(default)]
    pub ollama_base_url: String,
    #[serde(default)]
    pub anthropic_model: String,
    #[serde(default = "default_gemini_model")]
    pub gemini_model: String,
    #[serde(default = "default_gemini_base_url")]
    pub gemini_base_url: String,
    #[serde(default = "default_xai_model")]
    pub xai_model: String,
    #[serde(default = "default_xai_base_url")]
    pub xai_base_url: String,
    #[serde(default = "default_thinking_effort")]
    pub thinking_effort: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    pub max_tokens: Option<u32>,
    #[serde(default = "default_agent_web_tools")]
    pub agent_web_tools_enabled: bool,
    #[serde(default = "default_agent_browser_fetch")]
    pub agent_browser_fetch_enabled: bool,
    #[serde(default = "default_agent_browser_ignore_robots")]
    pub agent_browser_ignore_robots: bool,
    #[serde(default = "default_agent_workspace")]
    pub agent_workspace_enabled: bool,
    #[serde(default = "default_agent_coding_tools")]
    pub agent_coding_tools_enabled: bool,
    #[serde(default = "default_agent_coding_shell")]
    pub agent_coding_shell_enabled: bool,
    #[serde(default = "default_agent_coding_git")]
    pub agent_coding_git_enabled: bool,
    #[serde(default = "default_agent_personality_edit")]
    pub agent_personality_edit_enabled: bool,
    #[serde(default = "default_database_allow_write")]
    pub database_allow_write: bool,
    #[serde(default = "default_database_app_data")]
    pub database_app_data_enabled: bool,
    #[serde(default = "default_pulse_enabled")]
    pub pulse_enabled: bool,
    #[serde(default = "default_pulse_interval_minutes")]
    pub pulse_interval_minutes: u32,
    #[serde(default = "default_pulse_instructions")]
    pub pulse_instructions: String,
    /// Conversation id Pulse appends to (same thread as the open chat). Omitted/null = none.
    pub pulse_conversation_id: Option<String>,
    #[serde(default = "default_memory_llm_extraction")]
    pub memory_llm_extraction_enabled: bool,
    #[serde(default = "default_memory_semantic")]
    pub memory_semantic_enabled: bool,
    /// Optional override (e.g. `text-embedding-3-small`, `nomic-embed-text`). Empty = provider default.
    #[serde(default)]
    pub embedding_model: String,
    #[serde(default)]
    pub encrypted_api_keys: HashMap<String, EncryptedApiKeyBlob>,
    /// First-run setup wizard in the UI (provider + API keys).
    #[serde(default)]
    pub onboarding_completed: bool,
    /// App version for which the user dismissed the “What’s new” dialog (empty = never shown).
    #[serde(default)]
    pub whats_new_seen_version: String,
    /// When true, assistant replies may include renderable chat artifacts (HTML, charts, forms).
    #[serde(default = "default_artifacts_enabled")]
    pub artifacts_enabled: bool,
}

fn default_artifacts_enabled() -> bool {
    true
}

fn default_memory_llm_extraction() -> bool {
    true
}

fn default_memory_semantic() -> bool {
    true
}

fn default_agent_web_tools() -> bool {
    false
}

fn default_agent_browser_fetch() -> bool {
    false
}

fn default_agent_browser_ignore_robots() -> bool {
    false
}

fn default_agent_workspace() -> bool {
    false
}

fn default_agent_coding_tools() -> bool {
    false
}

fn default_agent_coding_shell() -> bool {
    false
}

fn default_agent_coding_git() -> bool {
    false
}

fn default_agent_personality_edit() -> bool {
    false
}

fn default_database_allow_write() -> bool {
    false
}

fn default_database_app_data() -> bool {
    false
}

fn default_pulse_enabled() -> bool {
    false
}

fn default_pulse_interval_minutes() -> u32 {
    15
}

fn default_pulse_instructions() -> String {
    "Briefly check in: any reminders, open loops, or a short note the user might appreciate. Keep it to a few sentences unless they ask for more detail.".into()
}

fn default_version() -> u32 {
    SETTINGS_VERSION
}

fn default_temperature() -> f32 {
    0.7
}

fn default_thinking_effort() -> String {
    "medium".into()
}

fn default_gemini_model() -> String {
    "gemini-2.5-flash".into()
}

fn default_ollama_cloud_model() -> String {
    "gpt-oss:120b-cloud".into()
}

fn default_gemini_base_url() -> String {
    "https://generativelanguage.googleapis.com/v1beta".into()
}

fn default_xai_model() -> String {
    "grok-4-fast-reasoning".into()
}

fn default_xai_base_url() -> String {
    "https://api.x.ai/v1".into()
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            selected_provider: "placeholder".into(),
            openai_model: "gpt-4o-mini".into(),
            openai_base_url: "https://api.openai.com/v1".into(),
            ollama_model: "llama3.2".into(),
            ollama_cloud_model: default_ollama_cloud_model(),
            ollama_base_url: "http://127.0.0.1:11434".into(),
            anthropic_model: "claude-3-5-sonnet-20241022".into(),
            gemini_model: default_gemini_model(),
            gemini_base_url: default_gemini_base_url(),
            xai_model: default_xai_model(),
            xai_base_url: default_xai_base_url(),
            thinking_effort: default_thinking_effort(),
            temperature: 0.7,
            max_tokens: None,
            agent_web_tools_enabled: false,
            agent_browser_fetch_enabled: false,
            agent_browser_ignore_robots: false,
            agent_workspace_enabled: false,
            agent_coding_tools_enabled: false,
            agent_coding_shell_enabled: false,
            agent_coding_git_enabled: false,
            agent_personality_edit_enabled: false,
            database_allow_write: false,
            database_app_data_enabled: false,
            pulse_enabled: false,
            pulse_interval_minutes: 15,
            pulse_instructions: default_pulse_instructions(),
            pulse_conversation_id: None,
            memory_llm_extraction_enabled: true,
            memory_semantic_enabled: true,
            embedding_model: String::new(),
            encrypted_api_keys: HashMap::new(),
            onboarding_completed: false,
            whats_new_seen_version: String::new(),
            artifacts_enabled: default_artifacts_enabled(),
        }
    }
}

/// Payload returned to the React settings panel (no secrets).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub selected_provider: String,
    pub openai_model: String,
    pub openai_base_url: String,
    pub ollama_model: String,
    pub ollama_cloud_model: String,
    pub ollama_base_url: String,
    pub anthropic_model: String,
    pub gemini_model: String,
    pub gemini_base_url: String,
    pub xai_model: String,
    pub xai_base_url: String,
    pub thinking_effort: String,
    pub temperature: f32,
    pub max_tokens: Option<u32>,
    pub agent_web_tools_enabled: bool,
    pub agent_browser_fetch_enabled: bool,
    pub agent_browser_ignore_robots: bool,
    pub agent_workspace_enabled: bool,
    pub agent_coding_tools_enabled: bool,
    pub agent_coding_shell_enabled: bool,
    pub agent_coding_git_enabled: bool,
    pub agent_personality_edit_enabled: bool,
    pub database_allow_write: bool,
    pub database_app_data_enabled: bool,
    pub pulse_enabled: bool,
    pub pulse_interval_minutes: u32,
    pub pulse_instructions: String,
    pub pulse_conversation_id: Option<String>,
    pub memory_llm_extraction_enabled: bool,
    pub memory_semantic_enabled: bool,
    pub embedding_model: String,
    pub has_openai_api_key: bool,
    pub has_anthropic_api_key: bool,
    pub has_ollama_api_key: bool,
    pub has_gemini_api_key: bool,
    pub has_xai_api_key: bool,
    pub onboarding_completed: bool,
    pub whats_new_seen_version: String,
    pub artifacts_enabled: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdatePayload {
    pub selected_provider: Option<String>,
    pub openai_model: Option<String>,
    pub openai_base_url: Option<String>,
    pub ollama_model: Option<String>,
    pub ollama_cloud_model: Option<String>,
    pub ollama_base_url: Option<String>,
    pub anthropic_model: Option<String>,
    pub gemini_model: Option<String>,
    pub gemini_base_url: Option<String>,
    pub xai_model: Option<String>,
    pub xai_base_url: Option<String>,
    pub thinking_effort: Option<String>,
    pub temperature: Option<f32>,
    /// Omitted = no change. JSON `null` = clear cap. Number = set cap (`Option<Option<u32>>`
    /// cannot represent “present null” from JS; use [`JsonValue`]).
    pub max_tokens: Option<JsonValue>,
    pub agent_web_tools_enabled: Option<bool>,
    pub agent_browser_fetch_enabled: Option<bool>,
    pub agent_browser_ignore_robots: Option<bool>,
    pub agent_workspace_enabled: Option<bool>,
    pub agent_coding_tools_enabled: Option<bool>,
    pub agent_coding_shell_enabled: Option<bool>,
    pub agent_coding_git_enabled: Option<bool>,
    pub agent_personality_edit_enabled: Option<bool>,
    pub database_allow_write: Option<bool>,
    pub database_app_data_enabled: Option<bool>,
    pub pulse_enabled: Option<bool>,
    pub pulse_interval_minutes: Option<u32>,
    pub pulse_instructions: Option<String>,
    pub pulse_conversation_id: Option<JsonValue>,
    pub memory_llm_extraction_enabled: Option<bool>,
    pub memory_semantic_enabled: Option<bool>,
    pub embedding_model: Option<String>,
    pub onboarding_completed: Option<bool>,
    pub whats_new_seen_version: Option<String>,
    pub artifacts_enabled: Option<bool>,
}

// --- Crypto ------------------------------------------------------------------

fn b64e(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn b64d(s: &str) -> Result<Vec<u8>, SettingsError> {
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| SettingsError::Crypto(e.to_string()))
}

fn encrypt_aes_gcm(key: &[u8; 32], plaintext: &[u8]) -> Result<EncryptedApiKeyBlob, SettingsError> {
    let rng = ring::rand::SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| SettingsError::Crypto("rng nonce".into()))?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let k = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key)
            .map_err(|_| SettingsError::Crypto("bad aes key".into()))?,
    );
    let mut buf = plaintext.to_vec();
    let tag = k
        .seal_in_place_separate_tag(nonce, Aad::empty(), &mut buf)
        .map_err(|_| SettingsError::Crypto("seal".into()))?;
    buf.extend_from_slice(tag.as_ref());
    Ok(EncryptedApiKeyBlob {
        nonce: b64e(&nonce_bytes),
        ciphertext: b64e(&buf),
    })
}

fn decrypt_aes_gcm(key: &[u8; 32], blob: &EncryptedApiKeyBlob) -> Result<Vec<u8>, SettingsError> {
    let nonce_bytes = b64d(&blob.nonce)?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(SettingsError::Crypto("bad nonce length".into()));
    }
    let mut nonce_arr = [0u8; NONCE_LEN];
    nonce_arr.copy_from_slice(&nonce_bytes);
    let nonce = Nonce::assume_unique_for_key(nonce_arr);
    let mut combined = b64d(&blob.ciphertext)?;
    if combined.len() < 16 {
        return Err(SettingsError::Crypto("truncated ciphertext".into()));
    }
    let k = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key)
            .map_err(|_| SettingsError::Crypto("bad aes key".into()))?,
    );
    let plain = k
        .open_in_place(nonce, Aad::empty(), &mut combined)
        .map_err(|_| SettingsError::Crypto("decrypt failed (wrong key or corrupt data)".into()))?;
    Ok(plain.to_vec())
}

fn stretch_ikm_to_aes_key(ikm: &[u8; 32], salt: &[u8; 16]) -> Result<[u8; 32], SettingsError> {
    let params =
        Params::new(19456, 2, 1, None).map_err(|e| SettingsError::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut out = [0u8; 32];
    argon2
        .hash_password_into(ikm, salt, &mut out)
        .map_err(|e| SettingsError::Crypto(e.to_string()))?;
    Ok(out)
}

#[cfg(unix)]
fn write_secret_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(data)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_secret_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, data)
}

fn read_exact(path: &Path, n: usize) -> Result<Vec<u8>, SettingsError> {
    let v = std::fs::read(path)?;
    if v.len() != n {
        return Err(SettingsError::Crypto(format!(
            "expected {n} bytes in {}",
            path.display()
        )));
    }
    Ok(v)
}

fn load_or_create_salt(data_dir: &Path) -> Result<[u8; 16], SettingsError> {
    let dir = data_dir.join(".nova_crypto");
    std::fs::create_dir_all(&dir)?;
    let salt_path = dir.join("salt");
    if salt_path.exists() {
        let v = read_exact(&salt_path, 16)?;
        let mut s = [0u8; 16];
        s.copy_from_slice(&v);
        return Ok(s);
    }
    let rng = ring::rand::SystemRandom::new();
    let mut s = [0u8; 16];
    rng.fill(&mut s)
        .map_err(|_| SettingsError::Crypto("rng salt".into()))?;
    write_secret_file(&salt_path, &s)?;
    Ok(s)
}

/// Load or create the 32-byte IKM. **`ikm` on disk is canonical** so the same
/// Argon2 salt + IKM always yields the same AES key across restarts, even if
/// the OS keyring is intermittently unavailable.
fn load_or_create_ikm(data_dir: &Path) -> Result<[u8; 32], SettingsError> {
    let dir = data_dir.join(".nova_crypto");
    std::fs::create_dir_all(&dir)?;
    let ikm_path = dir.join("ikm");

    if ikm_path.exists() {
        let v = read_exact(&ikm_path, 32)?;
        let mut ikm = [0u8; 32];
        ikm.copy_from_slice(&v);
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            let _ = entry.set_password(&hex::encode(ikm));
        }
        return Ok(ikm);
    }

    // Legacy: IKM only in keyring (older beta installs). Copy to disk once so all future runs match.
    for service in [KEYRING_SERVICE, LEGACY_KEYRING_SERVICE] {
        if let Ok(entry) = keyring::Entry::new(service, KEYRING_USER) {
            let Ok(hex_str) = entry.get_password() else {
                continue;
            };
            let bytes = hex::decode(hex_str.trim())
                .map_err(|_| SettingsError::Crypto("keyring hex decode".into()))?;
            if bytes.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                write_secret_file(&ikm_path, &k)?;
                return Ok(k);
            }
        }
    }

    let rng = ring::rand::SystemRandom::new();
    let mut ikm = [0u8; 32];
    rng.fill(&mut ikm)
        .map_err(|_| SettingsError::Crypto("rng ikm".into()))?;
    write_secret_file(&ikm_path, &ikm)?;
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.set_password(&hex::encode(ikm));
    }
    Ok(ikm)
}

fn derive_aes_key(data_dir: &Path) -> Result<[u8; 32], SettingsError> {
    let ikm = load_or_create_ikm(data_dir)?;
    let salt = load_or_create_salt(data_dir)?;
    stretch_ikm_to_aes_key(&ikm, &salt)
}

fn can_decrypt_api_blob(aes_key: &[u8; 32], blob: Option<&EncryptedApiKeyBlob>) -> bool {
    match blob {
        None => false,
        Some(b) => decrypt_aes_gcm(aes_key, b)
            .ok()
            .filter(|p| !p.is_empty())
            .and_then(|p| String::from_utf8(p).ok())
            .filter(|s| !s.trim().is_empty())
            .is_some(),
    }
}

// --- Manager -----------------------------------------------------------------

pub struct SettingsManager {
    path: PathBuf,
    aes_key: [u8; 32],
    inner: RwLock<SettingsFile>,
    memory: std::sync::Arc<dyn ConversationMemory + Send + Sync>,
}

impl SettingsManager {
    pub fn load(
        data_dir: PathBuf,
        memory: std::sync::Arc<dyn ConversationMemory + Send + Sync>,
    ) -> Result<Self, SettingsError> {
        let aes_key = derive_aes_key(&data_dir)?;
        let path = data_dir.join("settings.json");
        let file = if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            serde_json::from_str(&raw)?
        } else {
            let mut s = SettingsFile::default();
            migrate_sqlite_into_file(&memory, &mut s)?;
            Self::migrate_plaintext_api_keys_from_sqlite(&aes_key, &memory, &mut s)?;
            let mgr = SettingsManager {
                path: path.clone(),
                aes_key,
                inner: RwLock::new(s),
                memory: memory.clone(),
            };
            mgr.persist_unlocked()?;
            mgr.strip_secret_sqlite_prefs()?;
            return Ok(mgr);
        };

        let mgr = Self {
            path,
            aes_key,
            inner: RwLock::new(file),
            memory: memory.clone(),
        };
        mgr.sync_public_prefs()?;
        Ok(mgr)
    }

    fn persist_unlocked(&self) -> Result<(), SettingsError> {
        let inner = self
            .inner
            .read()
            .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
        let json = serde_json::to_string_pretty(&*inner)?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_secret_file(&self.path, json.as_bytes())?;
        Ok(())
    }

    pub fn persist(&self) -> Result<(), SettingsError> {
        self.persist_unlocked()?;
        self.sync_public_prefs()?;
        Ok(())
    }

    /// Non-secret preferences mirrored for legacy / briefing (secrets never stored here).
    fn sync_public_prefs(&self) -> Result<(), SettingsError> {
        let inner = self
            .inner
            .read()
            .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
        self.memory
            .preference_set("nova.provider.active", inner.selected_provider.trim())?;
        self.memory
            .preference_set("nova.openai.model", inner.openai_model.trim())?;
        self.memory
            .preference_set("nova.openai.base_url", inner.openai_base_url.trim())?;
        self.memory
            .preference_set("nova.ollama.model", inner.ollama_model.trim())?;
        self.memory.preference_set(
            "persistent_sage.ollama_cloud.model",
            inner.ollama_cloud_model.trim(),
        )?;
        self.memory
            .preference_set("nova.ollama.base_url", inner.ollama_base_url.trim())?;
        self.memory
            .preference_set("persistent_sage.gemini.model", inner.gemini_model.trim())?;
        self.memory.preference_set(
            "persistent_sage.gemini.base_url",
            inner.gemini_base_url.trim(),
        )?;
        self.memory
            .preference_set("persistent_sage.xai.model", inner.xai_model.trim())?;
        self.memory
            .preference_set("persistent_sage.xai.base_url", inner.xai_base_url.trim())?;
        self.memory.preference_set(
            "persistent_sage.thinking_effort",
            inner.thinking_effort.trim(),
        )?;
        self.memory.preference_set(
            PREF_DATABASE_ALLOW_WRITE,
            if inner.database_allow_write {
                "true"
            } else {
                "false"
            },
        )?;
        self.memory.preference_set(
            PREF_DATABASE_APP_DATA,
            if inner.database_app_data_enabled {
                "true"
            } else {
                "false"
            },
        )?;
        Ok(())
    }

    fn strip_secret_sqlite_prefs(&self) -> Result<(), SettingsError> {
        let _ = self.memory.preference_delete("nova.openai.api_key");
        let _ = self.memory.preference_delete("nova.anthropic.api_key");
        let _ = self.memory.preference_delete("nova.ollama.api_key");
        let _ = self
            .memory
            .preference_delete("persistent_sage.gemini.api_key");
        let _ = self.memory.preference_delete("persistent_sage.xai.api_key");
        Ok(())
    }

    pub fn view(&self) -> Result<SettingsView, SettingsError> {
        let inner = self
            .inner
            .read()
            .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
        Ok(SettingsView {
            selected_provider: inner.selected_provider.clone(),
            openai_model: inner.openai_model.clone(),
            openai_base_url: inner.openai_base_url.clone(),
            ollama_model: inner.ollama_model.clone(),
            ollama_cloud_model: inner.ollama_cloud_model.clone(),
            ollama_base_url: inner.ollama_base_url.clone(),
            anthropic_model: inner.anthropic_model.clone(),
            gemini_model: inner.gemini_model.clone(),
            gemini_base_url: inner.gemini_base_url.clone(),
            xai_model: inner.xai_model.clone(),
            xai_base_url: inner.xai_base_url.clone(),
            thinking_effort: inner.thinking_effort.clone(),
            temperature: inner.temperature,
            max_tokens: inner.max_tokens,
            agent_web_tools_enabled: inner.agent_web_tools_enabled,
            agent_browser_fetch_enabled: inner.agent_browser_fetch_enabled,
            agent_browser_ignore_robots: inner.agent_browser_ignore_robots,
            agent_workspace_enabled: inner.agent_workspace_enabled,
            agent_coding_tools_enabled: inner.agent_coding_tools_enabled,
            agent_coding_shell_enabled: inner.agent_coding_shell_enabled,
            agent_coding_git_enabled: inner.agent_coding_git_enabled,
            agent_personality_edit_enabled: inner.agent_personality_edit_enabled,
            database_allow_write: inner.database_allow_write,
            database_app_data_enabled: inner.database_app_data_enabled,
            pulse_enabled: inner.pulse_enabled,
            pulse_interval_minutes: inner.pulse_interval_minutes,
            pulse_instructions: inner.pulse_instructions.clone(),
            pulse_conversation_id: inner.pulse_conversation_id.clone(),
            memory_llm_extraction_enabled: inner.memory_llm_extraction_enabled,
            memory_semantic_enabled: inner.memory_semantic_enabled,
            embedding_model: inner.embedding_model.clone(),
            has_openai_api_key: can_decrypt_api_blob(
                &self.aes_key,
                inner.encrypted_api_keys.get("openai"),
            ),
            has_anthropic_api_key: can_decrypt_api_blob(
                &self.aes_key,
                inner.encrypted_api_keys.get("anthropic"),
            ),
            has_ollama_api_key: can_decrypt_api_blob(
                &self.aes_key,
                inner.encrypted_api_keys.get("ollama"),
            ),
            has_gemini_api_key: can_decrypt_api_blob(
                &self.aes_key,
                inner.encrypted_api_keys.get("gemini"),
            ),
            has_xai_api_key: can_decrypt_api_blob(
                &self.aes_key,
                inner.encrypted_api_keys.get("xai"),
            ),
            onboarding_completed: inner.onboarding_completed,
            whats_new_seen_version: inner.whats_new_seen_version.clone(),
            artifacts_enabled: inner.artifacts_enabled,
        })
    }

    pub fn artifacts_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.artifacts_enabled)
            .unwrap_or(true)
    }

    pub fn temperature(&self) -> f32 {
        self.inner.read().map(|g| g.temperature).unwrap_or(0.7)
    }

    pub fn thinking_effort(&self) -> String {
        self.inner
            .read()
            .map(|g| normalize_thinking_effort(&g.thinking_effort))
            .unwrap_or_else(|_| default_thinking_effort())
    }

    pub fn max_tokens(&self) -> Option<u32> {
        self.inner.read().ok().and_then(|g| g.max_tokens)
    }

    pub fn agent_web_tools_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_web_tools_enabled)
            .unwrap_or(false)
    }

    pub fn agent_browser_fetch_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_browser_fetch_enabled)
            .unwrap_or(false)
    }

    pub fn agent_browser_ignore_robots(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_browser_ignore_robots)
            .unwrap_or(false)
    }

    pub fn agent_workspace_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_workspace_enabled)
            .unwrap_or(false)
    }

    pub fn agent_coding_tools_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_coding_tools_enabled)
            .unwrap_or(false)
    }

    pub fn agent_coding_shell_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_coding_shell_enabled)
            .unwrap_or(false)
    }

    pub fn agent_coding_git_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_coding_git_enabled)
            .unwrap_or(false)
    }

    pub fn agent_personality_edit_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.agent_personality_edit_enabled)
            .unwrap_or(false)
    }

    pub fn database_allow_write(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.database_allow_write)
            .unwrap_or(false)
    }

    pub fn database_app_data_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.database_app_data_enabled)
            .unwrap_or(false)
    }

    pub fn selected_provider(&self) -> String {
        self.inner
            .read()
            .map(|g| g.selected_provider.clone())
            .unwrap_or_else(|_| "placeholder".into())
    }

    pub fn openai_model(&self) -> String {
        self.inner
            .read()
            .map(|g| g.openai_model.clone())
            .unwrap_or_else(|_| "gpt-4o-mini".into())
    }

    pub fn openai_base_url(&self) -> String {
        self.inner
            .read()
            .map(|g| g.openai_base_url.clone())
            .unwrap_or_else(|_| "https://api.openai.com/v1".into())
    }

    pub fn ollama_model(&self) -> String {
        self.inner
            .read()
            .map(|g| g.ollama_model.clone())
            .unwrap_or_else(|_| "llama3.2".into())
    }

    pub fn ollama_cloud_model(&self) -> String {
        self.inner
            .read()
            .map(|g| g.ollama_cloud_model.clone())
            .unwrap_or_else(|_| default_ollama_cloud_model())
    }

    pub fn ollama_base_url(&self) -> String {
        self.inner
            .read()
            .map(|g| g.ollama_base_url.clone())
            .unwrap_or_else(|_| "http://127.0.0.1:11434".into())
    }

    pub fn anthropic_model(&self) -> String {
        self.inner
            .read()
            .map(|g| g.anthropic_model.clone())
            .unwrap_or_else(|_| "claude-3-5-sonnet-20241022".into())
    }

    pub fn gemini_model(&self) -> String {
        self.inner
            .read()
            .map(|g| g.gemini_model.clone())
            .unwrap_or_else(|_| default_gemini_model())
    }

    pub fn gemini_base_url(&self) -> String {
        self.inner
            .read()
            .map(|g| g.gemini_base_url.clone())
            .unwrap_or_else(|_| default_gemini_base_url())
    }

    pub fn xai_model(&self) -> String {
        self.inner
            .read()
            .map(|g| g.xai_model.clone())
            .unwrap_or_else(|_| default_xai_model())
    }

    pub fn xai_base_url(&self) -> String {
        self.inner
            .read()
            .map(|g| g.xai_base_url.clone())
            .unwrap_or_else(|_| default_xai_base_url())
    }

    pub fn memory_llm_extraction_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.memory_llm_extraction_enabled)
            .unwrap_or(true)
    }

    pub fn memory_semantic_enabled(&self) -> bool {
        self.inner
            .read()
            .map(|g| g.memory_semantic_enabled)
            .unwrap_or(true)
    }

    pub fn embedding_model(&self) -> String {
        self.inner
            .read()
            .map(|g| g.embedding_model.clone())
            .unwrap_or_default()
    }

    pub fn decrypt_api_key(&self, slot: &str) -> Result<Option<String>, SettingsError> {
        let inner = self
            .inner
            .read()
            .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
        let Some(blob) = inner.encrypted_api_keys.get(slot) else {
            return Ok(None);
        };
        match decrypt_aes_gcm(&self.aes_key, blob) {
            Ok(plain) => match String::from_utf8(plain) {
                Ok(s) if !s.trim().is_empty() => Ok(Some(s)),
                Ok(_) => {
                    eprintln!(
                        "persistent-sage: warning: decrypted API key `{slot}` is empty; treating as unset."
                    );
                    Ok(None)
                }
                Err(e) => {
                    eprintln!(
                        "persistent-sage: warning: API key `{slot}` is not valid UTF-8 ({e}); treating as unset."
                    );
                    Ok(None)
                }
            },
            Err(e) => {
                eprintln!(
                    "persistent-sage: warning: could not decrypt API key `{slot}` ({e}). \
                     If you changed data directories or restored an old `settings.json`, re-save the key in Settings."
                );
                Ok(None)
            }
        }
    }

    /// Replace `settings.json` content with defaults (clears encrypted API keys and all prefs fields).
    pub fn reset_to_install_defaults(&self) -> Result<(), SettingsError> {
        eprintln!("persistent-sage: settings reset_to_install_defaults — restoring defaults");
        {
            let mut inner = self
                .inner
                .write()
                .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
            *inner = SettingsFile::default();
        }
        self.persist()?;
        self.sync_public_prefs()?;
        self.strip_secret_sqlite_prefs()?;
        Ok(())
    }

    pub fn apply_update(&self, patch: SettingsUpdatePayload) -> Result<(), SettingsError> {
        let mut inner = self
            .inner
            .write()
            .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
        if let Some(s) = patch.selected_provider {
            inner.selected_provider = s.trim().to_lowercase();
        }
        if let Some(s) = patch.openai_model {
            inner.openai_model = s;
        }
        if let Some(s) = patch.openai_base_url {
            inner.openai_base_url = s.trim_end_matches('/').to_string();
        }
        if let Some(s) = patch.ollama_model {
            inner.ollama_model = s;
        }
        if let Some(s) = patch.ollama_cloud_model {
            inner.ollama_cloud_model = s;
        }
        if let Some(s) = patch.ollama_base_url {
            inner.ollama_base_url = s.trim_end_matches('/').to_string();
        }
        if let Some(s) = patch.anthropic_model {
            inner.anthropic_model = s;
        }
        if let Some(s) = patch.gemini_model {
            inner.gemini_model = s;
        }
        if let Some(s) = patch.gemini_base_url {
            inner.gemini_base_url = s.trim_end_matches('/').to_string();
        }
        if let Some(s) = patch.xai_model {
            inner.xai_model = s;
        }
        if let Some(s) = patch.xai_base_url {
            inner.xai_base_url = s.trim_end_matches('/').to_string();
        }
        if let Some(s) = patch.thinking_effort {
            inner.thinking_effort = normalize_thinking_effort(&s);
        }
        if let Some(t) = patch.temperature {
            inner.temperature = t.clamp(0.0, 2.0);
        }
        if let Some(v) = patch.max_tokens {
            inner.max_tokens = match v {
                JsonValue::Null => None,
                JsonValue::Number(n) => {
                    let u = n.as_u64().ok_or_else(|| {
                        SettingsError::Crypto("max_tokens must be a non-negative integer".into())
                    })?;
                    let u32v = u32::try_from(u)
                        .map_err(|_| SettingsError::Crypto("max_tokens out of range".into()))?;
                    Some(u32v)
                }
                _ => {
                    return Err(SettingsError::Crypto(
                        "max_tokens must be null or a number".into(),
                    ));
                }
            };
        }
        if let Some(b) = patch.agent_web_tools_enabled {
            inner.agent_web_tools_enabled = b;
        }
        if let Some(b) = patch.agent_browser_fetch_enabled {
            inner.agent_browser_fetch_enabled = b;
        }
        if let Some(b) = patch.agent_browser_ignore_robots {
            inner.agent_browser_ignore_robots = b;
        }
        if let Some(b) = patch.agent_workspace_enabled {
            inner.agent_workspace_enabled = b;
        }
        if let Some(b) = patch.agent_coding_tools_enabled {
            inner.agent_coding_tools_enabled = b;
        }
        if let Some(b) = patch.agent_coding_shell_enabled {
            inner.agent_coding_shell_enabled = b;
        }
        if let Some(b) = patch.agent_coding_git_enabled {
            inner.agent_coding_git_enabled = b;
        }
        if let Some(b) = patch.agent_personality_edit_enabled {
            inner.agent_personality_edit_enabled = b;
        }
        if let Some(b) = patch.database_allow_write {
            inner.database_allow_write = b;
        }
        if let Some(b) = patch.database_app_data_enabled {
            inner.database_app_data_enabled = b;
        }
        if let Some(b) = patch.pulse_enabled {
            inner.pulse_enabled = b;
        }
        if let Some(m) = patch.pulse_interval_minutes {
            inner.pulse_interval_minutes = m.clamp(1, 24 * 60);
        }
        if let Some(s) = patch.pulse_instructions {
            inner.pulse_instructions = s;
        }
        if let Some(v) = patch.pulse_conversation_id {
            inner.pulse_conversation_id = match v {
                JsonValue::Null => None,
                JsonValue::String(s) => {
                    let t = s.trim();
                    if t.is_empty() {
                        None
                    } else {
                        Some(t.to_string())
                    }
                }
                _ => {
                    return Err(SettingsError::Crypto(
                        "pulse_conversation_id must be null or a string".into(),
                    ));
                }
            };
        }
        if let Some(b) = patch.memory_llm_extraction_enabled {
            inner.memory_llm_extraction_enabled = b;
        }
        if let Some(b) = patch.memory_semantic_enabled {
            inner.memory_semantic_enabled = b;
        }
        if let Some(s) = patch.embedding_model {
            inner.embedding_model = s.trim().to_string();
        }
        if let Some(b) = patch.onboarding_completed {
            inner.onboarding_completed = b;
        }
        if let Some(s) = patch.whats_new_seen_version {
            inner.whats_new_seen_version = s;
        }
        if let Some(b) = patch.artifacts_enabled {
            inner.artifacts_enabled = b;
        }
        inner.version = SETTINGS_VERSION;
        drop(inner);
        self.persist()
    }

    pub fn save_api_key(&self, provider: &str, api_key: &str) -> Result<(), SettingsError> {
        let slot = normalize_key_slot(provider)?;
        let key = api_key.trim();
        if key.is_empty() {
            let mut inner = self
                .inner
                .write()
                .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
            inner.encrypted_api_keys.remove(&slot);
            drop(inner);
            self.persist()?;
            self.strip_secret_sqlite_prefs()?;
            return Ok(());
        }
        let blob = encrypt_aes_gcm(&self.aes_key, key.as_bytes())?;
        let mut inner = self
            .inner
            .write()
            .map_err(|_| SettingsError::Crypto("lock poisoned".into()))?;
        inner.encrypted_api_keys.insert(slot, blob);
        drop(inner);
        self.persist()?;
        self.strip_secret_sqlite_prefs()?;
        Ok(())
    }

    /// Encrypts legacy plaintext keys from SQLite into `file` (first-run migration).
    fn migrate_plaintext_api_keys_from_sqlite(
        aes_key: &[u8; 32],
        memory: &std::sync::Arc<dyn ConversationMemory + Send + Sync>,
        file: &mut SettingsFile,
    ) -> Result<(), SettingsError> {
        if let Ok(Some(k)) = memory.preference_get("nova.openai.api_key") {
            let t = k.trim();
            if !t.is_empty() {
                file.encrypted_api_keys
                    .insert("openai".into(), encrypt_aes_gcm(aes_key, t.as_bytes())?);
            }
        }
        if let Ok(Some(k)) = memory.preference_get("nova.anthropic.api_key") {
            let t = k.trim();
            if !t.is_empty() {
                file.encrypted_api_keys
                    .insert("anthropic".into(), encrypt_aes_gcm(aes_key, t.as_bytes())?);
            }
        }
        if let Ok(Some(k)) = memory.preference_get("nova.ollama.api_key") {
            let t = k.trim();
            if !t.is_empty() {
                file.encrypted_api_keys
                    .insert("ollama".into(), encrypt_aes_gcm(aes_key, t.as_bytes())?);
            }
        }
        Ok(())
    }
}

fn normalize_key_slot(provider: &str) -> Result<String, SettingsError> {
    let s = provider.trim().to_lowercase();
    match s.as_str() {
        "openai" => Ok("openai".into()),
        "anthropic" => Ok("anthropic".into()),
        "ollama" | "ollama_cloud" => Ok("ollama".into()),
        "gemini" | "google" => Ok("gemini".into()),
        "xai" | "grok" => Ok("xai".into()),
        _ => Err(SettingsError::InvalidKeySlot(provider.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_key_slot;

    #[test]
    fn normalizes_api_key_slots_by_provider() {
        let cases = [
            ("openai", "openai"),
            (" OpenAI ", "openai"),
            ("anthropic", "anthropic"),
            ("ollama", "ollama"),
            ("ollama_cloud", "ollama"),
            ("gemini", "gemini"),
            ("google", "gemini"),
            ("xai", "xai"),
            ("grok", "xai"),
        ];

        for (provider, slot) in cases {
            assert_eq!(normalize_key_slot(provider).unwrap(), slot);
        }
    }
}

fn normalize_thinking_effort(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "low" => "low".into(),
        "high" => "high".into(),
        _ => "medium".into(),
    }
}

fn migrate_sqlite_into_file(
    memory: &std::sync::Arc<dyn ConversationMemory + Send + Sync>,
    file: &mut SettingsFile,
) -> Result<(), SettingsError> {
    if let Ok(Some(v)) = memory.preference_get("nova.provider.active") {
        if !v.trim().is_empty() {
            file.selected_provider = v.trim().to_lowercase();
        }
    }
    if let Ok(Some(v)) = memory.preference_get("nova.openai.model") {
        if !v.trim().is_empty() {
            file.openai_model = v;
        }
    }
    if let Ok(Some(v)) = memory.preference_get("nova.openai.base_url") {
        if !v.trim().is_empty() {
            file.openai_base_url = v.trim_end_matches('/').to_string();
        }
    }
    if let Ok(Some(v)) = memory.preference_get("nova.ollama.model") {
        if !v.trim().is_empty() {
            file.ollama_model = v;
        }
    }
    if let Ok(Some(v)) = memory.preference_get("persistent_sage.ollama_cloud.model") {
        if !v.trim().is_empty() {
            file.ollama_cloud_model = v;
        }
    }
    if let Ok(Some(v)) = memory.preference_get("nova.ollama.base_url") {
        if !v.trim().is_empty() {
            file.ollama_base_url = v.trim_end_matches('/').to_string();
        }
    }
    Ok(())
}
