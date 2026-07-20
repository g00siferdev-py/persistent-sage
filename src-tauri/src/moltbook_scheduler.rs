//! Autonomous Moltbook scheduler: the **agent** (never the human) browses, engages, and
//! posts on Moltbook. Humans may only configure settings and browse the read-only panel.
//!
//! Also runs a reply-watcher that polls `GET /home` for activity on the agent's posts.

use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::chat;
use crate::NovaState;

/// What kind of scheduled Moltbook action to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoltbookAction {
    /// Browse/engage per engagement flags — do not create a new top-level post.
    Interact,
    /// Compose and publish one original post.
    Post,
    /// Respond to new comments on the agent's own posts (reply watcher).
    ReplyToActivity,
    /// Human asked the agent to share some text as a Moltbook post (agent posts, not human).
    ShareRequest,
}

impl MoltbookAction {
    fn label(self) -> &'static str {
        match self {
            MoltbookAction::Interact => "Moltbook Activity",
            MoltbookAction::Post => "Moltbook Post",
            MoltbookAction::ReplyToActivity => "Moltbook Reply",
            MoltbookAction::ShareRequest => "Moltbook Share",
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

/// Privacy + custom Moltbook voice rules appended to every agent Moltbook turn.
pub fn moltbook_guidelines_appendix(state: &NovaState) -> String {
    let mut parts: Vec<String> = Vec::new();
    let custom = state.settings.moltbook_agent_prompt();
    if !custom.trim().is_empty() {
        parts.push(format!("# Moltbook engagement guidelines (from your human)\n{}", custom.trim()));
    }
    if state.settings.moltbook_never_discuss_human() {
        parts.push(
            "# Privacy — never discuss your human\n\
             Do not name, describe, quote, or allude to your human operator, their private life, \
             messages, or identity in any Moltbook post, comment, or DM. Speak as yourself — an AI agent."
                .into(),
        );
    }
    let blocked = state.settings.moltbook_blocked_topics();
    let topics: Vec<&str> = blocked
        .split(|c: char| c == ',' || c == '\n' || c == ';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if !topics.is_empty() {
        parts.push(format!(
            "# Blocked topics on Moltbook\nNever discuss or raise these topics: {}.",
            topics.join("; ")
        ));
    }
    parts.push(
        "# Platform integrity\n\
         Moltbook is for AI agents. You post and engage as the registered agent. \
         Humans configure and browse; they do not post under your identity."
            .into(),
    );
    parts.join("\n\n")
}

fn build_interact_prompt(state: &NovaState) -> String {
    let mut steps: Vec<String> = Vec::new();
    steps.push(
        "Time for your regular Moltbook check-in. You are the agent — act as yourself.".into(),
    );
    steps.push("Start with moltbook_home to see notifications, activity on your posts, and what to do next.".into());

    if state.settings.moltbook_engage_browse_feed() {
        steps.push("Browse the feed (moltbook_feed) and read what other agents are posting.".into());
    }
    if state.settings.moltbook_engage_search() {
        steps.push("Use moltbook_search on a topic you care about.".into());
    }
    if state.settings.moltbook_engage_upvote() {
        steps.push("Upvote posts or comments you genuinely enjoy (moltbook_upvote).".into());
    }
    if state.settings.moltbook_engage_comment() {
        steps.push(
            "Leave one or two thoughtful comments on others' posts where you have something to add (moltbook_comment)."
                .into(),
        );
    }
    if state.settings.moltbook_engage_reply_own() {
        steps.push(
            "If activity_on_your_posts shows new replies, read them (moltbook_get_comments), reply with parent_id when threading, then moltbook_mark_notifications_read."
                .into(),
        );
    }
    if state.settings.moltbook_engage_dms() {
        steps.push("Check DMs (moltbook_dm_check) and reply thoughtfully if appropriate (moltbook_dm_send).".into());
    }
    if state.settings.moltbook_engage_follow() {
        steps.push("Follow agents whose content you genuinely enjoy (moltbook_follow).".into());
    }
    steps.push("Do NOT create a new top-level post during this check-in — just engage.".into());

    let mut out = steps.join(" ");
    let guide = moltbook_guidelines_appendix(state);
    if !guide.is_empty() {
        out.push_str("\n\n");
        out.push_str(&guide);
    }
    out
}

fn build_post_prompt(state: &NovaState) -> String {
    let submolt_hint = match state.settings.moltbook_preferred_submolt() {
        Some(s) => format!(
            "A preferred community is configured (m/{s}) — you may use it, or override with another submolt if it fits better."
        ),
        None => "No preferred community is set — call moltbook_list_submolts if helpful, then choose the best submolt yourself when calling moltbook_create_post.".into(),
    };
    let mut out = format!(
        "Time to share something on Moltbook. Compose one original post in your own voice — \
         a genuine thought, observation, or update you'd want other AI agents to see. Call \
         moltbook_create_post with an appropriate title, content, and submolt. {submolt_hint} \
         Keep it authentic and concise.",
    );
    let guide = moltbook_guidelines_appendix(state);
    if !guide.is_empty() {
        out.push_str("\n\n");
        out.push_str(&guide);
    }
    out
}

fn build_reply_prompt(state: &NovaState, home_snapshot: &str) -> String {
    let mut out = format!(
        "New activity was detected on your Moltbook posts. Here is the latest /home snapshot:\n\n\
         {home_snapshot}\n\n\
         Priority: respond to comments on YOUR posts. Use moltbook_get_comments (sort=new), \
         reply with moltbook_comment (use parent_id for threaded replies), then \
         moltbook_mark_notifications_read for each post you handled. \
         Do not create a new top-level post."
    );
    let guide = moltbook_guidelines_appendix(state);
    if !guide.is_empty() {
        out.push_str("\n\n");
        out.push_str(&guide);
    }
    out
}

fn build_share_prompt(state: &NovaState, text: &str) -> String {
    let clipped: String = text.chars().take(8_000).collect();
    let submolt_hint = match state.settings.moltbook_preferred_submolt() {
        Some(s) => format!("Preferred community m/{s} is available; override if another fits better."),
        None => "No preferred community — pick the best submolt yourself (moltbook_list_submolts if needed).".into(),
    };
    let mut out = format!(
        "Your human asked you (the agent) to share the following on Moltbook as YOUR post. \
         They are not posting — you are. Adapt it into your voice if needed, then call \
         moltbook_create_post with an appropriate title, content, and submolt. {submolt_hint}\n\n\
         --- material to share ---\n{clipped}\n--- end ---"
    );
    let guide = moltbook_guidelines_appendix(state);
    if !guide.is_empty() {
        out.push_str("\n\n");
        out.push_str(&guide);
    }
    out
}

/// Sync memory's active personality to the on-disk companion before touching conversations.
///
/// Cold start leaves memory on `default` while PersonalityManager may already point at another
/// companion — without this sync, the scheduler creates a thread under the wrong id and the
/// subsequent chat turn fails with UnknownConversation (while normal chat still works).
fn sync_companion_personality(state: &NovaState) -> String {
    let pid = state.personality.active_profile_id();
    crate::memory::ConversationMemory::set_active_personality(&*state.memory, &pid);
    pid
}

/// Get-or-create the dedicated conversation the scheduler logs to (per active companion).
fn ensure_conversation(state: &NovaState) -> Result<String, String> {
    let _pid = sync_companion_personality(state);
    if let Some(existing) = state.settings.moltbook_scheduler_conversation_id() {
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

fn reply_watcher_ready(state: &NovaState) -> bool {
    state.settings.moltbook_enabled()
        && state.settings.moltbook_agent_tools_enabled()
        && state.settings.moltbook_reply_watcher_enabled()
        && state.settings.moltbook_engage_reply_own()
        && match state.settings.view() {
            Ok(v) => !v
                .selected_provider
                .trim()
                .eq_ignore_ascii_case("placeholder"),
            Err(_) => false,
        }
}

fn activity_fingerprint(home: &Value) -> String {
    // Prefer structured activity; fall back to unread count.
    if let Some(act) = home.get("activity_on_your_posts") {
        return act.to_string();
    }
    if let Some(n) = home
        .pointer("/your_account/unread_notification_count")
        .and_then(|v| v.as_i64())
        .or_else(|| home.get("unread_notification_count").and_then(|v| v.as_i64()))
    {
        return format!("unread:{n}");
    }
    String::new()
}

fn has_actionable_activity(home: &Value) -> bool {
    if let Some(arr) = home.get("activity_on_your_posts").and_then(|v| v.as_array()) {
        return !arr.is_empty();
    }
    if let Some(obj) = home.get("activity_on_your_posts").and_then(|v| v.as_object()) {
        return !obj.is_empty();
    }
    home.pointer("/your_account/unread_notification_count")
        .and_then(|v| v.as_i64())
        .or_else(|| home.get("unread_notification_count").and_then(|v| v.as_i64()))
        .map(|n| n > 0)
        .unwrap_or(false)
}

async fn run_action_with_prompt(
    app: &AppHandle,
    state: &NovaState,
    action: MoltbookAction,
    prompt: String,
    manual: bool,
) -> MoltbookSchedulerEvent {
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    if !manual && action != MoltbookAction::ReplyToActivity && !scheduler_ready(state) {
        return MoltbookSchedulerEvent {
            ok: false,
            at,
            action: action.label().into(),
            conversation_id: None,
            summary: None,
            error: Some("Scheduler not ready (enable Moltbook tools + autonomous scheduler).".into()),
        };
    }
    if !manual && action == MoltbookAction::ReplyToActivity && !reply_watcher_ready(state) {
        return MoltbookSchedulerEvent {
            ok: false,
            at,
            action: action.label().into(),
            conversation_id: None,
            summary: None,
            error: Some("Reply watcher not ready.".into()),
        };
    }
    if manual
        && (!state.settings.moltbook_enabled() || !state.settings.moltbook_agent_tools_enabled())
    {
        let event = MoltbookSchedulerEvent {
            ok: false,
            at,
            action: action.label().into(),
            conversation_id: None,
            summary: None,
            error: Some(
                "Enable Moltbook and 'Let the agent use Moltbook tools' first.".into(),
            ),
        };
        emit(app, event.clone());
        return event;
    }

    let cid = match ensure_conversation(state) {
        Ok(id) => id,
        Err(e) => {
            let event = MoltbookSchedulerEvent {
                ok: false,
                at,
                action: action.label().into(),
                conversation_id: None,
                summary: None,
                error: Some(e),
            };
            emit(app, event.clone());
            return event;
        }
    };

    let pid = sync_companion_personality(state);
    let label = format!("{} : {at} - ", action.label());
    eprintln!(
        "persistent-sage: moltbook scheduler starting {} (conversation={cid}, personality={pid})",
        action.label()
    );

    let event = match chat::execute_chat_turn(
        app,
        state,
        &cid,
        &prompt,
        &pid,
        None,
        chat::ChatTurnOptions::moltbook(label),
    )
    .await
    {
        Ok(reply) => {
            let summary = reply.trim().to_string();
            let ok = !summary.is_empty();
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
            }
        }
        Err(e) => {
            eprintln!("persistent-sage: moltbook scheduler {} failed: {e}", action.label());
            MoltbookSchedulerEvent {
                ok: false,
                at,
                action: action.label().into(),
                conversation_id: Some(cid),
                summary: None,
                error: Some(e),
            }
        }
    };
    emit(app, event.clone());
    event
}

async fn run_action(
    app: &AppHandle,
    state: &NovaState,
    action: MoltbookAction,
    manual: bool,
) -> MoltbookSchedulerEvent {
    let prompt = match action {
        MoltbookAction::Interact => build_interact_prompt(state),
        MoltbookAction::Post => build_post_prompt(state),
        MoltbookAction::ReplyToActivity => build_reply_prompt(state, "(no snapshot)"),
        MoltbookAction::ShareRequest => build_share_prompt(state, ""),
    };
    run_action_with_prompt(app, state, action, prompt, manual).await
}

pub fn spawn_moltbook_scheduler_loop(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // None = due on first ready poll (do not wait a full interval after every app restart).
        let mut last_interact: Option<Instant> = None;
        let mut last_post: Option<Instant> = None;
        let mut last_reply_poll: Option<Instant> = None;
        let mut last_activity_fp = String::new();

        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;

            let Some(state) = app_handle.try_state::<NovaState>() else {
                continue;
            };

            // Reply watcher (near-immediate responses to comments on the agent's posts).
            if reply_watcher_ready(&state) {
                let poll_every = Duration::from_secs(
                    state.settings.moltbook_reply_poll_minutes() as u64 * 60,
                );
                let now = Instant::now();
                let due = last_reply_poll
                    .map(|t| now.duration_since(t) >= poll_every)
                    .unwrap_or(true);
                if due {
                    last_reply_poll = Some(now);
                    match crate::moltbook::fetch_home(&state.http, &state.settings).await {
                        Ok(home) => {
                            let fp = activity_fingerprint(&home);
                            if has_actionable_activity(&home)
                                && !fp.is_empty()
                                && fp != last_activity_fp
                            {
                                last_activity_fp = fp;
                                let prompt = build_reply_prompt(&state, &home.to_string());
                                let _ = run_action_with_prompt(
                                    &app_handle,
                                    &state,
                                    MoltbookAction::ReplyToActivity,
                                    prompt,
                                    false,
                                )
                                .await;
                            } else if fp.is_empty() || !has_actionable_activity(&home) {
                                last_activity_fp = fp;
                            }
                        }
                        Err(_) => { /* ignore transient poll errors */ }
                    }
                }
            }

            if !scheduler_ready(&state) {
                continue;
            }

            let interact_every =
                Duration::from_secs(state.settings.moltbook_interact_interval_minutes() as u64 * 60);
            let post_every =
                Duration::from_secs(state.settings.moltbook_post_interval_minutes() as u64 * 60);

            let now = Instant::now();
            let interact_due = last_interact
                .map(|t| now.duration_since(t) >= interact_every)
                .unwrap_or(true);
            if interact_due {
                last_interact = Some(now);
                let _ = run_action(&app_handle, &state, MoltbookAction::Interact, false).await;
            }

            let now = Instant::now();
            let post_due = last_post
                .map(|t| now.duration_since(t) >= post_every)
                .unwrap_or(true);
            if post_due {
                last_post = Some(now);
                let _ = run_action(&app_handle, &state, MoltbookAction::Post, false).await;
            }
        }
    });
}

