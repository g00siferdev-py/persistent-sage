//! Persistent Sage — portable, privacy-first AI companion (Rust + Tauri).
//!
//! **Local-first**: conversation memory defaults to SQLite on disk; model
//! traffic goes only through pluggable [`provider::LLMProviderEngine`] backends
//! the user configures (no cloud storage in core). **Portable runs**: set
//! `PERSISTENT_SAGE_DATA_DIR` or `PERSISTENT_SAGE_PORTABLE=1` so data stays with the app (e.g. USB).
//!
//! Application entry for mobile builds is [`run`]. Desktop [`main`] in
//! `main.rs` delegates here so the same setup runs everywhere.

mod agent_stream;
mod agent_tools;
mod agent_email_watch;
mod app_instance;
mod artifacts;
mod attachments;
mod browser_fetch;
mod cache;
mod chat;
mod correspondence_sync;
mod git_auth;
mod coding;
mod coding_ide;
mod coding_notes;
mod coding_tools;
mod database_query;
mod distribution;
mod google;
mod paths;
mod pdf;
mod embedding;
mod memory;
mod memory_extract;
mod memory_tools;
mod moltbook;
mod moltbook_verify;
mod moltbook_scheduler;
mod personality;
mod personality_tools;
mod playground;
mod projects;
mod repos;
mod provider;
mod pulse;
mod recipes;
mod settings;
mod store_updates;
mod subagents;
mod token_counter;
mod tool_stream;
mod weather;
mod webview_media;
mod webcam;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use memory::{
    AnchorType, ConversationMemory, MemoryAnchor, MemoryRecallBundle, MessageRole, SqliteProfile,
    StoredAnchor, StoredConversation, StoredMessage, StoredProject, DEFAULT_PERSONALITY_ID,
};
use personality::{PersonalityFile, PersonalityManager, PersonalitySnapshot};
use provider::{
    build_engine, fetch_anthropic_model_ids, fetch_gemini_model_ids, fetch_ollama_cloud_model_tags,
    fetch_ollama_local_model_tags, fetch_openai_model_ids, fetch_openrouter_model_catalog,
    fetch_xai_model_ids, list_provider_descriptors, ChatTurn, CompletionRequest, LLMProviderEngine,
    ModelCatalogEntry, PlaceholderEngine, ProviderDescriptor, ProviderError,
};
use serde::Serialize;
use settings::{SettingsManager, SettingsUpdatePayload, SettingsView};
use token_counter::TokenContextInfo;
use webcam::WebcamService;
use tauri::{Manager, State};

// --- App state ----------------------------------------------------------------

pub struct NovaState {
    pub(crate) http: reqwest::Client,
    pub(crate) llm: tokio::sync::RwLock<Arc<dyn LLMProviderEngine + Send + Sync>>,
    pub(crate) memory: Arc<dyn ConversationMemory + Send + Sync>,
    pub(crate) settings: Arc<SettingsManager>,
    pub(crate) personality: Arc<PersonalityManager>,
    /// Canonical agent workspace (`{data_dir}/workspace`). Created at startup; tools only touch paths inside it.
    pub(crate) workspace_root: PathBuf,
    /// Canonical Persistent Sage data directory (same resolution as MemoryAnchor: `PERSISTENT_SAGE_DATA_DIR`, portable `data/`, or OS app data).
    pub(crate) data_directory: PathBuf,
    /// Serializes companion LLM turns. Background Pulse / agent-email watch use `try_lock` and skip when busy.
    pub(crate) companion_turn: tokio::sync::Mutex<()>,
}

