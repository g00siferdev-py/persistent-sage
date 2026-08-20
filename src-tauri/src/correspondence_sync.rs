//! Correspondence sync: living state for the dedicated Email Agent.
//!
//! Files (under the agent workspace):
//! - `correspondence_sync.md` — canonical relationship / thread state
//! - `sync_modified.txt` — last time any agent changed the sync file
//! - `sync_checked.txt` — last time the Email Agent verified the sync file

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};
use regex::Regex;
use serde_json::{json, Value};

use crate::agent_tools::tool_err;
use crate::provider::{ProviderError, ToolDefinition};

pub const SYNC_FILE: &str = "correspondence_sync.md";
pub const SYNC_MODIFIED: &str = "sync_modified.txt";
pub const SYNC_CHECKED: &str = "sync_checked.txt";

/// Serialize file writes across agents (and watch ticks).
static SYNC_LOCK: Mutex<()> = Mutex::new(());

const INITIAL_SYNC: &str = r#"---
last_updated: PLACEHOLDER_TS
updated_by: system
version: 1.0
---

# Correspondence Sync

Canonical state for agent-mailbox relationships. Prefer the **correspondence_sync** tool over editing this file by hand.

## Active Correspondences

_(none yet)_

## Email Agent Operating Procedures

### On Wake (Automated Trigger)
1. Dirty-check `sync_modified.txt` vs `sync_checked.txt`; re-read this file if modified.
2. Process new inbox mail with `gmail_read` / `gmail_send` (`account=agent`).
3. Update correspondences (history, pending actions, tone) via **correspondence_sync**.
4. Keep a consistent external voice; do not claim to be the human user.

### Before Sending
1. Prefer an existing Active Correspondences entry for the recipient.
2. Honor tone preferences and pending actions.
3. Use `thread_id` + `in_reply_to` from `gmail_read` when replying.

### After Sending / Receiving
1. `add_history_entry` (and `mark_action_complete` when relevant).
2. Add memory anchor references (`anchor://UUID`) for lasting facts.
"#;

fn now_ts() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn path_in(root: &Path, name: &str) -> PathBuf {
    root.join(name)
}

fn write_ts_file(root: &Path, name: &str, ts: &str) -> Result<(), ProviderError> {
    std::fs::write(path_in(root, name), format!("{ts}\n"))
        .map_err(|e| tool_err(format!("write {name}: {e}")))
}

