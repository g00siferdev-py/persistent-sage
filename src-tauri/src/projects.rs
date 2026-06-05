//! Persistent Sage collaborative **projects**: living documents under `workspace/projects/`.
//!
//! Each project has metadata in `workspace/projects/_index.json` and a canonical
//! `document.md` file the agent can read/write via tools or conversation.

use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent_tools::{assert_path_in_workspace, resolve_workspace_subpath, tool_err};
use crate::provider::ProviderError;

pub const PROJECTS_DIR: &str = "projects";
const INDEX_REL: &str = "projects/_index.json";
const DOCUMENT_NAME: &str = "document.md";
const MAX_PROJECTS: usize = 64;
const MAX_DOC_BYTES: usize = 400_000;
const MAX_FORM_FIELDS: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub kind: String,
    pub doc_path: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_conversation_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIndex {
    #[serde(default)]
    projects: Vec<ProjectMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_project_id: Option<String>,
}

fn index_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(INDEX_REL)
}

fn slugify_id(raw: &str) -> Result<String, String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() {
        return Err("project id is required".into());
    }
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() || out.len() > 64 {
        return Err("project id must be 1–64 alphanumeric characters (dashes allowed)".into());
    }
    Ok(out)
}

fn load_index(workspace_root: &Path) -> Result<ProjectIndex, String> {
    let path = index_path(workspace_root);
    if !path.is_file() {
        return Ok(ProjectIndex::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_index(workspace_root: &Path, index: &ProjectIndex) -> Result<(), String> {
    let path = index_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn project_dir_rel(id: &str) -> String {
    format!("{PROJECTS_DIR}/{id}")
}

fn document_rel(id: &str) -> String {
    format!("{}/{}/{}", PROJECTS_DIR, id, DOCUMENT_NAME)
}

pub fn ensure_projects_tree(workspace_root: &Path) {
    let _ = std::fs::create_dir_all(workspace_root.join(PROJECTS_DIR));
}

/// Instructions for collaborative projects (Persistent Sage).
pub const PROJECT_SYSTEM_APPENDIX: &str = r#"

## Collaborative projects (Persistent Sage)

You can help the user with **ongoing work** (budgets, marketing plans, audits, etc.) using **projects** — not a single-purpose budget feature.

### Intake (always offer a choice when starting something new)
When the user asks for help with a plan, budget, report, or similar:
1. Briefly explain two paths: **(A)** they add files to the agent workspace (`workspace/`), or **(B)** you send a **`form` artifact** to collect details.
2. Ask which they prefer. If they already uploaded files, use `workspace_list_directory` / `workspace_read_file` first.

### Living documents
- Create a project with `project_create` (stable `id` slug, human `title`, optional `kind` like `budget` or `marketing`).
- Store the canonical report in the project file via `project_write` (default `document.md` under `projects/{id}/`).
- On revisions, **read** with `project_read` then **write** updated content — do not lose prior work.
- Set `activeProjectId` mentally: when the user says "update my budget", resolve the matching project id from `project_list`.

### Artifacts
- **`form`**: interactive intake or sectioned edits (`body.fields` with stable `id`s). User submits via the UI; you receive structured JSON.
- **`html` / `markdown`**: read-only or lightly editable views; prefer saving truth to `project_write` and mention the project id in `projectId` when applicable.
- After form submission messages, update the project document and reply with a summary + optional html/markdown artifact.

### Form artifact shape
```artifact
{
  "type": "form",
  "title": "Monthly budget intake",
  "projectId": "monthly-budget",
  "body": {
    "submitLabel": "optional custom button label",
    "fields": [
      { "id": "income", "label": "Monthly income (USD)", "kind": "number", "required": true },
      { "id": "notes", "label": "Notes", "kind": "textarea" }
    ]
  }
}
```
Field kinds: `text`, `textarea`, `number`, `checkbox`, `select`, `radio`.

For `select` / `radio`, `options` must be a **non-empty array** of either:
- plain strings: `["Paris", "London"]`, or
- objects: `[{"label": "Paris", "value": "paris"}, {"label": "London", "value": "london"}]`

For quizzes, use one `select` or `radio` field per question; put the **question** in `label` and **answer choices** in `options` (never empty objects).

### Cross-companion memory
- Project facts use global anchors prefixed `[project:<slug>]` (created automatically on `project_create` / `project_write`).
- Any companion can recall these via memory_search — they are not isolated per personality.
- When storing manual anchors about a project, prefix with `[project:<slug>]`.

### User form submissions
The user may submit forms silently (not shown in chat). You receive structured JSON starting with `[Persistent Sage form submission]`. Parse values, update the project via `project_write`, then reply with:
- A short plain-text summary (2–4 sentences max, no large tables).
- Exactly one **`html` artifact** for the main deliverable (clean sections, tables, simple CSS bars/charts — no scripts).

### Visual deliverables (default)
For budgets, plans, audits, and reports: **proactively** use a polished **`html` artifact** — do not rely on markdown tables in chat. Save source-of-truth markdown in `project_write` when helpful, but show the user the html artifact.

"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListView {
    pub projects: Vec<ProjectMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_project_id: Option<String>,
}

pub fn list_projects(workspace_root: &Path) -> Result<Vec<ProjectMeta>, String> {
    Ok(load_index(workspace_root)?.projects)
}

pub fn list_projects_view(workspace_root: &Path) -> Result<ProjectListView, String> {
    let index = load_index(workspace_root)?;
    Ok(ProjectListView {
        projects: index.projects,
        active_project_id: index.active_project_id,
    })
}

pub fn get_project(workspace_root: &Path, id: &str) -> Result<Option<ProjectMeta>, String> {
    let id = slugify_id(id)?;
    Ok(load_index(workspace_root)?
        .projects
        .into_iter()
        .find(|p| p.id == id))
}

pub fn set_active_project(workspace_root: &Path, id: Option<&str>) -> Result<(), String> {
    let mut index = load_index(workspace_root)?;
    index.active_project_id = id.map(slugify_id).transpose()?;
    save_index(workspace_root, &index)
}

pub fn create_project(
    workspace_root: &Path,
    id: &str,
    title: &str,
    kind: &str,
    conversation_id: Option<&str>,
    initial_document: Option<&str>,
) -> Result<ProjectMeta, String> {
    ensure_projects_tree(workspace_root);
    let id = slugify_id(id)?;
    let title = title.trim();
    if title.is_empty() {
        return Err("project title is required".into());
    }

    let mut index = load_index(workspace_root)?;
    if index.projects.iter().any(|p| p.id == id) {
        return Err(format!("project already exists: {id}"));
    }
    if index.projects.len() >= MAX_PROJECTS {
        return Err(format!("maximum {MAX_PROJECTS} projects reached"));
    }

    let now = Utc::now().to_rfc3339();
    let doc_path = document_rel(&id);
    let dir_rel = project_dir_rel(&id);
    let dir = resolve_workspace_subpath(workspace_root, &dir_rel)
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let default_doc = format!(
        "# {title}\n\n_Created {now}. Edit via chat or workspace files._\n"
    );
    let doc_body = initial_document.unwrap_or(default_doc.as_str());
    write_document(workspace_root, &id, doc_body)?;

    let meta = ProjectMeta {
        id: id.clone(),
        title: title.to_string(),
        kind: kind.trim().to_string(),
        doc_path: doc_path.clone(),
        created_at: now.clone(),
        updated_at: now,
        last_conversation_id: conversation_id.map(str::to_string),
    };

    index.projects.push(meta.clone());
    index.active_project_id = Some(id);
    save_index(workspace_root, &index)?;
    Ok(meta)
}

pub fn read_document(workspace_root: &Path, id: &str) -> Result<String, String> {
    let id = slugify_id(id)?;
    let rel = document_rel(&id);
    let path = resolve_workspace_subpath(workspace_root, &rel).map_err(|e| e.to_string())?;
    assert_path_in_workspace(workspace_root, &path).map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err(format!("project document not found: {id}"));
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_DOC_BYTES {
        return Err(format!("project document exceeds {MAX_DOC_BYTES} bytes"));
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn write_document(workspace_root: &Path, id: &str, content: &str) -> Result<(), String> {
    let id = slugify_id(id)?;
    if content.len() > MAX_DOC_BYTES {
        return Err(format!("document too large (max {MAX_DOC_BYTES} bytes)"));
    }
    let rel = document_rel(&id);
    let path = resolve_workspace_subpath(workspace_root, &rel).map_err(|e| e.to_string())?;
    assert_path_in_workspace(workspace_root, &path).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())?;

    let mut index = load_index(workspace_root)?;
    let now = Utc::now().to_rfc3339();
    if let Some(p) = index.projects.iter_mut().find(|p| p.id == id) {
        p.updated_at = now;
    }
    save_index(workspace_root, &index)
}

pub fn touch_conversation(workspace_root: &Path, id: &str, conversation_id: &str) -> Result<(), String> {
    let id = slugify_id(id)?;
    let mut index = load_index(workspace_root)?;
    if let Some(p) = index.projects.iter_mut().find(|p| p.id == id) {
        p.last_conversation_id = Some(conversation_id.to_string());
        p.updated_at = Utc::now().to_rfc3339();
        save_index(workspace_root, &index)?;
    }
    Ok(())
}

/// Format a user message the agent can parse after form submission.
pub fn format_form_submission_message(
    artifact_title: &str,
    project_id: Option<&str>,
    values: &Value,
) -> String {
    let pid = project_id
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\nprojectId: {s}"))
        .unwrap_or_default();
    let json = serde_json::to_string_pretty(values).unwrap_or_else(|_| "{}".into());
    format!(
        "[Persistent Sage form submission]\nartifactTitle: {artifact_title}{pid}\nvalues:\n{json}\n\n\
         Update the living project (project_read / project_write). Reply with a brief summary in plain text \
         and exactly one **html** artifact containing the full visual report (tables, sections, simple CSS). \
         Do not put large tables only in plain chat."
    )
}

pub fn project_tool_definitions() -> Vec<crate::provider::ToolDefinition> {
    use crate::provider::ToolDefinition;
    use serde_json::json;

    vec![
        ToolDefinition {
            name: "project_list".into(),
            description: Some(
                "List collaborative Persistent Sage projects (living documents under workspace/projects/).".into(),
            ),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "project_create".into(),
            description: Some(
                "Create a new project with a stable id slug, title, optional kind (budget, marketing, etc.), and optional initial markdown document.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Slug, e.g. monthly-budget" },
                    "title": { "type": "string" },
                    "kind": { "type": "string", "description": "Optional category label" },
                    "initialDocument": { "type": "string", "description": "Optional markdown body for document.md" }
                },
                "required": ["id", "title"]
            }),
        },
        ToolDefinition {
            name: "project_read".into(),
            description: Some("Read the canonical document.md for a project id.".into()),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }),
        },
        ToolDefinition {
            name: "project_write".into(),
            description: Some("Overwrite document.md for a project id with new markdown (or plain text).".into()),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["id", "content"]
            }),
        },
        ToolDefinition {
            name: "project_set_active".into(),
            description: Some("Set the user's active project id for follow-up turns (or null to clear).".into()),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Project slug or empty to clear" }
                }
            }),
        },
    ]
}