impl NovaState {
    #[must_use]
    pub fn new(
        memory: Arc<dyn ConversationMemory + Send + Sync>,
        settings: Arc<SettingsManager>,
        personality: Arc<PersonalityManager>,
        workspace_root: PathBuf,
        data_directory: PathBuf,
    ) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(format!("PersistentSage/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("reqwest Client");

        let llm: Arc<dyn LLMProviderEngine + Send + Sync> = match build_engine(&http, &settings) {
            Ok(e) => e,
            Err(e) => {
                eprintln!("persistent-sage: provider init failed ({e}), using placeholder");
                Arc::new(PlaceholderEngine::new())
            }
        };

        Self {
            http,
            llm: tokio::sync::RwLock::new(llm),
            memory,
            settings,
            personality,
            workspace_root,
            data_directory,
            companion_turn: tokio::sync::Mutex::new(()),
        }
    }
}

fn parse_anchor_type(s: &str) -> Result<AnchorType, String> {
    match s.to_lowercase().as_str() {
        "raw" => Ok(AnchorType::Raw),
        "curated" => Ok(AnchorType::Curated),
        "fact" => Ok(AnchorType::Fact),
        "insight" => Ok(AnchorType::Insight),
        _ => Err(format!(
            "unknown anchor type '{s}' (use raw, curated, fact, insight)"
        )),
    }
}

// --- Tauri commands -----------------------------------------------------------

#[tauri::command]
fn app_version() -> String {
    format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
fn app_distribution_info() -> distribution::DistributionInfo {
    distribution::distribution_info()
}

#[tauri::command]
fn open_store_updates() -> Result<(), String> {
    distribution::open_microsoft_store_updates()
}

#[tauri::command]
fn check_store_updates(app: tauri::AppHandle) -> Result<store_updates::StoreUpdateCheckResult, String> {
    store_updates::check_store_updates(&app)
}

#[tauri::command]
fn install_store_updates(
    app: tauri::AppHandle,
) -> Result<store_updates::StoreUpdateInstallResult, String> {
    store_updates::install_store_updates(&app)
}

/// Where SQLite and `settings.json` live (per machine). Helps debug “works on my other computer”.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataPaths {
    pub data_directory: String,
    pub database_file: String,
    /// Agent read/write sandbox (`{dataDirectory}/workspace`).
    pub workspace_directory: String,
    /// `desktop` (WAL) vs `portable` (from Persistent Sage env overrides or legacy `NOVA_*`).
    pub sqlite_profile: String,
    pub nova_data_dir_env: bool,
    pub nova_portable_env: bool,
}

fn ensure_workspace_guide(workspace_root: &std::path::Path) {
    const GUIDE: &str = include_str!("../../docs/SAGE-GUIDE.md");
    let path = workspace_root.join("guide.md");
    if path.exists() {
        return;
    }
    if let Err(e) = std::fs::write(&path, GUIDE) {
        eprintln!(
            "persistent-sage: warning: could not write workspace guide {}: {e}",
            path.display()
        );
    }
}

#[tauri::command]
fn app_data_paths(state: State<NovaState>) -> Result<AppDataPaths, String> {
    let data_directory = state.data_directory.clone();
    let database_file = data_directory.join("nova_memory.sqlite");
    let sqlite_profile = match memory::sqlite_profile_from_env() {
        SqliteProfile::Desktop => "desktop",
        SqliteProfile::Portable => "portable",
    };
    let nova_data_dir_env = std::env::var("PERSISTENT_SAGE_DATA_DIR")
        .or_else(|_| std::env::var("NOVA_DATA_DIR"))
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let nova_portable_env = std::env::var("PERSISTENT_SAGE_PORTABLE")
        .or_else(|_| std::env::var("NOVA_PORTABLE"))
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let workspace_directory = state.workspace_root.clone();
    Ok(AppDataPaths {
        data_directory: paths::display_path(&data_directory),
        database_file: paths::display_path(&database_file),
        workspace_directory: paths::display_path(&workspace_directory),
        sqlite_profile: sqlite_profile.into(),
        nova_data_dir_env,
        nova_portable_env,
    })
}

/// Opens the resolved data directory in the system file manager (Finder, Explorer, Nautilus, …).
#[tauri::command]
fn reveal_data_directory(state: State<NovaState>) -> Result<(), String> {
    paths::reveal_in_file_manager(state.data_directory.as_path())
}

/// Open a workspace-relative or absolute file path in the system default app.
#[tauri::command]
fn open_path(path: String, state: State<'_, NovaState>) -> Result<(), String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("path is empty".into());
    }
    let p = std::path::Path::new(raw);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        let stripped = raw.strip_prefix("workspace/").unwrap_or(raw);
        state.workspace_root.join(stripped)
    };
    if !abs.exists() {
        return Err(format!("path not found: {}", abs.display()));
    }
    opener::open(&abs).map_err(|e| format!("open path: {e}"))
}