fn read_ts_file(root: &Path, name: &str) -> Option<String> {
    std::fs::read_to_string(path_in(root, name))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Create sync + timestamp files if missing (idempotent).
pub fn ensure_files(workspace_root: &Path) -> Result<(), String> {
    let _guard = SYNC_LOCK
        .lock()
        .map_err(|_| "correspondence sync lock poisoned".to_string())?;
    let ts = now_ts();
    let sync_path = path_in(workspace_root, SYNC_FILE);
    if !sync_path.exists() {
        let body = INITIAL_SYNC.replace("PLACEHOLDER_TS", &ts);
        std::fs::write(&sync_path, body).map_err(|e| format!("write {SYNC_FILE}: {e}"))?;
    }
    if !path_in(workspace_root, SYNC_MODIFIED).exists() {
        write_ts_file(workspace_root, SYNC_MODIFIED, &ts).map_err(|e| e.to_string())?;
    }
    if !path_in(workspace_root, SYNC_CHECKED).exists() {
        write_ts_file(workspace_root, SYNC_CHECKED, &ts).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn touch_modified(workspace_root: &Path, updated_by: &str) -> Result<(), ProviderError> {
    let ts = now_ts();
    write_ts_file(workspace_root, SYNC_MODIFIED, &ts)?;
    let path = path_in(workspace_root, SYNC_FILE);
    let mut body = std::fs::read_to_string(&path).unwrap_or_default();
    if body.starts_with("---") {
        if let Some(end) = body.find("\n---") {
            let header = &body[3..end];
            let mut last_updated = false;
            let mut updated_by_set = false;
            let mut lines = Vec::new();
            for line in header.lines() {
                if line.starts_with("last_updated:") {
                    lines.push(format!("last_updated: {ts}"));
                    last_updated = true;
                } else if line.starts_with("updated_by:") {
                    lines.push(format!("updated_by: {updated_by}"));
                    updated_by_set = true;
                } else if !line.trim().is_empty() {
                    lines.push(line.to_string());
                }
            }
            if !last_updated {
                lines.insert(0, format!("last_updated: {ts}"));
            }
            if !updated_by_set {
                lines.push(format!("updated_by: {updated_by}"));
            }
            let rest = &body[end + 4..];
            body = format!("---\n{}\n---{}", lines.join("\n"), rest);
            std::fs::write(&path, body).map_err(|e| tool_err(format!("update header: {e}")))?;
        }
    }
    Ok(())
}

/// Result of the Email Agent dirty-check before an inbox wake.
pub struct SyncWakeContext {
    /// True when the full sync markdown was included (modified since last check).
    pub included_full_sync: bool,
    pub prompt_block: String,
}

/// Dirty-check protocol for Email Agent wake.
///
/// When `force_full` is true (e.g. brand-new Email Agent thread with no history),
/// always include the full sync file so the agent is not flying blind.
pub fn load_for_email_agent_wake(
    workspace_root: &Path,
    force_full: bool,
) -> Result<SyncWakeContext, String> {
    let _guard = SYNC_LOCK
        .lock()
        .map_err(|_| "correspondence sync lock poisoned".to_string())?;
    ensure_files_unlocked(workspace_root)?;

    let modified = read_ts_file(workspace_root, SYNC_MODIFIED);
    let checked = read_ts_file(workspace_root, SYNC_CHECKED);
    let dirty = match (&modified, &checked) {
        (None, _) | (_, None) => true,
        (Some(m), Some(c)) => m > c,
    };
    let need_reread = force_full || dirty;

    if !need_reread {
        return Ok(SyncWakeContext {
            included_full_sync: false,
            prompt_block: format!(
                "Correspondence sync dirty-check: UNCHANGED (modified={mod_ts}, checked={chk_ts}).\n\
                 Do NOT re-read {SYNC_FILE} — rely on your prior knowledge in this Email Agent thread.\n\
                 Proceed to process new mail; update the sync via the correspondence_sync tool after send/receive if needed.",
                mod_ts = modified.as_deref().unwrap_or("(none)"),
                chk_ts = checked.as_deref().unwrap_or("(none)"),
            ),
        });
    }

    let ts = now_ts();
    write_ts_file(workspace_root, SYNC_CHECKED, &ts).map_err(|e| e.to_string())?;
    if modified.is_none() {
        write_ts_file(workspace_root, SYNC_MODIFIED, &ts).map_err(|e| e.to_string())?;
    }

    let body = std::fs::read_to_string(path_in(workspace_root, SYNC_FILE))
        .map_err(|e| format!("read {SYNC_FILE}: {e}"))?;

    let reason = if force_full && !dirty {
        "forced full read (Email Agent thread has little/no prior context)"
    } else {
        "sync_modified newer than sync_checked"
    };

    Ok(SyncWakeContext {
        included_full_sync: true,
        prompt_block: format!(
            "Correspondence sync dirty-check: RE-READ REQUIRED ({reason}).\n\
             Full {SYNC_FILE} below — absorb this before handling mail, then update it via correspondence_sync after actions.\n\n\
             {body}"
        ),
    })
}

fn ensure_files_unlocked(workspace_root: &Path) -> Result<(), String> {
    let ts = now_ts();
    let sync_path = path_in(workspace_root, SYNC_FILE);
    if !sync_path.exists() {
        let body = INITIAL_SYNC.replace("PLACEHOLDER_TS", &ts);
        std::fs::write(&sync_path, body).map_err(|e| format!("write {SYNC_FILE}: {e}"))?;
    }
    if !path_in(workspace_root, SYNC_MODIFIED).exists() {
        write_ts_file(workspace_root, SYNC_MODIFIED, &ts).map_err(|e| e.to_string())?;
    }
    if !path_in(workspace_root, SYNC_CHECKED).exists() {
        write_ts_file(workspace_root, SYNC_CHECKED, &ts).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn is_protected_filename(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "correspondence_sync.md" | "sync_modified.txt" | "sync_checked.txt"
    )
}

/// True if `rel` resolves to a workspace-root correspondence-sync file (must use the tool).
///
/// Normalization matches `resolve_workspace_subpath`: empty / `.` segments are skipped, so
/// aliases like `.//correspondence_sync.md` and `correspondence_sync.md/` still match.
pub fn is_protected_rel(rel: &str) -> bool {
    let rel = rel.trim().replace('\\', "/");
    let mut segs: Vec<&str> = Vec::new();
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            // `..` is rejected by the workspace resolver; this is not the root sync file.
            return false;
        }
        segs.push(seg);
    }
    matches!(segs.as_slice(), [name] if is_protected_filename(name))
}

/// True if `path` is one of the three protected files at the workspace root.
pub fn is_protected_workspace_path(workspace_root: &Path, path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if !is_protected_filename(name) {
        return false;
    }
    path.parent() == Some(workspace_root)
}

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "correspondence_sync".into(),
            description: Some(
                "Update workspace/correspondence_sync.md with validated correspondence state \
                 (add/update contacts, pending actions, history). Prefer this over workspace_write_file \
                 for email relationship context. General agents use this to leave briefings/pending \
                 actions for the dedicated Email Agent; the Email Agent updates after send/receive."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": [
                            "add_correspondence",
                            "update_correspondence",
                            "add_pending_action",
                            "mark_action_complete",
                            "add_history_entry",
                            "add_anchor_ref",
                            "read"
                        ],
                        "description": "Sync mutation or read"
                    },
                    "contact_email": {
                        "type": "string",
                        "description": "Correspondent email (required for most operations)"
                    },
                    "display_name": { "type": "string" },
                    "thread_id": { "type": "string", "description": "Gmail thread id" },
                    "context_summary": { "type": "string" },
                    "tone_formality": {
                        "type": "string",
                        "enum": ["formal", "casual", "friendly", "professional"]
                    },
                    "status": {
                        "type": "string",
                        "enum": ["active", "pending", "awaiting_reply", "scheduled_followup", "archived"]
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["high", "medium", "low"]
                    },
                    "field_to_update": {
                        "type": "string",
                        "description": "For update_correspondence: context_summary | status | priority | thread_id | tone_formality | display_name"
                    },
                    "new_value": { "type": "string" },
                    "action_description": { "type": "string" },
                    "due_date": { "type": "string", "description": "YYYY-MM-DD" },
                    "added_by": { "type": "string", "description": "Agent/thread label" },
                    "action_index": {
                        "type": "integer",
                        "description": "1-based index among open (- [ ]) pending actions"
                    },
                    "direction": {
                        "type": "string",
                        "enum": ["Sent", "Received"]
                    },
                    "summary": { "type": "string" },
                    "anchor_ref": {
                        "type": "string",
                        "description": "anchor://UUID — brief description"
                    },
                    "date": { "type": "string", "description": "ISO date; defaults to today" }
                },
                "required": ["operation"]
            }),
        },
    ]
}

