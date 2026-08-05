//! Backend event stream for the Agent Action Stream panel.
//!
//! Emits Tauri events that the frontend listens to. Events are best-effort;
//! if no listener is attached they are silently dropped.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStepStartEvent {
    pub id: String,
    pub generation_number: Option<u32>,
    pub mission: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStepEndEvent {
    pub id: String,
    pub success: bool,
    pub summary: String,
    pub generation_number: Option<u32>,
    pub commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStartEvent {
    pub stream_id: String,
    pub tool_kind: String,
    pub label: String,
    pub input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEndEvent {
    pub stream_id: String,
    pub tool_kind: String,
    pub tool_name: String,
    pub label: String,
    pub success: bool,
    pub output: String,
}

/// In-process ring buffer of recent stream events so a freshly mounted Agent
/// Action Stream panel can catch up. This is best-effort and ephemeral.
const EVENT_LOG_CAPACITY: usize = 256;

#[derive(Clone, Debug)]
struct LoggedEvent {
    event_name: &'static str,
    payload: serde_json::Value,
}

static EVENT_LOG: std::sync::Mutex<Vec<LoggedEvent>> = std::sync::Mutex::new(Vec::new());

fn log_event(event_name: &'static str, payload: &impl Serialize) {
    if let Ok(json) = serde_json::to_value(payload) {
        if let Ok(mut log) = EVENT_LOG.lock() {
            log.push(LoggedEvent { event_name, payload: json });
            if log.len() > EVENT_LOG_CAPACITY {
                log.remove(0);
            }
        }
    }
}

fn replay_recent_events(app: &AppHandle) {
    let events: Vec<LoggedEvent> = EVENT_LOG.lock().map(|l| l.clone()).unwrap_or_default();
    for ev in events {
        let _ = app.emit(ev.event_name, ev.payload);
    }
}

/// Emit a generation-step start event. Returns a stream id the caller can reuse.
pub fn emit_generation_step_start(
    app: &AppHandle,
    generation_number: Option<u32>,
    mission: &str,
) -> String {
    emit_generation_step_start_nested(app, generation_number, mission, None, None)
}

/// Like [`emit_generation_step_start`] with optional nesting metadata for the Agent Action Stream.
pub fn emit_generation_step_start_nested(
    app: &AppHandle,
    generation_number: Option<u32>,
    mission: &str,
    depth: Option<u8>,
    agent_kind: Option<&str>,
) -> String {
    let id = format!("gen-step-{}", uuid::Uuid::new_v4());
    let payload = GenerationStepStartEvent {
        id: id.clone(),
        generation_number,
        mission: mission.to_string(),
        depth,
        agent_kind: agent_kind.map(|s| s.to_string()),
    };
    log_event("generation_step:start", &payload);
    let _ = app.emit("generation_step:start", payload);
    id
}

pub fn emit_generation_step_end(
    app: &AppHandle,
    stream_id: &str,
    success: bool,
    summary: &str,
    generation_number: Option<u32>,
    commit_sha: Option<String>,
) {
    let payload = GenerationStepEndEvent {
        id: stream_id.to_string(),
        success,
        summary: summary.to_string(),
        generation_number,
        commit_sha,
    };
    log_event("generation_step:end", &payload);
    let _ = app.emit("generation_step:end", payload);
}

pub fn emit_tool_start(
    app: &AppHandle,
    stream_id: &str,
    tool_kind: &str,
    label: &str,
    input: Option<serde_json::Value>,
) {
    let payload = ToolStartEvent {
        stream_id: stream_id.to_string(),
        tool_kind: tool_kind.to_string(),
        label: label.to_string(),
        input,
    };
    log_event("tool:start", &payload);
    let _ = app.emit("tool:start", payload);
}

pub fn emit_tool_end(
    app: &AppHandle,
    stream_id: &str,
    tool_kind: &str,
    tool_name: &str,
    label: &str,
    success: bool,
    output: &str,
) {
    let payload = ToolEndEvent {
        stream_id: stream_id.to_string(),
        tool_kind: tool_kind.to_string(),
        tool_name: tool_name.to_string(),
        label: label.to_string(),
        success,
        output: output.to_string(),
    };
    log_event("tool:end", &payload);
    let _ = app.emit("tool:end", payload);
}

/// Convenience: run an async tool that returns `Result<String, ProviderError>`
/// and emit matching `tool:start` / `tool:end` events. This is the canonical
/// path for chat tools and the ToolInspector IPC.
pub async fn run_result_tool_with_stream<F, Fut>(
    app: &AppHandle,
    tool_kind: &str,
    tool_name: &str,
    label: &str,
    input: Option<serde_json::Value>,
    f: F,
) -> Result<String, crate::provider::ProviderError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<String, crate::provider::ProviderError>>,
{
    let stream_id = format!("tool-{}-{}", tool_name, uuid::Uuid::new_v4());
    // emit_tool_start / emit_tool_end already log to EVENT_LOG, so don't log again here.
    emit_tool_start(app, &stream_id, tool_kind, label, input);
    let result = f().await;
    let (success, output) = match &result {
        Ok(out) => (true, out.clone()),
        Err(e) => (false, e.to_string()),
    };
    emit_tool_end(app, &stream_id, tool_kind, tool_name, label, success, &output);
    result
}

/// Ask the backend to replay recent stream events to the newly mounted listener.
/// Called from the frontend when the Agent Action Stream mounts.
#[tauri::command]
pub fn agent_stream_replay_recent(app: tauri::AppHandle) {
    replay_recent_events(&app);
}

/// Return the current in-memory event log as a JSON string for the debugger.
#[tauri::command]
pub fn agent_stream_snapshot() -> Result<String, String> {
    let events: Vec<LoggedEvent> = EVENT_LOG.lock().map(|l| l.clone()).unwrap_or_default();
    let mut out = Vec::with_capacity(events.len());
    for ev in events {
        out.push(serde_json::json!({
            "eventName": ev.event_name,
            "backendTimestampMs": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            "payload": ev.payload,
        }));
    }
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

/// Emit a synthetic tool:start / tool:end pair so the user can verify the
/// event channel works without running a real tool.
#[tauri::command]
pub fn agent_stream_emit_synthetic(app: tauri::AppHandle, label: String) {
    let stream_id = format!("synthetic-{}-{}", uuid::Uuid::new_v4(), label);
    emit_tool_start(&app, &stream_id, "synthetic", &label, None);
    emit_tool_end(
        &app,
        &stream_id,
        "synthetic",
        "agent_stream_emit_synthetic",
        &label,
        true,
        "Synthetic event emitted successfully.",
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousActionApprovalEvent {
    pub id: String,
    pub action_kind: String,
    pub description: String,
    pub conversation_id: Option<String>,
    pub repo_id: Option<String>,
    pub deadline_secs: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousActionResolvedEvent {
    pub id: String,
    pub approved: bool,
    pub reason: Option<String>,
}

/// Emit a request for user approval before an autonomous action.
/// Best-effort; returns the generated id.
pub fn emit_approval_request(
    app: &AppHandle,
    action_kind: &str,
    description: &str,
    conversation_id: Option<String>,
    repo_id: Option<String>,
    deadline_secs: u32,
) -> String {
    let id = format!("approval-{}", uuid::Uuid::new_v4());
    let _ = app.emit(
        "agent:approval_request",
        AutonomousActionApprovalEvent {
            id: id.clone(),
            action_kind: action_kind.to_string(),
            description: description.to_string(),
            conversation_id,
            repo_id,
            deadline_secs,
        },
    );
    id
}

pub fn emit_approval_resolved(app: &AppHandle, id: &str, approved: bool, reason: Option<&str>) {
    let _ = app.emit(
        "agent:approval_resolved",
        AutonomousActionResolvedEvent {
            id: id.to_string(),
            approved,
            reason: reason.map(|s| s.to_string()),
        },
    );
}

/// Emit a free-form status message for the stream.
pub fn emit_status(app: &AppHandle, stream_id: &str, status: &str, detail: Option<&str>) {
    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct StatusEvent {
        stream_id: String,
        status: String,
        detail: Option<String>,
    }
    let _ = app.emit(
        "tool:status",
        StatusEvent {
            stream_id: stream_id.to_string(),
            status: status.to_string(),
            detail: detail.map(|s| s.to_string()),
        },
    );
}
