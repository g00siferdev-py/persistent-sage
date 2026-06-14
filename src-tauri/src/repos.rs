//! Coding-mode git repositories under `workspace/repos/`.
//!
//! v2 foundation: directory tree, index file, and list command for the Coding layout.
//! Folders dropped or cloned into `workspace/repos/` are discovered on each list sync.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::agent_tools::{assert_path_in_workspace, resolve_workspace_subpath};
use crate::provider::ProviderError;
use crate::settings::SettingsManager;

pub const REPOS_DIR: &str = "repos";
const INDEX_REL: &str = "repos/_index.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoMeta {
    pub id: String,
    pub name: String,
    /// Path relative to workspace root, e.g. `repos/persistent-sage`.
    pub path_rel: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoIndex {
    #[serde(default)]
    repos: Vec<RepoMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_repo_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoListView {
    pub repos: Vec<RepoMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_repo_id: Option<String>,
    /// Absolute path to `workspace/repos/` for UI display.
    pub repos_directory: String,
}

fn index_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(INDEX_REL)
}

fn load_index(workspace_root: &Path) -> Result<RepoIndex, String> {
    let path = index_path(workspace_root);
    if !path.is_file() {
        return Ok(RepoIndex::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_index(workspace_root: &Path, index: &RepoIndex) -> Result<(), String> {
    let path = index_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn slugify_id(raw: &str) -> Result<String, String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() {
        return Err("repo id is required".into());
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
        return Err("repo id must be 1–64 alphanumeric characters (dashes allowed)".into());
    }
    Ok(out)
}

fn unique_repo_id(base: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(base) {
        return base.to_string();
    }
    for n in 2..1000 {
        let candidate = format!("{base}-{n}");
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    format!("{base}-{}", Utc::now().timestamp())
}

fn repo_path_rel(folder_name: &str) -> String {
    format!("{REPOS_DIR}/{folder_name}")
}

fn resolve_repo_path(workspace_root: &Path, path_rel: &str) -> PathBuf {
    let mut out = workspace_root.to_path_buf();
    for seg in path_rel.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        out.push(seg);
    }
    out
}

fn is_git_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

fn read_git_origin_url(repo_dir: &Path) -> Option<String> {
    let config_path = repo_dir.join(".git/config");
    let raw = std::fs::read_to_string(config_path).ok()?;
    let mut in_origin = false;
    for line in raw.lines() {
        let line = line.trim();
        if line == r#"[remote "origin"]"# {
            in_origin = true;
            continue;
        }
        if in_origin && line.starts_with('[') {
            break;
        }
        if in_origin && line.starts_with("url") {
            return line.split('=').nth(1).map(|s| s.trim().to_string());
        }
    }
    None
}

/// Scan `workspace/repos/` for git directories and merge into `_index.json`.
fn sync_repos_from_disk(workspace_root: &Path) -> Result<RepoIndex, String> {
    let repos_dir = workspace_root.join(REPOS_DIR);
    std::fs::create_dir_all(&repos_dir).map_err(|e| e.to_string())?;

    let mut index = load_index(workspace_root)?;

    index.repos.retain(|meta| {
        let p = resolve_repo_path(workspace_root, &meta.path_rel);
        p.is_dir() && is_git_repo(&p)
    });

    if let Some(active) = index.active_repo_id.clone() {
        if !index.repos.iter().any(|r| r.id == active) {
            index.active_repo_id = None;
        }
    }

    let known_paths: HashSet<String> = index.repos.iter().map(|r| r.path_rel.clone()).collect();
    let mut taken_ids: HashSet<String> = index.repos.iter().map(|r| r.id.clone()).collect();

    let entries = std::fs::read_dir(&repos_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let folder_name = entry.file_name();
        let folder_str = folder_name.to_string_lossy();
        if folder_str.starts_with('.') || folder_str.starts_with('_') {
            continue;
        }
        let repo_dir = entry.path();
        if !is_git_repo(&repo_dir) {
            continue;
        }
        let path_rel = repo_path_rel(&folder_str);
        if known_paths.contains(&path_rel) {
            continue;
        }
        let base_id = slugify_id(&folder_str)?;
        let id = unique_repo_id(&base_id, &taken_ids);
        taken_ids.insert(id.clone());
        let now = Utc::now().to_rfc3339();
        index.repos.push(RepoMeta {
            id,
            name: folder_str.to_string(),
            path_rel,
            remote_url: read_git_origin_url(&repo_dir),
            created_at: now.clone(),
            updated_at: now,
        });
    }

    index.repos.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));

    if index.active_repo_id.is_none() && index.repos.len() == 1 {
        index.active_repo_id = Some(index.repos[0].id.clone());
    }

    save_index(workspace_root, &index)?;
    Ok(index)
}