pub fn system_hint() -> &'static str {
    "\n\n**Email correspondence:** Long-lived agent-mailbox context lives in `correspondence_sync.md`. \
     Use **correspondence_sync** to read/update it (do not workspace_write that file). \
     The global Email Agent alone may `gmail_send` with `account=agent` and alone may use \
     `memory_search_all` (read-only recall across every companion's anchors). \
     Other threads: read mail, leave pending actions/briefings via correspondence_sync for the Email Agent."
}

fn arg_str(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn valid_email(s: &str) -> bool {
    let s = s.trim();
    s.contains('@') && s.len() >= 5 && !s.contains(' ')
}

fn normalize_email(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

fn section_header_re() -> Regex {
    Regex::new(r"(?m)^###\s+(\S+)\s+—\s+(.+)$").expect("regex")
}

fn find_section<'a>(body: &'a str, email: &str) -> Option<(usize, usize, &'a str)> {
    let re = section_header_re();
    let email = normalize_email(email);
    let mut matches: Vec<(usize, usize, &str)> = Vec::new();
    for cap in re.captures_iter(body) {
        let full = cap.get(0)?;
        let em = cap.get(1)?.as_str();
        if normalize_email(em) == email {
            matches.push((full.start(), full.end(), em));
        }
    }
    let (start, _hdr_end, _) = matches.first().copied()?;
    // Section ends at next ### or EOF
    let after = &body[start + 1..];
    let rel_end = after
        .find("\n### ")
        .map(|i| i + 1)
        .unwrap_or(after.len());
    let end = start + 1 + rel_end;
    // trim trailing whitespace boundary at next header
    let end = if end < body.len() && body[end..].starts_with("### ") {
        end
    } else {
        // also stop before ## Email Agent Operating
        if let Some(i) = body[start..].find("\n## Email Agent Operating") {
            start + i
        } else {
            end.min(body.len())
        }
    };
    Some((start, end, &body[start..end]))
}

fn replace_section(body: &str, email: &str, new_section: &str) -> Result<String, ProviderError> {
    if let Some((start, end, _)) = find_section(body, email) {
        let mut out = String::new();
        out.push_str(&body[..start]);
        out.push_str(new_section.trim_end());
        out.push_str("\n\n");
        out.push_str(body[end..].trim_start());
        Ok(out)
    } else {
        Err(tool_err(format!(
            "No correspondence entry for {email}. Use add_correspondence first."
        )))
    }
}

fn insert_new_section(body: &str, section: &str) -> String {
    const MARKER: &str = "## Active Correspondences";
    if let Some(idx) = body.find(MARKER) {
        let after_header = idx + MARKER.len();
        let rest = &body[after_header..];
        // Skip blank / placeholder line
        let mut insert_at = after_header;
        let trimmed = rest.trim_start();
        let skipped = rest.len() - trimmed.len();
        insert_at += skipped;
        if trimmed.starts_with("_(") {
            if let Some(nl) = trimmed.find('\n') {
                insert_at += nl + 1;
            } else {
                insert_at += trimmed.len();
            }
        }
        // If next is ## Email Agent, insert before it
        if let Some(rel) = body[insert_at..].find("\n## Email Agent Operating") {
            insert_at += rel + 1;
            let mut out = String::new();
            out.push_str(&body[..insert_at]);
            out.push_str(section.trim_end());
            out.push_str("\n\n");
            out.push_str(&body[insert_at..]);
            return out;
        }
        let mut out = String::new();
        out.push_str(&body[..insert_at]);
        out.push_str(section.trim_end());
        out.push_str("\n\n");
        out.push_str(&body[insert_at..]);
        out
    } else {
        format!("{}\n\n{section}\n", body.trim_end())
    }
}

fn build_new_entry(
    email: &str,
    display_name: &str,
    thread_id: &str,
    context: &str,
    tone: &str,
    status: &str,
    priority: &str,
) -> String {
    let ts = now_ts();
    let date = &ts[..10.min(ts.len())];
    let name = if display_name.is_empty() {
        email
    } else {
        display_name
    };
    let thread = if thread_id.is_empty() {
        "_(none)_"
    } else {
        thread_id
    };
    let ctx = if context.is_empty() {
        "_(add context)_"
    } else {
        context
    };
    format!(
        "### {email} — {name}\n\
         **Thread ID:** {thread}  \n\
         **Last Contact:** {ts}  \n\
         **Status:** {status}  \n\
         **Priority:** {priority}\n\n\
         **Context Summary:**  \n\
         {ctx}\n\n\
         **Pending Actions:**\n\
         - _(none)_\n\n\
         **Tone Preferences:**\n\
         - Formality: {tone}\n\
         - Known topics: \n\
         - Avoid: \n\n\
         **Memory Anchor References:**\n\
         - _(none)_\n\n\
         **Recent History:**\n\
         | Date | Direction | Summary |\n\
         |------|-----------|---------|\n\
         | {date} | Received | Entry created |\n"
    )
}

fn set_field_in_section(section: &str, field: &str, value: &str) -> Result<String, ProviderError> {
    let mut lines: Vec<String> = section.lines().map(|l| l.to_string()).collect();
    match field {
        "display_name" => {
            let re = section_header_re();
            if let Some(cap) = re.captures(section) {
                let email = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                lines[0] = format!("### {email} — {value}");
            }
        }
        "thread_id" => {
            replace_bold_line(&mut lines, "**Thread ID:**", value);
        }
        "status" => {
            let allowed = ["active", "pending", "awaiting_reply", "scheduled_followup", "archived"];
            if !allowed.contains(&value) {
                return Err(tool_err(format!(
                    "Invalid status '{value}'. Allowed: {}",
                    allowed.join(", ")
                )));
            }
            replace_bold_line(&mut lines, "**Status:**", value);
        }
        "priority" => {
            let allowed = ["high", "medium", "low"];
            if !allowed.contains(&value) {
                return Err(tool_err(format!(
                    "Invalid priority '{value}'. Allowed: {}",
                    allowed.join(", ")
                )));
            }
            replace_bold_line(&mut lines, "**Priority:**", value);
        }
        "tone_formality" => {
            let allowed = ["formal", "casual", "friendly", "professional"];
            if !allowed.contains(&value) {
                return Err(tool_err(format!(
                    "Invalid tone_formality '{value}'. Allowed: {}",
                    allowed.join(", ")
                )));
            }
            for line in &mut lines {
                if line.trim_start().starts_with("- Formality:") {
                    *line = format!("- Formality: {value}");
                    break;
                }
            }
        }
        "context_summary" => {
            let mut out = Vec::new();
            let mut i = 0;
            while i < lines.len() {
                out.push(lines[i].clone());
                if lines[i].starts_with("**Context Summary:**") {
                    i += 1;
                    // skip old summary until next ** section
                    while i < lines.len()
                        && !lines[i].starts_with("**")
                        && !lines[i].starts_with("###")
                    {
                        i += 1;
                    }
                    out.push(value.to_string());
                    out.push(String::new());
                    continue;
                }
                i += 1;
            }
            return Ok(out.join("\n"));
        }
        other => {
            return Err(tool_err(format!(
                "Unknown field_to_update '{other}'. Use context_summary, status, priority, thread_id, tone_formality, display_name."
            )));
        }
    }
    Ok(lines.join("\n"))
}

fn replace_bold_line(lines: &mut [String], prefix: &str, value: &str) {
    for line in lines.iter_mut() {
        if line.starts_with(prefix) {
            *line = format!("{prefix} {value}  ");
            return;
        }
    }
}

fn add_pending_action(section: &str, desc: &str, due: &str, added_by: &str) -> String {
    let mut lines: Vec<String> = section.lines().map(|l| l.to_string()).collect();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].starts_with("**Pending Actions:**") {
            i += 1;
            // remove placeholder
            if i < lines.len() && lines[i].contains("_(none)_") {
                lines.remove(i);
            }
            let due_bit = if due.is_empty() {
                String::new()
            } else {
                format!(" — Due: {due}")
            };
            let by = if added_by.is_empty() {
                "agent"
            } else {
                added_by
            };
            lines.insert(i, format!("- [ ] {desc}{due_bit} — Added by: {by}"));
            break;
        }
        i += 1;
    }
    lines.join("\n")
}