#[tauri::command]
fn browser_detect_chromium() -> Result<Option<String>, String> {
    Ok(crate::browser_fetch::find_chrome_executable()
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn recipe_list(state: State<'_, NovaState>) -> Result<Vec<recipes::Recipe>, String> {
    recipes::load_recipes(&state.data_directory)
}

#[tauri::command]
async fn recipe_run(
    app: tauri::AppHandle,
    state: State<'_, NovaState>,
    recipe_id: String,
    conversation_id: String,
) -> Result<recipes::RecipeRunResult, String> {
    Ok(recipes::run_recipe(&app, &state, &recipe_id, &conversation_id).await)
}

#[tauri::command]
fn project_list(state: State<'_, NovaState>) -> Result<projects::ProjectListView, String> {
    projects::list_projects_view(&state.workspace_root)
}

/// Create a project directly from the Productivity-mode Projects widget (no chat turn).
#[tauri::command]
fn project_create_direct(
    title: String,
    kind: Option<String>,
    state: State<'_, NovaState>,
) -> Result<projects::ProjectMeta, String> {
    let t = title.trim();
    if t.is_empty() {
        return Err("project title is required".into());
    }
    let id: String = t
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    projects::create_project(
        &state.workspace_root,
        &id,
        t,
        kind.as_deref().unwrap_or("document"),
        None,
        None,
    )
}

#[tauri::command]
fn project_read_doc(id: String, state: State<'_, NovaState>) -> Result<String, String> {
    projects::read_document(&state.workspace_root, &id)
}

#[tauri::command]
fn coding_repo_list(state: State<'_, NovaState>) -> Result<repos::RepoListView, String> {
    repos::list_repos_view(&state.workspace_root)
}

#[tauri::command]
fn coding_repo_set_active(
    repo_id: Option<String>,
    state: State<'_, NovaState>,
) -> Result<repos::RepoListView, String> {
    repos::set_active_repo(&state.workspace_root, repo_id.as_deref())
}

#[tauri::command]
fn coding_repo_tree(
    repo_id: String,
    state: State<'_, NovaState>,
) -> Result<Vec<repos::RepoTreeNode>, String> {
    let meta = repos::get_repo_meta(&state.workspace_root, repo_id.trim())?;
    repos::repo_file_tree(&state.workspace_root, &meta.path_rel)
}

#[tauri::command]
async fn coding_repo_clone(
    url: String,
    name: Option<String>,
    state: State<'_, NovaState>,
) -> Result<repos::RepoListView, String> {
    repos::clone_repository(
        &state.workspace_root,
        state.data_directory.as_path(),
        &state.settings,
        url.trim(),
        name.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    )
    .await?;
    repos::list_repos_view(&state.workspace_root)
}

#[tauri::command]
fn coding_repo_create(
    name: String,
    template: Option<String>,
    state: State<'_, NovaState>,
) -> Result<repos::RepoListView, String> {
    repos::create_repository(
        &state.workspace_root,
        name.trim(),
        template.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    )?;
    repos::list_repos_view(&state.workspace_root)
}

#[tauri::command]
fn coding_read_file(
    repo_id: String,
    path_rel: String,
    state: State<'_, NovaState>,
) -> Result<coding_ide::CodingFileView, String> {
    coding_ide::read_file(&state.workspace_root, repo_id.trim(), path_rel.trim())
}

#[tauri::command]
fn coding_write_file(
    repo_id: String,
    path_rel: String,
    content: String,
    state: State<'_, NovaState>,
) -> Result<(), String> {
    coding_ide::write_file(
        &state.workspace_root,
        repo_id.trim(),
        path_rel.trim(),
        &content,
    )
}

#[tauri::command]
async fn coding_run_shell(
    repo_id: String,
    command: String,
    cwd: Option<String>,
    state: State<'_, NovaState>,
) -> Result<coding_ide::CodingShellResult, String> {
    coding_ide::run_shell(
        &state.workspace_root,
        &state.settings,
        repo_id.trim(),
        command.trim(),
        cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    )
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FormSubmissionMessage {
    message: String,
}

#[tauri::command]
fn project_format_form_submission(
    artifact_title: String,
    project_id: Option<String>,
    values: serde_json::Value,
) -> Result<FormSubmissionMessage, String> {
    Ok(FormSubmissionMessage {
        message: projects::format_form_submission_message(
            &artifact_title,
            project_id.as_deref(),
            &values,
        ),
    })
}

#[tauri::command]
fn open_feedback_issue(issue_url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&issue_url).map_err(|e| format!("invalid feedback URL: {e}"))?;
    let is_allowed = parsed.scheme() == "https"
        && parsed.host_str() == Some("github.com")
        && parsed.path() == "/g00siferdev-py/persistent-sage/issues/new";
    if !is_allowed {
        return Err(
            "feedback URL must point to the official Persistent Sage GitHub issue form".into(),
        );
    }
    opener::open(issue_url).map_err(|e| format!("open feedback form: {e}"))
}

fn external_url_host_allowed(host: &str) -> bool {
    host == "github.com"
        || host.ends_with(".github.com")
        || host == "paypal.com"
        || host.ends_with(".paypal.com")
        || host == "cash.app"
        || host.ends_with(".cash.app")
}

/// Hosts allowed for the message "Share" menu (social share intents only).
fn share_url_host_allowed(host: &str) -> bool {
    matches!(
        host,
        "twitter.com"
            | "x.com"
            | "www.facebook.com"
            | "facebook.com"
            | "www.reddit.com"
            | "reddit.com"
            | "www.linkedin.com"
            | "linkedin.com"
            | "t.me"
            | "wa.me"
            | "bsky.app"
            | "moltbook.com"
            | "www.moltbook.com"
    )
}

/// Open an https social-share URL in the system default browser.
#[tauri::command]
fn open_share_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(url.trim()).map_err(|e| format!("invalid URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("only https URLs can be opened externally".into());
    }
    let host = parsed.host_str().ok_or_else(|| "URL has no host".to_string())?;
    if !share_url_host_allowed(host) {
        return Err(format!("share URL host not allowed: {host}"));
    }
    opener::open(parsed.as_str()).map_err(|e| format!("open URL: {e}"))
}

/// Open an https URL in the system default browser (donation links, docs, etc.).
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(url.trim()).map_err(|e| format!("invalid URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("only https URLs can be opened externally".into());
    }
    let host = parsed.host_str().ok_or_else(|| "URL has no host".to_string())?;
    if !external_url_host_allowed(host) {
        return Err(format!("external URL host not allowed: {host}"));
    }
    opener::open(parsed.as_str()).map_err(|e| format!("open URL: {e}"))
}

#[tauri::command]
async fn provider_info(state: State<'_, NovaState>) -> Result<String, String> {
    let engine = state.llm.read().await.clone();
    let m = engine.model_info();
    let ctx = m
        .context_window_tokens
        .map(|n| n.to_string())
        .unwrap_or_else(|| "unknown".into());
    Ok(format!(
        "{} — model `{}`, context ~{} tokens",
        m.provider_id, m.model_id, ctx
    ))
}

#[tauri::command]
fn provider_list_available() -> Vec<ProviderDescriptor> {
    list_provider_descriptors()
}

/// Bridge for providers whose fetchers still return bare ids (no capability data yet).
fn ids_as_catalog(
    provider_id: &str,
    ids: Vec<String>,
    supports_tools: bool,
) -> Vec<ModelCatalogEntry> {
    ids.into_iter()
        .map(|id| ModelCatalogEntry {
            supports_tools,
            supports_vision: attachments::model_supports_vision(provider_id, &id),
            context_length: None,
            is_free: false,
            label: id.clone(),
            id,
        })
        .collect()
}

#[tauri::command]
async fn ollama_cloud_list_models(
    state: State<'_, NovaState>,
) -> Result<Vec<ModelCatalogEntry>, String> {
    fetch_ollama_cloud_model_tags(&state.http, &state.settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn openai_list_models(state: State<'_, NovaState>) -> Result<Vec<ModelCatalogEntry>, String> {
    fetch_openai_model_ids(&state.http, &state.settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_list_local_models(
    state: State<'_, NovaState>,
) -> Result<Vec<ModelCatalogEntry>, String> {
    fetch_ollama_local_model_tags(&state.http, &state.settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn anthropic_list_models(
    state: State<'_, NovaState>,
) -> Result<Vec<ModelCatalogEntry>, String> {
    fetch_anthropic_model_ids(&state.http, &state.settings)
        .await
        .map(|ids| ids_as_catalog("anthropic", ids, true))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn gemini_list_models(state: State<'_, NovaState>) -> Result<Vec<ModelCatalogEntry>, String> {
    fetch_gemini_model_ids(&state.http, &state.settings)
        .await
        .map(|ids| ids_as_catalog("gemini", ids, false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn xai_list_models(state: State<'_, NovaState>) -> Result<Vec<ModelCatalogEntry>, String> {
    fetch_xai_model_ids(&state.http, &state.settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn openrouter_list_models(
    state: State<'_, NovaState>,
) -> Result<Vec<ModelCatalogEntry>, String> {
    fetch_openrouter_model_catalog(&state.http, &state.settings)
        .await
        .map_err(|e| e.to_string())
}

/// Outcome of a one-shot round trip against the selected provider + model.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProbeResult {
    ok: bool,
    provider_id: String,
    model_id: String,
    /// Reply preview when `ok`, otherwise the provider error (status codes included).
    detail: String,
}

/// Send a throwaway prompt so a retired or incompatible model fails here, not mid-chat.
#[tauri::command]
async fn provider_test_active_model(
    state: State<'_, NovaState>,
) -> Result<ModelProbeResult, String> {
    let engine = build_engine(&state.http, &state.settings).map_err(|e| e.to_string())?;
    let info = engine.model_info();
    let request = CompletionRequest {
        messages: vec![ChatTurn::text("user", "Reply with the single word: ok")],
        max_tokens: Some(16),
        temperature: Some(0.0),
        ..Default::default()
    };
    let (ok, detail) = match engine.complete(&request).await {
        Ok(res) => {
            let preview: String = res.content.trim().chars().take(120).collect();
            let preview = if preview.is_empty() {
                "empty reply".to_string()
            } else {
                preview
            };
            (true, preview)
        }
        Err(e) => (false, e.to_string()),
    };
    Ok(ModelProbeResult {
        ok,
        provider_id: info.provider_id,
        model_id: info.model_id,
        detail,
    })
}

#[tauri::command]
async fn provider_switch(state: State<'_, NovaState>, provider_id: String) -> Result<(), String> {
    let id = provider_id.trim().to_lowercase();
    state
        .settings
        .apply_update(SettingsUpdatePayload {
            selected_provider: Some(id),
            ..Default::default()
        })
        .map_err(|e| e.to_string())?;

    let engine =
        build_engine(&state.http, &state.settings).map_err(|e: ProviderError| e.to_string())?;
    *state.llm.write().await = engine;
    Ok(())
}

#[tauri::command]
fn settings_get(state: State<NovaState>) -> Result<SettingsView, String> {
    state.settings.view().map_err(|e| e.to_string())
}

#[tauri::command]
async fn settings_update(
    state: State<'_, NovaState>,
    patch: SettingsUpdatePayload,
) -> Result<SettingsView, String> {
    state
        .settings
        .apply_update(patch)
        .map_err(|e| e.to_string())?;
    match build_engine(&state.http, &state.settings) {
        Ok(engine) => *state.llm.write().await = engine,
        Err(e) => {
            eprintln!(
                "persistent-sage: rebuild LLM after settings failed ({e}), keeping placeholder"
            );
            *state.llm.write().await = Arc::new(PlaceholderEngine::new());
        }
    }
    state.settings.view().map_err(|e| e.to_string())
}

#[tauri::command]
fn personality_get(state: State<NovaState>) -> Result<PersonalitySnapshot, String> {
    state.personality.snapshot().map_err(|e| e.to_string())
}

#[tauri::command]
fn personality_save(
    state: State<NovaState>,
    file: PersonalityFile,
) -> Result<PersonalitySnapshot, String> {
    state
        .personality
        .replace_all(file)
        .map_err(|e| e.to_string())?;
    state.personality.snapshot().map_err(|e| e.to_string())
}

#[tauri::command]
async fn settings_save_api_key(
    state: State<'_, NovaState>,
    provider: String,
    api_key: String,
) -> Result<(), String> {
    state
        .settings
        .save_api_key(&provider, &api_key)
        .map_err(|e| e.to_string())?;
    match build_engine(&state.http, &state.settings) {
        Ok(engine) => *state.llm.write().await = engine,
        Err(e) => {
            eprintln!("persistent-sage: rebuild LLM after API key save failed ({e})");
        }
    }
    Ok(())
}

/// Clears only the SQLite memory store (conversations, messages, anchors, projects, preferences).
/// Does not modify `settings.json`, API keys, or `personality.json`.
#[tauri::command]
async fn database_wipe_memories(state: State<'_, NovaState>) -> Result<(), String> {
    eprintln!("persistent-sage: ipc database_wipe_memories — SQLite user tables only");
    state
        .memory
        .wipe_all_user_data()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Permanently clears SQLite memory data and resets `settings.json` / `personality.json` to defaults.
#[tauri::command]
async fn database_wipe_all(state: State<'_, NovaState>) -> Result<(), String> {
    eprintln!("persistent-sage: ipc database_wipe_all — SQLite + settings + personality");
    state
        .memory
        .wipe_all_user_data()
        .map_err(|e| e.to_string())?;
    state
        .settings
        .reset_to_install_defaults()
        .map_err(|e| e.to_string())?;
    state
        .personality
        .replace_all(PersonalityFile::default())
        .map_err(|e| e.to_string())?;
    ConversationMemory::set_active_personality(&*state.memory, DEFAULT_PERSONALITY_ID);
    match build_engine(&state.http, &state.settings) {
        Ok(engine) => *state.llm.write().await = engine,
        Err(e) => {
            eprintln!(
                "persistent-sage: database_wipe_all rebuild LLM failed ({e}), using placeholder"
            );
            *state.llm.write().await = Arc::new(PlaceholderEngine::new());
        }
    }
    Ok(())
}

#[tauri::command]
fn memory_set_active_personality(
    state: State<NovaState>,
    personality_id: String,
) -> Result<(), String> {
    let mut tid = personality_id.trim().to_string();
    if tid.is_empty() {
        tid = DEFAULT_PERSONALITY_ID.to_string();
    }
    eprintln!("persistent-sage: ipc memory_set_active_personality personality_id={tid} (sync persona + memory)");
    if tid == crate::coding::CODING_PERSONALITY_ID {
        state.memory.set_active_personality(&tid);
        return Ok(());
    }
    state
        .personality
        .set_active_profile_id(&tid)
        .map_err(|e| e.to_string())?;
    state.memory.set_active_personality(&tid);
    Ok(())
}

fn sync_coding_session_personality(state: &NovaState) -> Result<String, String> {
    let linked = state.settings.agent_coding_companion_linked_enabled();
    let pid = if linked {
        state.personality.active_profile_id()
    } else {
        crate::coding::CODING_PERSONALITY_ID.to_string()
    };
    if linked {
        state
            .personality
            .set_active_profile_id(&pid)
            .map_err(|e| e.to_string())?;
    }
    state.memory.set_active_personality(&pid);
    Ok(pid)
}

#[tauri::command]
fn memory_list_conversations(state: State<NovaState>) -> Result<Vec<StoredConversation>, String> {
    state.memory.list_conversations().map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_create_conversation(state: State<NovaState>, title: String) -> Result<String, String> {
    state
        .memory
        .create_conversation(&title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_list_coding_conversations(
    repo_id: String,
    state: State<NovaState>,
) -> Result<Vec<StoredConversation>, String> {
    state
        .memory
        .list_coding_conversations(repo_id.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_create_coding_conversation(
    repo_id: String,
    title: String,
    state: State<NovaState>,
) -> Result<String, String> {
    sync_coding_session_personality(&state)?;
    state
        .memory
        .create_coding_conversation(repo_id.trim(), title.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_get_or_create_coding_conversation(
    repo_id: String,
    repo_name: String,
    state: State<NovaState>,
) -> Result<String, String> {
    sync_coding_session_personality(&state)?;
    state
        .memory
        .get_or_create_coding_conversation(repo_id.trim(), repo_name.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_set_conversation_coding_meta(
    conversation_id: String,
    repo_id: Option<String>,
    state: State<NovaState>,
) -> Result<(), String> {
    let rid = repo_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    state
        .memory
        .set_conversation_coding_meta(conversation_id.trim(), rid)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_get_conversation(
    state: State<NovaState>,
    conversation_id: String,
) -> Result<StoredConversation, String> {
    state
        .memory
        .get_conversation(&conversation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_rename_conversation(
    state: State<NovaState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    state
        .memory
        .rename_conversation(&conversation_id, &title)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_conversation(state: State<NovaState>, conversation_id: String) -> Result<(), String> {
    state
        .memory
        .delete_conversation(conversation_id.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_store_message(
    state: State<NovaState>,
    conversation_id: String,
    role: MessageRole,
    content: String,
) -> Result<(), String> {
    state
        .memory
        .store_message(&conversation_id, role, &content, None, None, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_get_recent(
    state: State<NovaState>,
    conversation_id: String,
    limit: usize,
) -> Result<Vec<StoredMessage>, String> {
    let mut recent = state
        .memory
        .get_recent(&conversation_id, limit)
        .map_err(|e| e.to_string())?;
    if state.settings.artifacts_enabled() {
        artifacts::repair_assistant_messages(&mut recent);
    }
    Ok(recent)
}

/// Star or unstar a message (favorites).
#[tauri::command]
fn memory_set_message_favorite(
    state: State<NovaState>,
    message_id: i64,
    favorite: bool,
) -> Result<(), String> {
    state
        .memory
        .set_message_favorite(message_id, favorite)
        .map_err(|e| e.to_string())
}

/// Starred messages for the active companion, newest first (with conversation titles).
#[tauri::command]
fn memory_list_favorites(
    state: State<NovaState>,
    limit: usize,
) -> Result<Vec<StoredMessage>, String> {
    let mut favorites = state
        .memory
        .list_favorite_messages(limit.max(1).min(500))
        .map_err(|e| e.to_string())?;
    if state.settings.artifacts_enabled() {
        artifacts::repair_assistant_messages(&mut favorites);
    }
    Ok(favorites)
}

#[tauri::command]
fn memory_get_token_context(
    state: State<NovaState>,
    conversation_id: String,
) -> Result<TokenContextInfo, String> {
    let messages = state
        .memory
        .get_recent(&conversation_id, 10_000)
        .map_err(|e| e.to_string())?;

    let settings = state.settings.view().map_err(|e| e.to_string())?;
    let provider = settings.selected_provider.as_str();
    let model = match provider {
        "openai" => &settings.openai_model,
        "anthropic" => &settings.anthropic_model,
        "ollama" => &settings.ollama_model,
        "ollama_cloud" => &settings.ollama_cloud_model,
        "gemini" => &settings.gemini_model,
        "xai" => &settings.xai_model,
        "openrouter" => &settings.openrouter_model,
        _ => "gpt-4o",
    };

    let message_pairs: Vec<(String, String)> = messages
        .iter()
        .map(|m| ("".to_string(), m.content.clone()))
        .collect();

    Ok(TokenContextInfo::from_messages(
        &message_pairs,
        provider,
        model,
    ))
}

/// Rich briefing: transcript + Memory Anchors + projects + preferences.
#[tauri::command]
fn memory_startup_briefing(
    state: State<NovaState>,
    conversation_id: String,
) -> Result<String, String> {
    let label = state.personality.companion_display_name();
    state
        .memory
        .get_startup_briefing(&conversation_id, &label)
        .map_err(|e| e.to_string())
}

/// Same payload as [`memory_startup_briefing`]; use after bulk anchor edits.
#[tauri::command]
fn memory_update_startup_briefing(
    state: State<NovaState>,
    conversation_id: String,
) -> Result<String, String> {
    let label = state.personality.companion_display_name();
    state
        .memory
        .update_startup_briefing(&conversation_id, &label)
        .map_err(|e| e.to_string())
}

/// Insert one anchor (`conversation_id` null = global).
#[tauri::command]
fn memory_create_anchor(
    state: State<NovaState>,
    conversation_id: Option<String>,
    anchor_type: String,
    content: String,
    importance: i32,
) -> Result<String, String> {
    let ty = parse_anchor_type(&anchor_type)?;
    state
        .memory
        .create_anchor(conversation_id.as_deref(), ty, &content, importance)
        .map_err(|e| e.to_string())
}

/// Heuristic **raw** anchor extraction from recent user messages.
#[tauri::command]
fn memory_extract_anchors_from_conversation(
    state: State<NovaState>,
    conversation_id: String,
    max_anchors: usize,
) -> Result<Vec<String>, String> {
    state
        .memory
        .create_anchor_from_conversation(&conversation_id, max_anchors.max(1).min(32))
        .map_err(|e| e.to_string())
}

/// Keyword recall (semantic search when `embedding` is populated — future).
#[tauri::command]
fn memory_recall_anchors(
    state: State<NovaState>,
    query: String,
    conversation_id: Option<String>,
    limit: usize,
) -> Result<Vec<StoredAnchor>, String> {
    state
        .memory
        .recall_anchors(&query, conversation_id.as_deref(), limit.max(1).min(100))
        .map_err(|e| e.to_string())
}

/// Hybrid FTS + keyword anchor recall (fast; semantic ranking is via `memory_search` tool in chat).
#[tauri::command]
fn memory_recall(
    state: State<NovaState>,
    query: String,
    conversation_id: Option<String>,
    anchor_limit: Option<usize>,
    message_limit: Option<usize>,
) -> Result<MemoryRecallBundle, String> {
    let scope = conversation_id.as_deref().filter(|s| !s.trim().is_empty());
    state
        .memory
        .memory_recall(
            &query,
            scope,
            anchor_limit.unwrap_or(12).max(1).min(64),
            message_limit.unwrap_or(6).max(0).min(24),
            None,
        )
        .map_err(|e| e.to_string())
}

/// Clear anchor embeddings and re-embed all anchors for the active companion profile.
#[tauri::command]
async fn memory_reindex_embeddings(state: State<'_, NovaState>) -> Result<u32, String> {
    memory_extract::reindex_all_embeddings(&state.http, &state.settings, state.memory.as_ref())
        .await
}

/// Anchors for this thread plus global (`conversation_id` NULL).
#[tauri::command]
fn memory_list_anchors(
    state: State<NovaState>,
    conversation_id: String,
    limit: usize,
) -> Result<Vec<StoredAnchor>, String> {
    state
        .memory
        .list_anchors_for_thread(&conversation_id, limit.max(1).min(200))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_list_projects(
    state: State<NovaState>,
    limit: usize,
) -> Result<Vec<StoredProject>, String> {
    state
        .memory
        .list_projects(limit.max(1).min(100))
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFilePayload {
    file_name: String,
    text: String,
}

/// Read UTF-8 text from absolute paths (OpenClaw markdown import via native file dialog).
#[tauri::command]
fn read_text_files(paths: Vec<String>) -> Result<Vec<TextFilePayload>, String> {
    let mut out = Vec::new();
    for path in paths {
        let p = path.trim();
        if p.is_empty() {
            continue;
        }
        let pb = std::path::Path::new(p);
        let file_name = pb
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file.md")
            .to_string();
        let text =
            std::fs::read_to_string(pb).map_err(|e| format!("Could not read {file_name}: {e}"))?;
        out.push(TextFilePayload { file_name, text });
    }
    if out.is_empty() {
        return Err("No files were read.".into());
    }
    Ok(out)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceImageAttachPayload {
    /// Data URL (`data:image/…;base64,…`) for the composer.
    base64: String,
    mime: String,
}

/// Read a workspace image (absolute path from the native dialog) for composer attach.
#[tauri::command]
fn workspace_read_image_for_attach(
    absolute_path: String,
    state: State<'_, NovaState>,
) -> Result<WorkspaceImageAttachPayload, String> {
    let (base64, mime) = attachments::read_workspace_image_for_attach(
        state.workspace_root.as_path(),
        &absolute_path,
    )?;
    Ok(WorkspaceImageAttachPayload { base64, mime })
}

// --- Lifecycle ----------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Ok(dir) = memory::default_data_dir() {
        eprintln!("persistent-sage: data directory {}", dir.display());
    }
    if let Ok(db) = memory::default_db_path() {
        eprintln!("persistent-sage: sqlite database {}", db.display());
    }
    eprintln!(
        "persistent-sage: sqlite profile {:?} (custom data dir set: {}, portable set: {})",
        memory::sqlite_profile_from_env(),
        std::env::var("PERSISTENT_SAGE_DATA_DIR")
            .or_else(|_| std::env::var("NOVA_DATA_DIR"))
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
        std::env::var("PERSISTENT_SAGE_PORTABLE")
            .or_else(|_| std::env::var("NOVA_PORTABLE"))
            .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
    );

    let memory: Arc<dyn ConversationMemory + Send + Sync> = Arc::new(
        MemoryAnchor::open_default().expect("failed to open Persistent Sage memory database"),
    );

    let data_dir =
        paths::resolve_data_directory().expect("failed to resolve Persistent Sage data directory");
    let settings = Arc::new(
        SettingsManager::load(data_dir.clone(), memory.clone()).expect("failed to load settings"),
    );
    let personality =
        Arc::new(PersonalityManager::load(&data_dir).expect("failed to load personality store"));

    let data_directory = data_dir;
    eprintln!(
        "persistent-sage: resolved data directory {}",
        data_directory.display()
    );

    browser_fetch::ensure_browser_directories(&data_directory);

    let mut workspace_root = data_directory.join("workspace");
    if let Err(e) = std::fs::create_dir_all(&workspace_root) {
        eprintln!(
            "persistent-sage: warning: could not create agent workspace directory {}: {e}",
            workspace_root.display()
        );
    }
    workspace_root = paths::user_facing_path(std::fs::canonicalize(&workspace_root).unwrap_or(workspace_root));
    ensure_workspace_guide(&workspace_root);
    if let Err(e) = correspondence_sync::ensure_files(&workspace_root) {
        eprintln!("persistent-sage: warning: correspondence sync bootstrap: {e}");
    }
    projects::ensure_projects_tree(&workspace_root);
    repos::ensure_repos_tree(&workspace_root);
    eprintln!(
        "persistent-sage: agent workspace directory {}",
        workspace_root.display()
    );

    let distribution = distribution::distribution_info();
    eprintln!(
        "persistent-sage: update channel {:?} (via Microsoft Store: {})",
        distribution.channel, distribution.updates_via_microsoft_store
    );

    if let Err(e) = app_instance::acquire_data_dir_lock(&data_directory) {
        eprintln!("persistent-sage: {e}");
        std::process::exit(1);
    }

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(WebcamService::default())
        .manage(NovaState::new(
            memory,
            settings,
            personality,
            workspace_root,
            data_directory,
        ))
        .setup(|app| {
            let handle = app.handle().clone();
            webview_media::allow_webview_camera_permissions(&handle);
            tauri::async_runtime::spawn(async move {
                // Branded splash (~3.5s), then show main window.
                tokio::time::sleep(Duration::from_millis(3_500)).await;
                if let Some(splash) = handle.get_webview_window("splashscreen") {
                    let _ = splash.close();
                }
                if let Some(main) = handle.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                webview_media::allow_webview_camera_permissions(&handle);
            });
            pulse::spawn_pulse_loop(app.handle().clone());
            agent_email_watch::spawn_agent_email_watch_loop(app.handle().clone());
            moltbook_scheduler::spawn_moltbook_scheduler_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text_files,
            workspace_read_image_for_attach,
            app_version,
            app_distribution_info,
            open_store_updates,
            check_store_updates,
            install_store_updates,
            app_data_paths,
            reveal_data_directory,
            open_feedback_issue,
            open_external_url,
            open_share_url,
            moltbook::moltbook_status,
            moltbook::moltbook_register_agent,
            moltbook::moltbook_me,
            moltbook::moltbook_agent_status,
            moltbook::moltbook_feed,
            moltbook::moltbook_search,
            moltbook::moltbook_home,
            moltbook::moltbook_list_submolts,
            moltbook::moltbook_post_comments,
            moltbook::moltbook_upvote_post,
            moltbook_scheduler::moltbook_scheduler_run_interact,
            moltbook_scheduler::moltbook_scheduler_run_post,
            moltbook_scheduler::moltbook_scheduler_ask_share,
            google::google_status,
            google::google_auth_start,
            google::google_disconnect,
            google::google_gmail_list,
            google::google_gmail_get,
            google::google_gmail_send,
            google::google_calendar_events,
            google::google_calendar_create_event,
            google::google_calendar_delete_event,
            google::google_drive_list,
            google::google_contacts_list,
            google::google_tasks_list,
            google::google_tasks_add,
            google::google_tasks_set_completed,
            weather::weather_geocode,
            weather::weather_forecast,
            agent_email_watch::agent_email_watch_run_now,
            provider_info,
            provider_list_available,
            ollama_cloud_list_models,
            openai_list_models,
            ollama_list_local_models,
            anthropic_list_models,
            gemini_list_models,
            xai_list_models,
            openrouter_list_models,
            provider_test_active_model,
            provider_switch,
            settings_get,
            settings_update,
            settings_save_api_key,
            database_wipe_memories,
            database_wipe_all,
            personality_get,
            personality_save,
            chat::chat_send_message,
            chat::chat_vision_supported,
            memory_set_active_personality,
            memory_list_conversations,
            memory_get_conversation,
            memory_create_conversation,
            memory_rename_conversation,
            delete_conversation,
            memory_store_message,
            memory_get_recent,
            memory_set_message_favorite,
            memory_list_favorites,
            memory_get_token_context,
            memory_startup_briefing,
            memory_update_startup_briefing,
            memory_create_anchor,
            memory_extract_anchors_from_conversation,
            memory_recall_anchors,
            memory_recall,
            memory_reindex_embeddings,
            memory_list_anchors,
            memory_list_projects,
            pulse::pulse_run_now,
            open_path,
            browser_detect_chromium,
            recipe_list,
            recipe_run,
            project_list,
            project_create_direct,
            project_read_doc,
            project_format_form_submission,
            coding_repo_list,
            coding_repo_set_active,
            coding_repo_tree,
            coding_repo_clone,
            coding_repo_create,
            coding_read_file,
            coding_write_file,
            coding_run_shell,
            coding_notes::coding_notes_list,
            coding_notes::coding_notes_read,
            coding_notes::coding_notes_write,
            coding_notes::coding_notes_create,
            coding_notes::coding_notes_delete,
            playground::coding_playground_run,
            memory_list_coding_conversations,
            memory_create_coding_conversation,
            memory_get_or_create_coding_conversation,
            memory_set_conversation_coding_meta,
            cache::cache_info,
            cache::clear_cache,
            cache::reveal_cache_directory,
            agent_stream::agent_stream_replay_recent,
            agent_stream::agent_stream_emit_synthetic,
            agent_stream::agent_stream_snapshot,
            webcam::webcam_start,
            webcam::webcam_preview,
            webcam::webcam_capture,
            webcam::webcam_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Persistent Sage (Tauri application)");
}