/// Ensure `workspace/repos/` and an empty index exist at startup.
pub fn ensure_repos_tree(workspace_root: &Path) {
    let repos_dir = workspace_root.join(REPOS_DIR);
    if let Err(e) = std::fs::create_dir_all(&repos_dir) {
        eprintln!(
            "persistent-sage: warning: could not create coding repos directory {}: {e}",
            repos_dir.display()
        );
        return;
    }
    let index = index_path(workspace_root);
    if !index.is_file() {
        if let Err(e) = save_index(workspace_root, &RepoIndex::default()) {
            eprintln!(
                "persistent-sage: warning: could not write repos index {}: {e}",
                index.display()
            );
        }
    }
    if let Err(e) = sync_repos_from_disk(workspace_root) {
        eprintln!("persistent-sage: warning: could not sync coding repos index: {e}");
    }
}

pub fn list_repos_view(workspace_root: &Path) -> Result<RepoListView, String> {
    let index = sync_repos_from_disk(workspace_root)?;
    let repos_dir = workspace_root.join(REPOS_DIR);
    Ok(RepoListView {
        repos: index.repos,
        active_repo_id: index.active_repo_id,
        repos_directory: repos_dir.to_string_lossy().into_owned(),
    })
}

pub fn set_active_repo(workspace_root: &Path, repo_id: Option<&str>) -> Result<RepoListView, String> {
    let mut index = sync_repos_from_disk(workspace_root)?;
    match repo_id {
        None => index.active_repo_id = None,
        Some(id) => {
            let id = id.trim();
            if id.is_empty() {
                index.active_repo_id = None;
            } else if !index.repos.iter().any(|r| r.id == id) {
                return Err(format!("repo not found: {id}"));
            } else {
                index.active_repo_id = Some(id.to_string());
            }
        }
    }
    save_index(workspace_root, &index)?;
    list_repos_view(workspace_root)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoTreeNode {
    pub name: String,
    pub path_rel: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<RepoTreeNode>,
}

const SKIP_TREE_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".turbo",
    "coverage",
];
const MAX_TREE_DEPTH: usize = 4;
const MAX_TREE_NODES: usize = 400;

fn should_skip_tree_entry(name: &str) -> bool {
    name.starts_with('.') && name != "."
        || SKIP_TREE_NAMES.iter().any(|s| name.eq_ignore_ascii_case(s))
}

fn build_repo_tree(
    workspace_root: &Path,
    dir: &Path,
    path_rel: &str,
    depth: usize,
    budget: &mut usize,
) -> Result<Vec<RepoTreeNode>, String> {
    if depth >= MAX_TREE_DEPTH || *budget == 0 {
        return Ok(Vec::new());
    }
    assert_path_in_workspace(workspace_root, dir).map_err(|e| e.to_string())?;
    let mut nodes = Vec::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if *budget == 0 {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_tree_entry(&name) {
            continue;
        }
        let child_rel = if path_rel.is_empty() {
            name.clone()
        } else {
            format!("{path_rel}/{name}")
        };
        let full = resolve_workspace_subpath(workspace_root, &child_rel)
            .map_err(|e: ProviderError| e.to_string())?;
        assert_path_in_workspace(workspace_root, &full).map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            *budget -= 1;
            let children = build_repo_tree(workspace_root, &full, &child_rel, depth + 1, budget)?;
            nodes.push(RepoTreeNode {
                name,
                path_rel: child_rel,
                kind: "directory".into(),
                children,
            });
        } else if ft.is_file() {
            *budget -= 1;
            nodes.push(RepoTreeNode {
                name,
                path_rel: child_rel,
                kind: "file".into(),
                children: Vec::new(),
            });
        }
    }
    Ok(nodes)
}

