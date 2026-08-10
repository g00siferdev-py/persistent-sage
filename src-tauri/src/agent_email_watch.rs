//! Global Email Agent: polls the agent mailbox and wakes one dedicated thread.
//!
//! Continuity lives in `workspace/correspondence_sync.md`, maintained by all agents
//! via the `correspondence_sync` tool. On each inbox wake the Email Agent dirty-checks
//! timestamps and only re-reads the full sync file when it changed (or on a cold start).

use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::chat;
use crate::correspondence_sync;
use crate::google::{self, GoogleAccount};
use crate::memory::ConversationMemory;
use crate::NovaState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEmailWatchEvent {
    pub ok: bool,
    pub at: String,
    pub new_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn spawn_agent_email_watch_loop(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if let Some(state) = app_handle.try_state::<NovaState>() {
                if let Err(e) = run_watch_tick(&app_handle, &state, false).await {
                    eprintln!("persistent-sage: agent email watch: {e}");
                }
            }
        }
    });
}

/// One global Email Agent conversation — get-or-create, like Moltbook's scheduler thread.
fn ensure_email_agent_conversation(state: &NovaState) -> Result<String, String> {
    if let Some(existing) = state.settings.google_email_agent_conversation_id() {
        let live = state
            .memory
            .list_conversations()
            .map(|list| list.iter().any(|c| c.id == existing))
            .unwrap_or(false);
        if live {
            return Ok(existing);
        }
    }
    let id = state
        .memory
        .create_conversation("Email Agent")
        .map_err(|e| format!("could not create Email Agent thread: {e}"))?;
    state
        .settings
        .set_google_email_agent_conversation_id(Some(id.clone()))
        .map_err(|e| e.to_string())?;
    Ok(id)
}

fn email_agent_needs_full_sync(state: &NovaState, conversation_id: &str) -> bool {
    // Cold start: no prior assistant turns → force full sync into the prompt.
    match state.memory.get_recent(conversation_id, 4) {
        Ok(msgs) => {
            !msgs
                .iter()
                .any(|m| matches!(m.role, crate::memory::MessageRole::Assistant))
        }
        Err(_) => true,
    }
}