pub async fn run_project_tool(
    workspace_root: &Path,
    name: &str,
    arguments_json: &str,
    memory_tools: Option<(
        &crate::settings::SettingsManager,
        &dyn crate::memory::ConversationMemory,
    )>,
    conversation_id: Option<&str>,
) -> Result<String, ProviderError> {
    let v: Value = serde_json::from_str(arguments_json)
        .map_err(|e| tool_err(format!("bad tool JSON: {e}")))?;
    match name {
        "project_list" => {
            let list = list_projects(workspace_root).map_err(|e| tool_err(e))?;
            serde_json::to_string_pretty(&list).map_err(|e| tool_err(e.to_string()))
        }
        "project_create" => {
            let id = v["id"].as_str().unwrap_or("").trim();
            let title = v["title"].as_str().unwrap_or("").trim();
            let kind = v["kind"].as_str().unwrap_or("").trim();
            let initial = v.get("initialDocument").and_then(|x| x.as_str());
            let meta = create_project(
                workspace_root,
                id,
                title,
                kind,
                conversation_id,
                initial,
            )
            .map_err(|e| tool_err(e))?;
            if let Some((_, memory)) = memory_tools {
                let _ = memory.upsert_project_anchor(&meta.id, &meta.title);
            }
            Ok(format!("Created project `{}` at {}", meta.id, meta.doc_path))
        }
        "project_read" => {
            let id = v["id"].as_str().unwrap_or("").trim();
            read_document(workspace_root, id).map_err(|e| tool_err(e))
        }
        "project_write" => {
            let id = v["id"].as_str().unwrap_or("").trim();
            let content = v["content"].as_str().unwrap_or("");
            write_document(workspace_root, id, content).map_err(|e| tool_err(e))?;
            if let Some(cid) = conversation_id {
                let _ = touch_conversation(workspace_root, id, cid);
            }
            if let Some((_, memory)) = memory_tools {
                if let Ok(list) = list_projects(workspace_root) {
                    if let Some(p) = list.iter().find(|p| p.id == id) {
                        let _ = memory.upsert_project_anchor(&p.id, &p.title);
                    }
                }
            }
            Ok(format!("Updated project `{id}` document."))
        }
        "project_set_active" => {
            let id = v["id"].as_str().unwrap_or("").trim();
            if id.is_empty() {
                set_active_project(workspace_root, None).map_err(|e| tool_err(e))?;
                Ok("Cleared active project.".into())
            } else {
                set_active_project(workspace_root, Some(id)).map_err(|e| tool_err(e))?;
                Ok(format!("Active project set to `{id}`."))
            }
        }
        other => Err(tool_err(format!("unknown project tool: {other}"))),
    }
}

