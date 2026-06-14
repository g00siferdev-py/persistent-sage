//! Coding-mode IDE IPC: read/write repo files and run allowlisted shell from the UI.

use std::path::Path;

use serde::Serialize;

use crate::agent_tools::resolve_workspace_subpath;
use crate::coding_tools::{read_repo_file_for_ide, run_shell_for_ide, write_repo_file_for_ide};
use crate::provider::ProviderError;
use crate::repos;
use crate::settings::SettingsManager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingFileView {
    pub path_rel: String,
    pub content: String,
    pub size_bytes: u64,
    pub language: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingShellResult {
    pub output: String,
    pub elapsed_secs: f64,
}

pub fn infer_language(path_rel: &str) -> &'static str {
    let name = path_rel.rsplit('/').next().unwrap_or(path_rel).to_ascii_lowercase();
    let ext = name.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" | "pyi" => "python",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "cs" => "csharp",
        "cpp" | "cc" | "cxx" | "hpp" | "h" => "cpp",
        "c" => "c",
        "sql" => "sql",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" | "markdown" => "markdown",
        "html" | "htm" => "html",
        "css" | "scss" => "css",
        "sh" | "bash" | "zsh" => "shell",
        "ps1" => "powershell",
        "xml" => "xml",
        "swift" => "swift",
        "rb" => "ruby",
        "php" => "php",
        "lua" => "lua",
        "dart" => "dart",
        "vue" | "svelte" => "markup",
        _ if name == "dockerfile" => "docker",
        _ if name == "makefile" || name.starts_with("makefile.") => "makefile",
        _ => "plaintext",
    }
}

fn map_err(e: ProviderError) -> String {
    e.to_string()
}

pub fn read_file(
    workspace_root: &Path,
    repo_id: &str,
    file_rel: &str,
) -> Result<CodingFileView, String> {
    let meta = repos::get_repo_meta(workspace_root, repo_id)?;
    let path_rel = file_rel.trim().trim_start_matches('/');
    if path_rel.is_empty() {
        return Err("file path is required".into());
    }
    let (content, size_bytes) =
        read_repo_file_for_ide(workspace_root, &meta.path_rel, path_rel).map_err(map_err)?;
    Ok(CodingFileView {
        path_rel: path_rel.to_string(),
        content,
        size_bytes,
        language: infer_language(path_rel).to_string(),
    })
}

pub fn write_file(
    workspace_root: &Path,
    repo_id: &str,
    file_rel: &str,
    content: &str,
) -> Result<(), String> {
    let meta = repos::get_repo_meta(workspace_root, repo_id)?;
    let path_rel = file_rel.trim().trim_start_matches('/');
    if path_rel.is_empty() {
        return Err("file path is required".into());
    }
    write_repo_file_for_ide(workspace_root, &meta.path_rel, path_rel, content).map_err(map_err)
}

pub async fn run_shell(
    workspace_root: &Path,
    settings: &SettingsManager,
    repo_id: &str,
    command: &str,
    cwd: Option<&str>,
) -> Result<CodingShellResult, String> {
    if !settings.agent_coding_shell_enabled() {
        return Err(
            "Shell is disabled. Enable Run Command in Settings → Tools → Coding mode (v2)."
                .into(),
        );
    }
    let meta = repos::get_repo_meta(workspace_root, repo_id)?;
    let repo_dir = resolve_workspace_subpath(workspace_root, &meta.path_rel).map_err(map_err)?;
    let work_dir = if let Some(sub) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
        crate::coding_tools::resolve_repo_file_path(workspace_root, &meta.path_rel, sub)
            .map_err(map_err)?
    } else {
        repo_dir
    };
    if !work_dir.is_dir() {
        return Err(format!("working directory not found: {}", work_dir.display()));
    }
    let started = std::time::Instant::now();
    let output = run_shell_for_ide(&work_dir, command.trim(), None)
        .await
        .map_err(map_err)?;
    Ok(CodingShellResult {
        output,
        elapsed_secs: started.elapsed().as_secs_f64(),
    })
}