async fn run_watch_tick(app: &AppHandle, state: &NovaState, force: bool) -> Result<(), String> {
    let view = state.settings.view().map_err(|e| e.to_string())?;
    if !force && !view.google_agent_email_watch_enabled {
        return Ok(());
    }
    if !view.google_enabled || !view.google_sage_connected {
        return Ok(());
    }
    if view
        .selected_provider
        .trim()
        .eq_ignore_ascii_case("placeholder")
    {
        return Ok(());
    }
    if !view.google_agent_tools_enabled {
        return Ok(());
    }

    // Never interrupt an in-progress companion turn — defer until the next quiet poll.
    if !force && state.companion_turn.try_lock().is_err() {
        return Ok(());
    }

    static LAST_QUERY: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
    {
        let interval = Duration::from_secs(
            (view.google_agent_email_watch_interval_minutes.max(1) as u64).saturating_mul(60),
        );
        let guard = LAST_QUERY.lock().map_err(|e| e.to_string())?;
        if !force {
            if let Some(prev) = *guard {
                if prev.elapsed() < interval {
                    return Ok(());
                }
            }
        }
    }

    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let list = google::gmail_list(
        &state.http,
        &state.settings,
        GoogleAccount::Sage,
        "is:unread in:inbox",
        10,
    )
    .await
    .map_err(|e| e.to_string())?;

    let messages = list
        .get("messages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let seen = state.settings.google_agent_email_seen_ids();
    let mut fresh = Vec::new();
    for m in &messages {
        let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() || seen.iter().any(|s| s == id) {
            continue;
        }
        fresh.push(m.clone());
    }
    if fresh.is_empty() {
        let mut guard = LAST_QUERY.lock().map_err(|e| e.to_string())?;
        *guard = Some(std::time::Instant::now());
        return Ok(());
    }

    let cid = match ensure_email_agent_conversation(state) {
        Ok(id) => id,
        Err(e) => {
            let _ = app.emit(
                "agent-email:watch",
                AgentEmailWatchEvent {
                    ok: false,
                    at,
                    new_count: fresh.len() as u32,
                    conversation_id: None,
                    summary: None,
                    error: Some(e),
                },
            );
            return Ok(());
        }
    };

    let force_full_sync = email_agent_needs_full_sync(state, &cid);
    let sync = correspondence_sync::load_for_email_agent_wake(
        &state.workspace_root,
        force_full_sync,
    )
    .unwrap_or_else(|e| correspondence_sync::SyncWakeContext {
        included_full_sync: false,
        prompt_block: format!("(Could not dirty-check correspondence sync: {e})"),
    });

    let mut lines = vec![
        "You are the single global Email Agent — you maintain the agent mailbox and correspondence on behalf of all other agents.".to_string(),
        "Only you may gmail_send with account=agent. Other agents brief you via correspondence_sync.".to_string(),
        "You alone may use memory_search_all (read-only) to look up Memory Anchors from every companion when mail needs that context.".to_string(),
        "On every inbox wake: honor the dirty-check result below, then process new mail (gmail_read → reply if appropriate → update correspondence_sync).".to_string(),
        "Do not claim to be the human user. Keep a consistent external voice.".to_string(),
        String::new(),
        "=== CORRESPONDENCE SYNC (dirty-check) ===".to_string(),
        sync.prompt_block,
        "=== END SYNC ===".to_string(),
        String::new(),
        format!("{} new unread message(s):", fresh.len()),
    ];
    let mut ids = Vec::new();
    for m in &fresh {
        let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        ids.push(id.clone());
        lines.push(format!(
            "- id={id} from={} subject={} snippet={}",
            m.get("from").and_then(|v| v.as_str()).unwrap_or(""),
            m.get("subject").and_then(|v| v.as_str()).unwrap_or(""),
            m.get("snippet").and_then(|v| v.as_str()).unwrap_or(""),
        ));
    }
    let message = lines.join("\n");

    let pid = state.personality.active_profile_id();
    let label = format!("Email Agent : {at} - ");
    let mut options = chat::ChatTurnOptions::pulse(label);
    if force {
        options.skip_if_busy = false;
    }

    eprintln!(
        "persistent-sage: email agent wake (conversation={cid}, full_sync={})",
        sync.included_full_sync
    );

    match chat::execute_chat_turn(app, state, &cid, &message, &pid, None, options).await {
        Ok(reply) => {
            // Advance sync_checked only after a successful turn. The wake prompt is
            // ephemeral (Pulse options); committing checked before execute_chat_turn
            // made busy-skips / provider errors permanently drop correspondence context.
            if sync.included_full_sync {
                if let Err(e) =
                    correspondence_sync::mark_email_agent_sync_checked(&state.workspace_root)
                {
                    eprintln!("persistent-sage: email agent mark sync_checked: {e}");
                }
            }
            let _ = state.settings.mark_agent_email_seen(&ids);
            let mut guard = LAST_QUERY.lock().map_err(|e| e.to_string())?;
            *guard = Some(std::time::Instant::now());
            let summary = reply.trim().to_string();
            let _ = app.emit(
                "agent-email:watch",
                AgentEmailWatchEvent {
                    ok: !summary.is_empty(),
                    at,
                    new_count: fresh.len() as u32,
                    conversation_id: Some(cid.clone()),
                    summary: if summary.is_empty() {
                        None
                    } else {
                        Some(summary)
                    },
                    error: None,
                },
            );
        }
        Err(e) if e == chat::TURN_SKIPPED_BUSY => {
            return Ok(());
        }
        Err(e) => {
            let mut guard = LAST_QUERY.lock().map_err(|e| e.to_string())?;
            *guard = Some(std::time::Instant::now());
            let _ = app.emit(
                "agent-email:watch",
                AgentEmailWatchEvent {
                    ok: false,
                    at,
                    new_count: fresh.len() as u32,
                    conversation_id: Some(cid),
                    summary: None,
                    error: Some(e),
                },
            );
        }
    }
    Ok(())
}

/// Manual check (Settings) — same global Email Agent path as the timer.
#[tauri::command]
pub async fn agent_email_watch_run_now(
    app: AppHandle,
    state: tauri::State<'_, NovaState>,
) -> Result<(), String> {
    run_watch_tick(&app, &state, true).await
}