fn mark_action_complete(section: &str, index: usize) -> Result<String, ProviderError> {
    if index == 0 {
        return Err(tool_err("action_index is 1-based"));
    }
    let mut lines: Vec<String> = section.lines().map(|l| l.to_string()).collect();
    let mut open_idxs = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if t.starts_with("- [ ]") {
            open_idxs.push(i);
        }
    }
    let Some(&line_i) = open_idxs.get(index - 1) else {
        return Err(tool_err(format!(
            "No open pending action at index {index} ({} open)",
            open_idxs.len()
        )));
    };
    let date = now_ts();
    let date = &date[..10.min(date.len())];
    let old = lines[line_i].clone();
    let rest = old
        .trim_start()
        .trim_start_matches("- [ ]")
        .trim_start()
        .to_string();
    lines[line_i] = format!("- [x] {rest} — Completed: {date}");
    Ok(lines.join("\n"))
}

fn add_history(section: &str, direction: &str, summary: &str, date: &str) -> Result<String, ProviderError> {
    if direction != "Sent" && direction != "Received" {
        return Err(tool_err("direction must be Sent or Received"));
    }
    let d = if date.is_empty() {
        let ts = now_ts();
        ts[..10.min(ts.len())].to_string()
    } else {
        date.to_string()
    };
    let mut lines: Vec<String> = section.lines().map(|l| l.to_string()).collect();
    // Find table header separator then append
    let mut insert_at = None;
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("|------") {
            // append after last table row
            let mut j = i + 1;
            while j < lines.len() && lines[j].starts_with('|') {
                j += 1;
            }
            insert_at = Some(j);
            break;
        }
    }
    let Some(at) = insert_at else {
        return Err(tool_err("Recent History table not found in section"));
    };
    let safe_summary = summary.replace('|', "/");
    lines.insert(at, format!("| {d} | {direction} | {safe_summary} |"));
    // bump Last Contact
    let ts = now_ts();
    replace_bold_line(&mut lines, "**Last Contact:**", &ts);
    Ok(lines.join("\n"))
}

