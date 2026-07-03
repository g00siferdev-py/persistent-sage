//! Persistent coding-mode notepad files under `{data_dir}/coding-notes/`.

use std::path::{Path, PathBuf};

const DEFAULT_NOTE: &str = "Notes.txt";
const MAX_NOTE_BYTES: usize = 512_000;

fn notes_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("coding-notes")
}

fn sanitize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("note name is required".into());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("invalid note name".into());
    }
    let base = trimmed.strip_suffix(".txt").unwrap_or(trimmed);
    if base.is_empty() || !base.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ') {
        return Err("note name may only contain letters, numbers, spaces, hyphens, and underscores".into());
    }
    Ok(format!("{base}.txt"))
}

fn ensure_default(data_dir: &Path) -> Result<(), String> {
    let dir = notes_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let default_path = dir.join(DEFAULT_NOTE);
    if !default_path.is_file() {
        std::fs::write(&default_path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingNoteMeta {
    pub name: String,
    pub updated_at: i64,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn coding_notes_list(state: tauri::State<'_, crate::NovaState>) -> Result<Vec<CodingNoteMeta>, String> {
    list_notes(state.data_directory.as_path())
}

#[tauri::command]
pub fn coding_notes_read(
    name: Option<String>,
    state: tauri::State<'_, crate::NovaState>,
) -> Result<String, String> {
    read_note(state.data_directory.as_path(), name)
}

#[tauri::command]
pub fn coding_notes_write(
    name: Option<String>,
    content: String,
    state: tauri::State<'_, crate::NovaState>,
) -> Result<(), String> {
    if content.len() > MAX_NOTE_BYTES {
        return Err("note content is too large".into());
    }
    let data_dir = state.data_directory.as_path();
    ensure_default(data_dir)?;
    let file_name = name
        .as_deref()
        .map(sanitize_name)
        .transpose()?
        .unwrap_or_else(|| DEFAULT_NOTE.to_string());
    let path = notes_dir(data_dir).join(&file_name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn coding_notes_create(name: String, state: tauri::State<'_, crate::NovaState>) -> Result<String, String> {
    let data_dir = state.data_directory.as_path();
    ensure_default(data_dir)?;
    let file_name = sanitize_name(&name)?;
    let path = notes_dir(data_dir).join(&file_name);
    if path.exists() {
        return Err(format!("note already exists: {file_name}"));
    }
    std::fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok(file_name)
}

#[tauri::command]
pub fn coding_notes_delete(name: String, state: tauri::State<'_, crate::NovaState>) -> Result<(), String> {
    let file_name = sanitize_name(&name)?;
    if file_name == DEFAULT_NOTE {
        return Err("cannot delete the default Notes.txt — clear its contents instead".into());
    }
    let path = notes_dir(state.data_directory.as_path()).join(&file_name);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn notes_dir_for_agent(data_dir: &Path) -> PathBuf {
    notes_dir(data_dir)
}

pub fn list_notes(data_dir: &Path) -> Result<Vec<CodingNoteMeta>, String> {
    ensure_default(data_dir)?;
    let dir = notes_dir(data_dir);
    let mut items = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("txt") {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let updated_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        items.push(CodingNoteMeta {
            name,
            updated_at,
            size_bytes: meta.len(),
        });
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

pub fn read_note(data_dir: &Path, name: Option<String>) -> Result<String, String> {
    ensure_default(data_dir)?;
    let file_name = name
        .as_deref()
        .map(sanitize_name)
        .transpose()?
        .unwrap_or_else(|| DEFAULT_NOTE.to_string());
    let path = notes_dir(data_dir).join(&file_name);
    if !path.is_file() {
        return Ok(String::new());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_NOTE_BYTES {
        return Err("note file is too large".into());
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