pub fn repo_file_tree(workspace_root: &Path, repo_path_rel: &str) -> Result<Vec<RepoTreeNode>, String> {
    let rel = repo_path_rel.trim();
    if rel.is_empty() {
        return Err("repo path is empty".into());
    }
    let root = resolve_workspace_subpath(workspace_root, rel)
        .map_err(|e: ProviderError| e.to_string())?;
    assert_path_in_workspace(workspace_root, &root).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err(format!("repo path is not a directory: {rel}"));
    }
    let mut budget = MAX_TREE_NODES;
    build_repo_tree(workspace_root, &root, rel, 0, &mut budget)
}

/// Resolve a registered repo by id (syncs disk → index first).
pub fn get_repo_meta(workspace_root: &Path, repo_id: &str) -> Result<RepoMeta, String> {
    let id = repo_id.trim();
    if id.is_empty() {
        return Err("repo id is empty".into());
    }
    let index = sync_repos_from_disk(workspace_root)?;
    repo_by_id(&index, id)
        .cloned()
        .ok_or_else(|| format!("repo not found: {id}"))
}

fn repo_by_id<'a>(index: &'a RepoIndex, repo_id: &str) -> Option<&'a RepoMeta> {
    index.repos.iter().find(|r| r.id == repo_id)
}

pub fn repo_name_from_clone_url(url: &str) -> Result<String, String> {
    let url = url.trim().trim_end_matches('/');
    let segment = url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches(".git");
    slugify_id(segment)
}