/// Validate form artifact `body` object.
pub fn validate_form_body(body: &Value) -> Result<(), String> {
    let fields = body
        .get("fields")
        .and_then(|f| f.as_array())
        .ok_or_else(|| "form artifact body must include a fields array".to_string())?;
    if fields.is_empty() {
        return Err("form must have at least one field".into());
    }
    if fields.len() > MAX_FORM_FIELDS {
        return Err(format!("form has too many fields (max {MAX_FORM_FIELDS})"));
    }
    for f in fields {
        let id = f
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim();
        if id.is_empty() {
            return Err("each form field needs a non-empty id".into());
        }
        let kind = f
            .get("kind")
            .and_then(|x| x.as_str())
            .unwrap_or("text")
            .trim()
            .to_ascii_lowercase();
        match kind.as_str() {
            "text" | "textarea" | "number" | "checkbox" | "select" | "radio" => {}
            other => return Err(format!("unsupported form field kind: {other}")),
        }
        if (kind == "select" || kind == "radio")
            && !f.get("options").and_then(|o| o.as_array()).is_some_and(|a| !a.is_empty())
        {
            return Err(format!("field `{id}` needs a non-empty options array"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn create_and_read_project() {
        let tmp = std::env::temp_dir().join(format!("opensage-proj-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let meta = create_project(&tmp, "test-budget", "Test Budget", "budget", None, None).unwrap();
        assert_eq!(meta.id, "test-budget");
        let doc = read_document(&tmp, "test-budget").unwrap();
        assert!(doc.contains("Test Budget"));
        let list = list_projects(&tmp).unwrap();
        assert_eq!(list.len(), 1);
        let _ = fs::remove_dir_all(&tmp);
    }
}