fn add_anchor(section: &str, anchor_ref: &str) -> String {
    let mut lines: Vec<String> = section.lines().map(|l| l.to_string()).collect();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].starts_with("**Memory Anchor References:**") {
            i += 1;
            if i < lines.len() && lines[i].contains("_(none)_") {
                lines.remove(i);
            }
            let line = if anchor_ref.starts_with("anchor://") || anchor_ref.starts_with("- ") {
                if anchor_ref.starts_with("- ") {
                    anchor_ref.to_string()
                } else {
                    format!("- {anchor_ref}")
                }
            } else {
                format!("- anchor://{anchor_ref}")
            };
            lines.insert(i, line);
            break;
        }
        i += 1;
    }
    lines.join("\n")
}

pub fn run_tool(
    workspace_root: &Path,
    arguments: &Value,
    actor: &str,
) -> Result<String, ProviderError> {
    let _guard = SYNC_LOCK
        .lock()
        .map_err(|_| tool_err("correspondence sync lock poisoned"))?;
    ensure_files_unlocked(workspace_root).map_err(tool_err)?;

    let op = arg_str(arguments, "operation");
    if op.is_empty() {
        return Err(tool_err("operation is required"));
    }

    let path = path_in(workspace_root, SYNC_FILE);
    let body = std::fs::read_to_string(&path).map_err(|e| tool_err(format!("read sync: {e}")))?;

    if op == "read" {
        let email = arg_str(arguments, "contact_email");
        if email.is_empty() {
            return Ok(body);
        }
        let Some((_, _, section)) = find_section(&body, &email) else {
            return Err(tool_err(format!("No entry for {email}")));
        };
        return Ok(section.to_string());
    }

    let email = normalize_email(&arg_str(arguments, "contact_email"));
    let actor = if actor.trim().is_empty() { "agent" } else { actor };

    let new_body = match op.as_str() {
        "add_correspondence" => {
            if !valid_email(&email) {
                return Err(tool_err("contact_email looks invalid"));
            }
            if find_section(&body, &email).is_some() {
                return Err(tool_err(format!(
                    "Correspondence for {email} already exists — use update_correspondence"
                )));
            }
            let tone = arg_str(arguments, "tone_formality");
            let tone = if tone.is_empty() {
                "professional".into()
            } else {
                tone
            };
            let allowed_tone = ["formal", "casual", "friendly", "professional"];
            if !allowed_tone.contains(&tone.as_str()) {
                return Err(tool_err("Invalid tone_formality"));
            }
            let status = {
                let s = arg_str(arguments, "status");
                if s.is_empty() {
                    "active".into()
                } else {
                    s
                }
            };
            let priority = {
                let s = arg_str(arguments, "priority");
                if s.is_empty() {
                    "medium".into()
                } else {
                    s
                }
            };
            let section = build_new_entry(
                &email,
                &arg_str(arguments, "display_name"),
                &arg_str(arguments, "thread_id"),
                &arg_str(arguments, "context_summary"),
                &tone,
                &status,
                &priority,
            );
            insert_new_section(&body, &section)
        }
        "update_correspondence" => {
            if email.is_empty() {
                return Err(tool_err("contact_email required"));
            }
            let field = arg_str(arguments, "field_to_update");
            let value = arg_str(arguments, "new_value");
            if field.is_empty() || value.is_empty() {
                return Err(tool_err("field_to_update and new_value required"));
            }
            let (_, _, section) = find_section(&body, &email).ok_or_else(|| {
                tool_err(format!("No correspondence entry for {email}"))
            })?;
            let updated = set_field_in_section(section, &field, &value)?;
            replace_section(&body, &email, &updated)?
        }
        "add_pending_action" => {
            if email.is_empty() {
                return Err(tool_err("contact_email required"));
            }
            let desc = arg_str(arguments, "action_description");
            if desc.is_empty() {
                return Err(tool_err("action_description required"));
            }
            let (_, _, section) = find_section(&body, &email).ok_or_else(|| {
                tool_err(format!("No correspondence entry for {email}"))
            })?;
            let added_by = {
                let a = arg_str(arguments, "added_by");
                if a.is_empty() {
                    actor.to_string()
                } else {
                    a
                }
            };
            let updated = add_pending_action(
                section,
                &desc,
                &arg_str(arguments, "due_date"),
                &added_by,
            );
            replace_section(&body, &email, &updated)?
        }
        "mark_action_complete" => {
            if email.is_empty() {
                return Err(tool_err("contact_email required"));
            }
            let idx = arguments
                .get("action_index")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            let (_, _, section) = find_section(&body, &email).ok_or_else(|| {
                tool_err(format!("No correspondence entry for {email}"))
            })?;
            let updated = mark_action_complete(section, idx)?;
            replace_section(&body, &email, &updated)?
        }
        "add_history_entry" => {
            if email.is_empty() {
                return Err(tool_err("contact_email required"));
            }
            let direction = arg_str(arguments, "direction");
            let summary = arg_str(arguments, "summary");
            if summary.is_empty() {
                return Err(tool_err("summary required"));
            }
            let (_, _, section) = find_section(&body, &email).ok_or_else(|| {
                tool_err(format!("No correspondence entry for {email}"))
            })?;
            let updated = add_history(section, &direction, &summary, &arg_str(arguments, "date"))?;
            replace_section(&body, &email, &updated)?
        }
        "add_anchor_ref" => {
            if email.is_empty() {
                return Err(tool_err("contact_email required"));
            }
            let href = arg_str(arguments, "anchor_ref");
            if href.is_empty() {
                return Err(tool_err("anchor_ref required"));
            }
            let (_, _, section) = find_section(&body, &email).ok_or_else(|| {
                tool_err(format!("No correspondence entry for {email}"))
            })?;
            let updated = add_anchor(section, &href);
            replace_section(&body, &email, &updated)?
        }
        other => {
            return Err(tool_err(format!("Unknown operation '{other}'")));
        }
    };

    std::fs::write(&path, &new_body).map_err(|e| tool_err(format!("write sync: {e}")))?;
    touch_modified(workspace_root, actor)?;
    Ok(format!("correspondence_sync: {op} ok for {email}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn add_and_pending_action() {
        let dir = std::env::temp_dir().join(format!("ps-corr-{}", uuid::Uuid::new_v4()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        ensure_files(&dir).unwrap();
        run_tool(
            &dir,
            &json!({
                "operation": "add_correspondence",
                "contact_email": "robin@example.com",
                "display_name": "Robin",
                "context_summary": "Collaborator on AI OS",
                "tone_formality": "casual"
            }),
            "test",
        )
        .unwrap();
        run_tool(
            &dir,
            &json!({
                "operation": "add_pending_action",
                "contact_email": "robin@example.com",
                "action_description": "Ask about encryption",
                "added_by": "general"
            }),
            "test",
        )
        .unwrap();
        let body = std::fs::read_to_string(dir.join(SYNC_FILE)).unwrap();
        assert!(body.contains("robin@example.com"));
        assert!(body.contains("Ask about encryption"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn protected_rel_matches_equivalent_workspace_paths() {
        for rel in [
            "correspondence_sync.md",
            "./correspondence_sync.md",
            ".//correspondence_sync.md",
            "correspondence_sync.md/",
            "correspondence_sync.md/.",
            "./correspondence_sync.md/",
            "CORRESPONDENCE_SYNC.MD",
            "sync_checked.txt",
            ".//sync_checked.txt",
            "sync_modified.txt/",
        ] {
            assert!(
                is_protected_rel(rel),
                "expected protected rel {rel:?}"
            );
        }
        for rel in [
            "notes/correspondence_sync.md",
            "other.md",
            "sync_checked.bak",
        ] {
            assert!(!is_protected_rel(rel), "expected unprotected rel {rel:?}");
        }
    }

    #[test]
    fn protected_workspace_path_is_root_file_only() {
        let root = std::path::PathBuf::from("/tmp/ps-workspace");
        assert!(is_protected_workspace_path(
            &root,
            &root.join("correspondence_sync.md")
        ));
        assert!(is_protected_workspace_path(
            &root,
            &root.join("sync_checked.txt")
        ));
        assert!(!is_protected_workspace_path(
            &root,
            &root.join("notes").join("correspondence_sync.md")
        ));
        assert!(!is_protected_workspace_path(&root, &root.join("notes.md")));
    }
}