/// Clone an HTTPS git repo into `workspace/repos/` using the encrypted GitHub PAT.
pub async fn clone_repository(
    workspace_root: &Path,
    data_dir: &Path,
    settings: &SettingsManager,
    url: &str,
    name_hint: Option<&str>,
) -> Result<RepoMeta, String> {
    crate::git_auth::validate_https_git_url(url).map_err(|e| e.to_string())?;
    let pat = crate::git_auth::require_github_pat(settings).map_err(|e| e.to_string())?;
    ensure_repos_tree(workspace_root);
    let index = sync_repos_from_disk(workspace_root)?;
    let base = match name_hint.map(str::trim).filter(|s| !s.is_empty()) {
        Some(h) => slugify_id(h)?,
        None => repo_name_from_clone_url(url)?,
    };
    let taken: HashSet<String> = index.repos.iter().map(|r| r.id.clone()).collect();
    let id = unique_repo_id(&base, &taken);
    let repos_dir = workspace_root.join(REPOS_DIR);
    let dest = repos_dir.join(&id);
    if dest.exists() {
        return Err(format!("destination already exists: repos/{id}"));
    }

    let mut cmd = Command::new("git");
    cmd.args(["clone", url.trim(), &id])
        .current_dir(&repos_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    crate::git_auth::apply_git_auth_tokio(&mut cmd, data_dir, &pat).map_err(|e| e.to_string())?;

    let out = tokio::time::timeout(Duration::from_secs(900), cmd.output())
        .await
        .map_err(|_| "git clone timed out after 900s".to_string())?
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(format!(
            "git clone failed (exit {}): {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    set_active_repo(workspace_root, Some(&id))?;
    get_repo_meta(workspace_root, &id)
}

fn run_git_init(repo_dir: &Path) -> Result<(), String> {
    let out = std::process::Command::new("git")
        .args(["init"])
        .current_dir(repo_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("git init failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git init failed (exit {}): {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

fn basic_gitignore() -> &'static str {
    "# Persistent Sage\n.DS_Store\nThumbs.db\n*.log\n.env\n.env.*\n!.env.example\n"
}

/// Supported starter templates for [`create_repository`].
pub const REPO_TEMPLATES: &[&str] = &["empty", "rust", "node", "python", "tauri", "csharp"];

pub fn normalize_repo_template(template: Option<&str>) -> Result<&'static str, String> {
    match template.unwrap_or("empty").trim().to_ascii_lowercase().as_str() {
        "" | "empty" => Ok("empty"),
        "rust" | "rs" => Ok("rust"),
        "node" | "javascript" | "js" | "typescript" | "ts" => Ok("node"),
        "python" | "py" => Ok("python"),
        "tauri" => Ok("tauri"),
        "csharp" | "c#" | "cs" | "dotnet" => Ok("csharp"),
        other => Err(format!(
            "unknown template `{other}` — use one of: {}",
            REPO_TEMPLATES.join(", ")
        )),
    }
}

fn run_command_in_dir(dir: &Path, program: &str, args: &[&str], hint: &str) -> Result<(), String> {
    let out = std::process::Command::new(program)
        .args(args)
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("{hint}: failed to start `{program}`: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "{hint} failed (exit {}): {}",
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

fn npm_program() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn python_module_name(id: &str) -> String {
    let mut out = String::new();
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(if ch == '-' { '_' } else { ch });
        } else if ch == '-' || ch == '_' {
            if !out.ends_with('_') {
                out.push('_');
            }
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() || out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("app_{out}")
    } else {
        out
    }
}

fn apply_python_template(dest: &Path, id: &str, readme: &str) -> Result<(), String> {
    let module = python_module_name(id);
    let pyproject = format!(
        r#"[project]
name = "{id}"
version = "0.1.0"
description = "Python project created with Persistent Sage"
requires-python = ">=3.10"

[project.scripts]
{module} = "{module}.main:main"
"#
    );
    std::fs::write(dest.join("pyproject.toml"), pyproject).map_err(|e| e.to_string())?;
    std::fs::write(
        dest.join("requirements.txt"),
        "# Add runtime dependencies here, e.g. fastapi>=0.100\n",
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(dest.join("README.md"), readme).map_err(|e| e.to_string())?;
    let src = dest.join(&module);
    std::fs::create_dir_all(&src).map_err(|e| e.to_string())?;
    std::fs::write(src.join("__init__.py"), "").map_err(|e| e.to_string())?;
    std::fs::write(
        src.join("main.py"),
        format!(
            r#"def main() -> None:
    print("Hello from {id}")


if __name__ == "__main__":
    main()
"#
        ),
    )
    .map_err(|e| e.to_string())?;
    let mut gitignore = basic_gitignore().to_string();
    gitignore.push_str("__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.pytest_cache/\n.mypy_cache/\n.ruff_cache/\n");
    std::fs::write(dest.join(".gitignore"), gitignore).map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_csharp_template(dest: &Path, id: &str) -> Result<(), String> {
    run_command_in_dir(
        dest,
        "dotnet",
        &["new", "console", "--name", id, "-o", ".", "--force"],
        "dotnet new console (is the .NET SDK installed?)",
    )
}

fn apply_tauri_template(dest: &Path) -> Result<(), String> {
    run_command_in_dir(
        dest,
        npm_program(),
        &[
            "create",
            "tauri-app@latest",
            ".",
            "--",
            "--template",
            "vanilla-ts",
            "--manager",
            "npm",
            "--yes",
        ],
        "npm create tauri-app (is Node.js/npm installed? This may take several minutes)",
    )
}

fn apply_repo_template(dest: &Path, id: &str, template: &str) -> Result<(), String> {
    let template = normalize_repo_template(Some(template))?;
    let title = id.replace('-', " ");
    let readme = format!(
        "# {title}\n\nCreated with Persistent Sage coding mode.\n"
    );
    match template {
        "rust" => {
            run_command_in_dir(
                dest,
                "cargo",
                &["init", "--name", id, "--vcs", "none"],
                "cargo init (is Rust installed?)",
            )?;
            std::fs::write(dest.join("README.md"), readme).map_err(|e| e.to_string())?;
        }
        "node" => {
            let pkg = serde_json::json!({
                "name": id,
                "version": "0.1.0",
                "private": true,
                "description": format!("{title} — Persistent Sage project"),
            });
            std::fs::write(
                dest.join("package.json"),
                serde_json::to_string_pretty(&pkg).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            std::fs::write(dest.join("README.md"), readme).map_err(|e| e.to_string())?;
            let mut gitignore = basic_gitignore().to_string();
            gitignore.push_str("node_modules/\ndist/\nbuild/\n");
            std::fs::write(dest.join(".gitignore"), gitignore).map_err(|e| e.to_string())?;
        }
        "python" => apply_python_template(dest, id, &readme)?,
        "csharp" => apply_csharp_template(dest, id)?,
        "tauri" => apply_tauri_template(dest)?,
        _ => {
            std::fs::write(dest.join("README.md"), readme).map_err(|e| e.to_string())?;
            std::fs::write(dest.join(".gitignore"), basic_gitignore()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Create a new git repo under `workspace/repos/` with an optional starter template.
pub fn create_repository(
    workspace_root: &Path,
    name: &str,
    template: Option<&str>,
) -> Result<RepoMeta, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("project name is required".into());
    }
    ensure_repos_tree(workspace_root);
    let index = sync_repos_from_disk(workspace_root)?;
    let base = slugify_id(name)?;
    let taken: HashSet<String> = index.repos.iter().map(|r| r.id.clone()).collect();
    let id = unique_repo_id(&base, &taken);
    let repos_dir = workspace_root.join(REPOS_DIR);
    let dest = repos_dir.join(&id);
    if dest.exists() {
        return Err(format!("destination already exists: repos/{id}"));
    }

    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let template_key = normalize_repo_template(template)?;
    if let Err(e) = apply_repo_template(&dest, &id, template_key) {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(e);
    }
    if !is_git_repo(&dest) {
        if let Err(e) = run_git_init(&dest) {
            let _ = std::fs::remove_dir_all(&dest);
            return Err(e);
        }
    }

    set_active_repo(workspace_root, Some(&id))?;
    get_repo_meta(workspace_root, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn tmp_workspace() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("repos-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn sync_discovers_dropped_git_folder() {
        let workspace = tmp_workspace();
        std::fs::create_dir_all(&workspace).unwrap();
        ensure_repos_tree(&workspace);
        let repo_dir = workspace.join("repos/my-app");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::create_dir_all(repo_dir.join(".git")).unwrap();
        std::fs::write(
            repo_dir.join(".git/config"),
            r#"[remote "origin"]
	url = https://github.com/example/my-app.git
"#,
        )
        .unwrap();

        let view = list_repos_view(&workspace).unwrap();
        assert_eq!(view.repos.len(), 1);
        assert_eq!(view.repos[0].name, "my-app");
        assert_eq!(
            view.repos[0].remote_url.as_deref(),
            Some("https://github.com/example/my-app.git")
        );
        assert_eq!(view.active_repo_id.as_deref(), Some("my-app"));
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn create_empty_repository() {
        let workspace = tmp_workspace();
        std::fs::create_dir_all(&workspace).unwrap();
        ensure_repos_tree(&workspace);
        let meta = create_repository(&workspace, "my-new-app", Some("empty")).unwrap();
        assert_eq!(meta.id, "my-new-app");
        let repo_dir = workspace.join("repos/my-new-app");
        assert!(repo_dir.join(".git").exists());
        assert!(repo_dir.join("README.md").is_file());
        assert!(repo_dir.join(".gitignore").is_file());
        let view = list_repos_view(&workspace).unwrap();
        assert_eq!(view.active_repo_id.as_deref(), Some("my-new-app"));
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn normalize_repo_template_aliases() {
        assert_eq!(normalize_repo_template(Some("py")).unwrap(), "python");
        assert_eq!(normalize_repo_template(Some("dotnet")).unwrap(), "csharp");
        assert_eq!(normalize_repo_template(Some("ts")).unwrap(), "node");
        assert!(normalize_repo_template(Some("java")).is_err());
    }

    #[test]
    fn create_python_repository() {
        let workspace = tmp_workspace();
        std::fs::create_dir_all(&workspace).unwrap();
        ensure_repos_tree(&workspace);
        let meta = create_repository(&workspace, "py-demo", Some("python")).unwrap();
        assert_eq!(meta.id, "py-demo");
        let repo_dir = workspace.join("repos/py-demo");
        assert!(repo_dir.join("pyproject.toml").is_file());
        assert!(repo_dir.join("requirements.txt").is_file());
        assert!(repo_dir.join("py_demo/main.py").is_file());
        assert!(repo_dir.join(".git").exists());
        let _ = std::fs::remove_dir_all(&workspace);
    }
}
