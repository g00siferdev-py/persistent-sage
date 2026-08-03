//! Scheduled Pulse(s): background check-ins using bound conversation context.

use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::chat;
use crate::settings::PulseEntry;
use crate::NovaState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PulseTickEvent {
    pub ok: bool,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pulse_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pulse_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn pulse_due(entry: &PulseEntry, now: DateTime<Utc>) -> bool {
    let Some(ref last) = entry.last_run_at else {
        return true;
    };
    let Ok(prev) = DateTime::parse_from_rfc3339(last) else {
        return true;
    };
    let elapsed = now.signed_duration_since(prev.with_timezone(&Utc));
    let mins = entry.interval_minutes.max(1) as i64;
    elapsed.num_minutes() >= mins
}

async fn run_one_pulse(
    app: &AppHandle,
    state: &NovaState,
    entry: &PulseEntry,
    manual: bool,
) {
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    if state
        .settings
        .view()
        .ok()
        .map(|v| {
            v.selected_provider
                .trim()
                .eq_ignore_ascii_case("placeholder")
        })
        .unwrap_or(true)
    {
        let _ = app.emit(
            "pulse:tick",
            PulseTickEvent {
                ok: false,
                at,
                pulse_id: Some(entry.id.clone()),
                pulse_name: Some(entry.name.clone()),
                conversation_id: None,
                summary: None,
                error: Some("Configure a live provider in Settings before using Pulse.".into()),
            },
        );
        return;
    }

    let Some(cid) = entry
        .conversation_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            state
                .settings
                .view()
                .ok()
                .and_then(|v| v.pulse_conversation_id)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
    else {
        let _ = app.emit(
            "pulse:tick",
            PulseTickEvent {
                ok: false,
                at,
                pulse_id: Some(entry.id.clone()),
                pulse_name: Some(entry.name.clone()),
                conversation_id: None,
                summary: None,
                error: Some(
                    "No conversation bound — open a chat thread (Pulse runs in that session)."
                        .into(),
                ),
            },
        );
        return;
    };

    let instructions = entry.instructions.trim();
    let message = if instructions.is_empty() {
        "Brief background check-in: note any reminders, open loops, or a short useful thought for the user.".into()
    } else {
        instructions.to_string()
    };

    let pid = state.personality.active_profile_id();
    let pulse_label = format!("Pulse ({}) : {at} - ", entry.name);
    let mut options = chat::ChatTurnOptions::pulse(pulse_label);
    if manual {
        options.skip_if_busy = false;
    }

    match chat::execute_chat_turn(app, state, &cid, &message, &pid, None, options).await
    {
        Ok(reply) => {
            let summary = reply.trim().to_string();
            let ok = !summary.is_empty();
            let _ = state.settings.touch_pulse_last_run(&entry.id, &at);
            let _ = app.emit(
                "pulse:tick",
                PulseTickEvent {
                    ok,
                    at,
                    pulse_id: Some(entry.id.clone()),
                    pulse_name: Some(entry.name.clone()),
                    conversation_id: Some(cid.clone()),
                    summary: if ok { Some(summary) } else { None },
                    error: if ok {
                        None
                    } else {
                        Some("Empty assistant reply.".into())
                    },
                },
            );
        }
        Err(e) if e == chat::TURN_SKIPPED_BUSY => {
            // Companion is mid-task — skip this Pulse without advancing last-run.
        }
        Err(e) => {
            if !manual {
                let _ = state.settings.touch_pulse_last_run(&entry.id, &at);
            }
            let _ = app.emit(
                "pulse:tick",
                PulseTickEvent {
                    ok: false,
                    at,
                    pulse_id: Some(entry.id.clone()),
                    pulse_name: Some(entry.name.clone()),
                    conversation_id: Some(cid),
                    summary: None,
                    error: Some(e),
                },
            );
        }
    }
}

async fn run_pulse_tick(app: &AppHandle, state: &NovaState, manual: bool, pulse_id: Option<&str>) {
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let view = match state.settings.view() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("persistent-sage: pulse skipped — settings: {e}");
            if manual {
                let _ = app.emit(
                    "pulse:tick",
                    PulseTickEvent {
                        ok: false,
                        at,
                        pulse_id: None,
                        pulse_name: None,
                        conversation_id: None,
                        summary: None,
                        error: Some(e.to_string()),
                    },
                );
            }
            return;
        }
    };

    let now = Utc::now();
    let mut targets: Vec<PulseEntry> = view.pulses.clone();
    if targets.is_empty() && (view.pulse_enabled || view.pulse_conversation_id.is_some()) {
        // Legacy single-pulse fallback if migration hasn't run yet.
        targets.push(PulseEntry {
            id: "legacy".into(),
            name: "Pulse".into(),
            enabled: view.pulse_enabled || manual,
            interval_minutes: view.pulse_interval_minutes.max(1),
            instructions: view.pulse_instructions.clone(),
            conversation_id: view.pulse_conversation_id.clone(),
            last_run_at: None,
        });
    }

    let target_count = targets.len();
    for entry in targets {
        if let Some(want) = pulse_id {
            if entry.id != want {
                continue;
            }
        } else if !manual {
            if !entry.enabled {
                continue;
            }
            if !pulse_due(&entry, now) {
                continue;
            }
        } else if pulse_id.is_none() && !entry.enabled && target_count > 1 {
            // Manual "run all" without id: only enabled pulses.
            continue;
        }
        run_one_pulse(app, state, &entry, manual).await;
    }
}

pub fn spawn_pulse_loop(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if let Some(state) = app_handle.try_state::<NovaState>() {
                if let Ok(v) = state.settings.view() {
                    if v.selected_provider
                        .trim()
                        .eq_ignore_ascii_case("placeholder")
                    {
                        continue;
                    }
                    let any_enabled = v.pulses.iter().any(|p| p.enabled)
                        || (v.pulses.is_empty() && v.pulse_enabled);
                    if !any_enabled {
                        continue;
                    }
                    run_pulse_tick(&app_handle, &state, false, None).await;
                }
            }
        }
    });
}

/// Run Pulse immediately. Pass `pulseId` to run one job; omit to run all enabled pulses.
#[tauri::command]
pub async fn pulse_run_now(
    pulse_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, NovaState>,
) -> Result<(), String> {
    run_pulse_tick(&app, &state, true, pulse_id.as_deref()).await;
    Ok(())
}
