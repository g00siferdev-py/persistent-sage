//! Autonomous Moltbook scheduler: the agent (never the human) browses/engages and
//! posts to Moltbook on independent timers. Runs a hidden background chat turn with
//! Moltbook tools enabled and logs a short summary to a dedicated "Moltbook" thread.

use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::chat;
use crate::NovaState;

/// What kind of scheduled Moltbook action to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoltbookAction {
    /// Browse the feed, read, vote, and comment — but do not create a new post.
    Interact,
    /// Compose and publish one original post.
    Post,
}

impl MoltbookAction {
    fn label(self) -> &'static str {
        match self {
            MoltbookAction::Interact => "Moltbook Activity",
            MoltbookAction::Post => "Moltbook Post",
        }
    }

    fn prompt(self) -> &'static str {
        match self {
            MoltbookAction::Interact => {
                "Time for your regular Moltbook check-in. Use your Moltbook tools to browse the \
                 current feed and search a topic you care about. Read what other AI agents are \
                 posting, upvote anything you genuinely find interesting, and leave one or two \
                 thoughtful comments where you actually have something to add. Do NOT create a new \
                 top-level post during this check-in — just engage. Act as yourself."
            }
            MoltbookAction::Post => {
                "Time to share something on Moltbook. Compose one original post in your own voice — \
                 a genuine thought, observation, or update you'd want other AI agents to see. Call \
                 the moltbook_create_post tool and pick whichever submolt (community) best fits \
                 your topic. Keep it authentic and concise."
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoltbookSchedulerEvent {
    pub ok: bool,
    pub at: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn emit(app: &AppHandle, event: MoltbookSchedulerEvent) {
    let _ = app.emit("moltbook:scheduler", event);
}

/// Get-or-create the dedicated conversation the scheduler logs to (per active companion).
fn ensure_conversation(state: &NovaState) -> Result<String, String> {
    if let Some(existing) = state.settings.moltbook_scheduler_conversation_id() {
        // Confirm it still exists for the active personality.
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
        .create_conversation("Moltbook")
        .map_err(|e| format!("could not create Moltbook thread: {e}"))?;
    let _ = state
        .settings
        .set_moltbook_scheduler_conversation_id(Some(id.clone()));
    Ok(id)
}

/// True when every precondition for autonomous Moltbook activity is satisfied.
fn scheduler_ready(state: &NovaState) -> bool {
    let s = &state.settings;
    if !s.moltbook_scheduler_enabled() || !s.moltbook_enabled() || !s.moltbook_agent_tools_enabled()
    {
        return false;
    }
    match s.view() {
        Ok(v) => !v
            .selected_provider
            .trim()
            .eq_ignore_ascii_case("placeholder"),
        Err(_) => false,
    }
}

async fn run_action(app: &AppHandle, state: &NovaState, action: MoltbookAction, manual: bool) {
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    if !manual && !scheduler_ready(state) {
        return;
    }
    if manual && (!state.settings.moltbook_enabled() || !state.settings.moltbook_agent_tools_enabled())
    {
        emit(
            app,
            MoltbookSchedulerEvent {
                ok: false,
                at,
                action: action.label().into(),
                conversation_id: None,
                summary: None,
                error: Some(
                    "Enable Moltbook and 'Let the agent use Moltbook tools' first.".into(),
                ),
            },
        );
        return;
    }

    let cid = match ensure_conversation(state) {
        Ok(id) => id,
        Err(e) => {
            emit(
                app,
                MoltbookSchedulerEvent {
                    ok: false,
                    at,
                    action: action.label().into(),
                    conversation_id: None,
                    summary: None,
                    error: Some(e),
                },
            );
            return;
        }
    };

    let pid = state.personality.active_profile_id();
    let label = format!("{} : {at} - ", action.label());

    match chat::execute_chat_turn(
        app,
        state,
        &cid,
        action.prompt(),
        &pid,
        None,
        chat::ChatTurnOptions::moltbook(label),
    )
    .await
    {
        Ok(reply) => {
            let summary = reply.trim().to_string();
            let ok = !summary.is_empty();
            emit(
                app,
                MoltbookSchedulerEvent {
                    ok,
                    at,
                    action: action.label().into(),
                    conversation_id: Some(cid),
                    summary: if ok { Some(summary) } else { None },
                    error: if ok {
                        None
                    } else {
                        Some("Empty assistant reply.".into())
                    },
                },
            );
        }
        Err(e) => {
            emit(
                app,
                MoltbookSchedulerEvent {
                    ok: false,
                    at,
                    action: action.label().into(),
                    conversation_id: Some(cid),
                    summary: None,
                    error: Some(e),
                },
            );
        }
    }
}

pub fn spawn_moltbook_scheduler_loop(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Wait one full interval before the first action so app launches don't spam Moltbook.
        let mut last_interact = Instant::now();
        let mut last_post = Instant::now();

        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;

            let Some(state) = app_handle.try_state::<NovaState>() else {
                continue;
            };
            if !scheduler_ready(&state) {
                continue;
            }

            let interact_every =
                Duration::from_secs(state.settings.moltbook_interact_interval_minutes() as u64 * 60);
            let post_every =
                Duration::from_secs(state.settings.moltbook_post_interval_minutes() as u64 * 60);

            let now = Instant::now();
            if now.duration_since(last_interact) >= interact_every {
                last_interact = now;
                run_action(&app_handle, &state, MoltbookAction::Interact, false).await;
            }

            // Re-read now: an interact turn can take a while.
            let now = Instant::now();
            if now.duration_since(last_post) >= post_every {
                last_post = now;
                run_action(&app_handle, &state, MoltbookAction::Post, false).await;
            }
        }
    });
}

/// Trigger one Moltbook interaction immediately (Settings → "Engage now").
#[tauri::command]
pub async fn moltbook_scheduler_run_interact(
    app: AppHandle,
    state: tauri::State<'_, NovaState>,
) -> Result<(), String> {
    run_action(&app, &state, MoltbookAction::Interact, true).await;
    Ok(())
}

/// Trigger one Moltbook post immediately (Settings → "Post now").
#[tauri::command]
pub async fn moltbook_scheduler_run_post(
    app: AppHandle,
    state: tauri::State<'_, NovaState>,
) -> Result<(), String> {
    run_action(&app, &state, MoltbookAction::Post, true).await;
    Ok(())
}
