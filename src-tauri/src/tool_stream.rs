//! Tauri events for live agent tool activity (coding shell output, tool start/end).

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatToolStreamEvent {
    pub conversation_id: String,
    pub tool_name: String,
    /// `start` | `output` | `end`
    pub phase: String,
    pub detail: String,
    pub delta: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnStatusEvent {
    pub conversation_id: String,
    pub detail: String,
}

#[derive(Clone)]
pub struct ToolStreamEmitter {
    app: AppHandle,
    conversation_id: String,
}

fn emit_to_main_webview<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit(event, payload);
    } else {
        let _ = app.emit(event, payload);
    }
}

impl ToolStreamEmitter {
    pub fn new(app: AppHandle, conversation_id: impl Into<String>) -> Self {
        Self {
            app,
            conversation_id: conversation_id.into(),
        }
    }

    pub fn turn_status(&self, detail: &str) {
        emit_to_main_webview(
            &self.app,
            "chat:turn-status",
            ChatTurnStatusEvent {
                conversation_id: self.conversation_id.clone(),
                detail: detail.to_string(),
            },
        );
    }

    pub fn start(&self, tool_name: &str, detail: &str) {
        self.turn_status("");
        self.emit(tool_name, "start", detail, "");
    }

    pub fn output(&self, tool_name: &str, delta: &str) {
        if delta.is_empty() {
            return;
        }
        self.emit(tool_name, "output", "", delta);
    }

    pub fn end(&self, tool_name: &str) {
        self.emit(tool_name, "end", "", "");
    }

    fn emit(&self, tool_name: &str, phase: &str, detail: &str, delta: &str) {
        emit_to_main_webview(
            &self.app,
            "chat:tool-stream",
            ChatToolStreamEvent {
                conversation_id: self.conversation_id.clone(),
                tool_name: tool_name.to_string(),
                phase: phase.to_string(),
                detail: detail.to_string(),
                delta: delta.to_string(),
            },
        );
    }
}

pub fn emit_chat_event<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    emit_to_main_webview(app, event, payload);
}

pub fn tool_start_detail(name: &str, arguments_json: &str) -> String {
    let v: Value = serde_json::from_str(arguments_json).unwrap_or(Value::Null);
    match name {
        "coding_run_command" => {
            let cmd = v["command"].as_str().unwrap_or("").trim();
            let cwd = v["cwd"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|c| format!(" (cwd: {c})"))
                .unwrap_or_default();
            format!("{cmd}{cwd}")
        }
        "coding_grep" => {
            let pattern = v["pattern"].as_str().unwrap_or("").trim();
            let path = v["path"]
                .as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|p| format!(" in {p}"))
                .unwrap_or_default();
            format!("/{pattern}/{path}")
        }
        "coding_apply_patch" => v["path"].as_str().unwrap_or("").trim().to_string(),
        "coding_git_diff" => v["path"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("(all changes)")
            .to_string(),
        "coding_git_commit" => v["message"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(120)
            .collect(),
        "workspace_read_file" | "workspace_write_file" => {
            v["path"].as_str().unwrap_or("").trim().to_string()
        }
        _ => String::new(),
    }
}