fn event_to_result(event: MoltbookSchedulerEvent) -> Result<MoltbookSchedulerEvent, String> {
    if event.ok {
        Ok(event)
    } else {
        Err(event
            .error
            .unwrap_or_else(|| "Moltbook scheduler action failed.".into()))
    }
}

#[tauri::command]
pub async fn moltbook_scheduler_run_interact(
    app: AppHandle,
    state: tauri::State<'_, NovaState>,
) -> Result<MoltbookSchedulerEvent, String> {
    let event = run_action(&app, &state, MoltbookAction::Interact, true).await;
    event_to_result(event)
}

#[tauri::command]
pub async fn moltbook_scheduler_run_post(
    app: AppHandle,
    state: tauri::State<'_, NovaState>,
) -> Result<MoltbookSchedulerEvent, String> {
    let event = run_action(&app, &state, MoltbookAction::Post, true).await;
    event_to_result(event)
}

/// Ask the **agent** to share text on Moltbook (humans never post directly).
#[tauri::command]
pub async fn moltbook_scheduler_ask_share(
    text: String,
    app: AppHandle,
    state: tauri::State<'_, NovaState>,
) -> Result<MoltbookSchedulerEvent, String> {
    let t = text.trim();
    if t.is_empty() {
        return Err("Nothing to share.".into());
    }
    let prompt = build_share_prompt(&state, t);
    let event =
        run_action_with_prompt(&app, &state, MoltbookAction::ShareRequest, prompt, true).await;
    event_to_result(event)
}
