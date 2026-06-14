//! Agent tools for Persistent Sage **Coding mode** (v2): search, patch, shell, git — scoped to
//! `workspace/repos/{active}/`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use regex::RegexBuilder;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::agent_tools::{assert_path_in_workspace, resolve_workspace_subpath, tool_err};
use crate::coding::CodingTurnContext;
use crate::provider::{ProviderError, ToolDefinition};

const GREP_MAX_MATCHES: usize = 80;
const GREP_MAX_FILE_BYTES: u64 = 512_000;
const COMMAND_TIMEOUT_SECS: u64 = 120;
const COMMAND_TIMEOUT_MAX_SECS: u64 = 300;
const COMMAND_BUILD_TIMEOUT_DEFAULT_SECS: u64 = 900;
const COMMAND_BUILD_TIMEOUT_MAX_SECS: u64 = 1200;
const COMMAND_MAX_OUTPUT_CHARS: usize = 96_000;
const PATCH_MAX_FILE_BYTES: u64 = 900_000;

const SKIP_DIR_NAMES: &[&str] = &[
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

const ALLOWED_COMMAND_BASES: &[&str] = &[
    "git", "npm", "npx", "node", "cargo", "rustc", "python", "py", "pytest", "pip", "tsc",
    "eslint", "prettier", "make", "dotnet", "go", "javac", "java", "mvn", "gradle", "cmake",
    "vite", "vitest", "jest", "pnpm", "yarn", "bun", "deno", "rg", "grep", "find", "type",
    "cat", "dir", "echo", "where", "which", "cmd", "powershell", "pwsh", "ping", "timeout",
    "for",
];

const BLOCKED_COMMAND_PATTERNS: &[&str] = &[
    "rm -rf",
    "rm -fr",
    "del /s",
    "del /f",
    "format c:",
    "format d:",
    "mkfs",
    ":(){ :|:&",
    "remove-item",
    "rmdir /s",
    "shutdown",
    "reboot",
    "> /dev/",
    "curl |",
    "wget |",
    "invoke-webrequest",
    "downloadstring",
    "frombase64string",
    "invoke-expression",
    "iex(",
    " iex ",
];

pub fn search_and_patch_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "coding_grep".into(),
            description: Some(
                "Search for a regex pattern in the active coding repo. Paths in results are relative to the repo root.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex pattern to search for" },
                    "path": { "type": "string", "description": "Optional subdirectory within the repo (default: entire repo)" },
                    "glob": { "type": "string", "description": "Optional filename glob filter, e.g. *.rs or *.tsx" },
                    "case_insensitive": { "type": "boolean", "description": "Case insensitive search (default false)" }
                },
                "required": ["pattern"]
            }),
        },
        ToolDefinition {
            name: "coding_apply_patch".into(),
            description: Some(
                "Replace the first exact occurrence of old_string with new_string in a file (repo-relative path). Use for surgical edits.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to repo root, e.g. src/main.rs" },
                    "old_string": { "type": "string", "description": "Exact text to find (must appear once)" },
                    "new_string": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "old_string", "new_string"]
            }),
        },
    ]
}

pub fn run_command_tool_definition() -> ToolDefinition {
    ToolDefinition {
        name: "coding_run_command".into(),
        description: Some(
            "Run an allowlisted shell command in the active repo directory (npm, cargo, git, python, etc.). Returns stdout+stderr and elapsed_secs. On Windows the shell is cmd.exe — pass the inner command only (not `cmd /C ...`). For Tauri apps, use cwd `src-tauri` for cargo commands.".into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "Command to run, e.g. cargo test or npm run lint" },
                "cwd": { "type": "string", "description": "Optional subdirectory within the repo, e.g. src-tauri for Rust/Tauri backends" },
                "timeout_secs": { "type": "integer", "description": "Timeout in seconds (default 120, max 300; cargo/npm build commands default 900, max 1200)" }
            },
            "required": ["command"]
        }),
    }
}

pub fn git_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "coding_git_status".into(),
            description: Some("Git status for the active repo (porcelain + branch).".into()),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "coding_git_diff".into(),
            description: Some("Git diff for the active repo. Optionally scoped to a repo-relative path.".into()),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Optional repo-relative file or directory" },
                    "staged": { "type": "boolean", "description": "If true, diff staged changes (--cached)" }
                }
            }),
        },
        ToolDefinition {
            name: "coding_git_commit".into(),
            description: Some(
                "Stage all changes and create a local git commit in the active repo. Does not push.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "Commit message" }
                },
                "required": ["message"]
            }),
        },
    ]
}

pub fn git_remote_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "coding_git_push".into(),
            description: Some(
                "Push commits to the remote (HTTPS + saved GitHub PAT). Optional branch name; defaults to current branch.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "branch": { "type": "string", "description": "Optional branch to push" },
                    "remote": { "type": "string", "description": "Remote name (default origin)" }
                }
            }),
        },
        ToolDefinition {
            name: "coding_git_pull".into(),
            description: Some(
                "Pull from remote (HTTPS + saved GitHub PAT). Optional branch; defaults to current branch.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "branch": { "type": "string", "description": "Optional branch to pull" },
                    "remote": { "type": "string", "description": "Remote name (default origin)" }
                }
            }),
        },
        ToolDefinition {
            name: "coding_git_fetch".into(),
            description: Some("Fetch from remote (HTTPS + saved GitHub PAT).".into()),
            parameters: json!({
                "type": "object",
                "properties": {
                    "remote": { "type": "string", "description": "Remote name (default origin)" }
                }
            }),
        },
        ToolDefinition {
            name: "coding_git_clone".into(),
            description: Some(
                "Clone an HTTPS git repo into workspace/repos (requires saved GitHub PAT).".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "HTTPS clone URL, e.g. https://github.com/owner/repo.git" },
                    "name": { "type": "string", "description": "Optional folder name under workspace/repos" }
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "coding_github_save_pat".into(),
            description: Some(
                "Save a GitHub Personal Access Token (encrypted locally, like API keys). Use when the user pastes a token and asks to store it.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "token": { "type": "string", "description": "GitHub PAT (classic or fine-grained with repo scope)" }
                },
                "required": ["token"]
            }),
        },
    ]
}

pub fn repo_create_tool_definition() -> ToolDefinition {
    ToolDefinition {
        name: "coding_repo_create".into(),
        description: Some(
            "Create a new git repository under workspace/repos with a starter template. \
             Does not require GitHub — use for greenfield projects. Sets the new repo as active."
                .into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Project folder name (slugified under workspace/repos/)"
                },
                "template": {
                    "type": "string",
                    "description": "Starter template",
                    "enum": ["empty", "rust", "node", "python", "tauri", "csharp"]
                }
            },
            "required": ["name"]
        }),
    }
}

/// Workspace-relative path for the active repo, e.g. `repos/persistent-sage`.
pub fn repo_workspace_rel(ctx: &CodingTurnContext) -> &str {
    ctx.path_rel.as_str()
}

fn workspace_path_for_repo_file(
    workspace_root: &Path,
    ctx: &CodingTurnContext,
    repo_rel: &str,
) -> Result<PathBuf, ProviderError> {
    resolve_repo_file_path(workspace_root, ctx.path_rel.trim(), repo_rel)
}

/// Resolve a repo-relative file path under `workspace/repos/{repo}/`.
pub fn resolve_repo_file_path(
    workspace_root: &Path,
    repo_path_rel: &str,
    file_rel: &str,
) -> Result<PathBuf, ProviderError> {
    let rel = file_rel.trim().trim_start_matches('/');
    if rel.is_empty() {
        let path = resolve_workspace_subpath(workspace_root, repo_path_rel.trim())?;
        assert_path_in_workspace(workspace_root, &path)?;
        return Ok(path);
    }
    if rel.contains('\\') {
        return Err(tool_err("path must use forward slashes"));
    }
    if rel.split('/').any(|s| s == "..") {
        return Err(tool_err("path must not contain '..'"));
    }
    let ws_rel = format!("{}/{}", repo_path_rel.trim_end_matches('/'), rel);
    let path = resolve_workspace_subpath(workspace_root, &ws_rel)?;
    assert_path_in_workspace(workspace_root, &path)?;
    Ok(path)
}

const IDE_READ_MAX_BYTES: u64 = 512_000;
const IDE_WRITE_MAX_BYTES: usize = 900_000;

pub fn read_repo_file_for_ide(
    workspace_root: &Path,
    repo_path_rel: &str,
    file_rel: &str,
) -> Result<(String, u64), ProviderError> {
    let path = resolve_repo_file_path(workspace_root, repo_path_rel, file_rel)?;
    let meta = std::fs::metadata(&path).map_err(|e| tool_err(format!("read: {e}")))?;
    if !meta.is_file() {
        return Err(tool_err("path is not a file"));
    }
    if meta.len() > IDE_READ_MAX_BYTES {
        return Err(tool_err(format!(
            "file is {} bytes (max {IDE_READ_MAX_BYTES})",
            meta.len()
        )));
    }
    let bytes = std::fs::read(&path).map_err(|e| tool_err(format!("read: {e}")))?;
    let text = String::from_utf8(bytes).map_err(|_| tool_err("file is not valid UTF-8"))?;
    Ok((text, meta.len()))
}

pub fn write_repo_file_for_ide(
    workspace_root: &Path,
    repo_path_rel: &str,
    file_rel: &str,
    content: &str,
) -> Result<(), ProviderError> {
    if content.as_bytes().len() > IDE_WRITE_MAX_BYTES {
        return Err(tool_err(format!(
            "content exceeds {IDE_WRITE_MAX_BYTES} bytes"
        )));
    }
    let path = resolve_repo_file_path(workspace_root, repo_path_rel, file_rel)?;
    if let Some(parent) = path.parent() {
        assert_path_in_workspace(workspace_root, parent)?;
        std::fs::create_dir_all(parent).map_err(|e| tool_err(format!("mkdir: {e}")))?;
    }
    std::fs::write(&path, content).map_err(|e| tool_err(format!("write: {e}")))?;
    Ok(())
}

pub async fn run_shell_for_ide(
    repo_dir: &Path,
    command: &str,
    timeout_secs: Option<u64>,
) -> Result<String, ProviderError> {
    run_shell_in_repo(repo_dir, command, timeout_secs, None, "coding_run_command").await
}

fn command_base_token(command: &str) -> Option<String> {
    let trimmed = command.trim();
    let first = trimmed.split_whitespace().next()?;
    let name = Path::new(first)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(first);
    let lower = name.to_ascii_lowercase();
    Some(lower.trim_end_matches(".exe").trim_end_matches(".cmd").to_string())
}

fn normalized_command_tokens(command: &str) -> Vec<String> {
    command
        .split_whitespace()
        .map(|token| token.trim_matches(|c| c == '"' || c == '\'').to_ascii_lowercase())
        .collect()
}

fn reject_shell_control_syntax(command: &str) -> Result<(), ProviderError> {
    for c in [';', '|', '&', '`', '$', '>', '<', '\n', '\r'] {
        if command.contains(c) {
            return Err(tool_err(format!(
                "command blocked by safety policy: shell control character `{}`",
                c.escape_default()
            )));
        }
    }
    Ok(())
}

fn reject_interpreter_eval_flags(base: &str, command: &str) -> Result<(), ProviderError> {
    let tokens = normalized_command_tokens(command);
    let args = tokens.iter().skip(1).map(String::as_str);
    let blocked = match base {
        "python" | "py" => args.clone().any(|arg| matches!(arg, "-c" | "--command")),
        "node" | "deno" | "bun" => args.clone().any(|arg| matches!(arg, "-e" | "--eval" | "-p" | "--print")),
        "powershell" | "pwsh" => args.clone().any(|arg| {
            matches!(
                arg,
                "-command" | "-c" | "/command" | "/c" | "-encodedcommand" | "-enc" | "/enc"
            )
        }),
        _ => false,
    };
    if blocked {
        return Err(tool_err(format!(
            "command blocked by safety policy: `{base}` inline execution flags are not allowed"
        )));
    }
    Ok(())
}

fn normalize_shell_command(command: &str) -> String {
    let trimmed = command.trim();
    let lower = trimmed.to_ascii_lowercase();
    for prefix in ["cmd /c ", "cmd.exe /c "] {
        if lower.starts_with(prefix) {
            return trimmed[prefix.len()..].trim().to_string();
        }
    }
    trimmed.to_string()
}

fn validate_command(command: &str) -> Result<(), ProviderError> {
    let normalized = normalize_shell_command(command);
    reject_shell_control_syntax(&normalized)?;
    let cmd_lower = normalized.to_ascii_lowercase();
    for pat in BLOCKED_COMMAND_PATTERNS {
        if cmd_lower.contains(pat) {
            return Err(tool_err(format!("command blocked by safety policy: contains `{pat}`")));
        }
    }
    let base = command_base_token(&normalized)
        .ok_or_else(|| tool_err("command is empty"))?;
    if !ALLOWED_COMMAND_BASES.iter().any(|a| *a == base.as_str()) {
        return Err(tool_err(format!(
            "command not allowlisted (first token `{base}`). Allowed: {}",
            ALLOWED_COMMAND_BASES.join(", ")
        )));
    }
    reject_interpreter_eval_flags(&base, &normalized)?;
    Ok(())
}

async fn run_git(repo_dir: &Path, args: &[&str]) -> Result<String, ProviderError> {
    run_git_with_auth(repo_dir, args, None, None).await
}

async fn run_git_with_auth(
    repo_dir: &Path,
    args: &[&str],
    data_dir: Option<&Path>,
    pat: Option<&str>,
) -> Result<String, ProviderError> {
    validate_command(&format!("git {}", args.first().copied().unwrap_or("")))?;
    if !repo_dir.is_dir() {
        return Err(tool_err(format!("repo directory not found: {}", repo_dir.display())));
    }
    let mut cmd = Command::new("git");
    if let (Some(dir), Some(token)) = (data_dir, pat) {
        crate::git_auth::apply_git_auth_tokio(&mut cmd, dir, token)?;
    }
    cmd.args(args)
        .current_dir(repo_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let out = tokio::time::timeout(
        Duration::from_secs(COMMAND_TIMEOUT_SECS),
        cmd.output(),
    )
    .await
    .map_err(|_| tool_err(format!("git timed out after {COMMAND_TIMEOUT_SECS}s")))?
    .map_err(|e| tool_err(format!("git failed: {e}")))?;
    format_command_output(&out)
}

fn format_command_output(out: &std::process::Output) -> Result<String, ProviderError> {
    let mut text = String::new();
    if !out.stdout.is_empty() {
        text.push_str(&String::from_utf8_lossy(&out.stdout));
    }
    if !out.stderr.is_empty() {
        if !text.is_empty() {
            text.push_str("\n--- stderr ---\n");
        }
        text.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    let code = out.status.code().unwrap_or(-1);
    if text.chars().count() > COMMAND_MAX_OUTPUT_CHARS {
        text = text.chars().take(COMMAND_MAX_OUTPUT_CHARS).collect::<String>() + "\n… [truncated]";
    }
    Ok(format!("exit_code: {code}\n{text}"))
}

fn is_slow_build_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    [
        "cargo check",
        "cargo build",
        "cargo test",
        "cargo clippy",
        "npm run build",
        "pnpm run build",
        "yarn build",
        "npm install",
        "pnpm install",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn resolve_command_timeout(command: &str, requested: Option<u64>) -> u64 {
    let (default, max) = if is_slow_build_command(command) {
        (
            COMMAND_BUILD_TIMEOUT_DEFAULT_SECS,
            COMMAND_BUILD_TIMEOUT_MAX_SECS,
        )
    } else {
        (COMMAND_TIMEOUT_SECS, COMMAND_TIMEOUT_MAX_SECS)
    };
    // Models often pass 300 because that was the old hard cap — treat as "use build default".
    let effective = requested.filter(|&r| !is_slow_build_command(command) || r > COMMAND_TIMEOUT_MAX_SECS);
    effective.unwrap_or(default).clamp(5, max)
}

async fn read_stream_to_string(
    stream: impl tokio::io::AsyncRead + Unpin,
    stderr: bool,
    tool_stream: Option<(crate::tool_stream::ToolStreamEmitter, String)>,
) -> std::io::Result<String> {
    let mut buf = String::new();
    let mut lines = BufReader::new(stream).lines();
    while let Some(line) = lines.next_line().await? {
        let chunk = if stderr {
            format!("[stderr] {line}\n")
        } else {
            format!("{line}\n")
        };
        buf.push_str(&chunk);
        if let Some((ref ts, ref name)) = tool_stream {
            ts.output(name, &chunk);
        }
    }
    Ok(buf)
}

async fn run_shell_in_repo(
    repo_dir: &Path,
    command: &str,
    timeout_secs: Option<u64>,
    tool_stream: Option<&crate::tool_stream::ToolStreamEmitter>,
    tool_name: &str,
) -> Result<String, ProviderError> {
    validate_command(command)?;
    if !repo_dir.is_dir() {
        return Err(tool_err(format!("repo directory not found: {}", repo_dir.display())));
    }

    let shell_command = normalize_shell_command(command);
    let started = std::time::Instant::now();
    let timeout_secs = resolve_command_timeout(&shell_command, timeout_secs);
    let mut child = if cfg!(windows) {
        Command::new("cmd")
            .args(["/C", &shell_command])
            .current_dir(repo_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| tool_err(format!("spawn failed: {e}")))?
    } else {
        Command::new("sh")
            .args(["-c", &shell_command])
            .current_dir(repo_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| tool_err(format!("spawn failed: {e}")))?
    };

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| tool_err("stdout pipe unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| tool_err("stderr pipe unavailable"))?;

    let stream_ctx = tool_stream.map(|ts| (ts.clone(), tool_name.to_string()));
    let stream_out = stream_ctx.clone();
    let stream_err = stream_ctx;

    let io_result = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        async {
            let (stdout_text, stderr_text) = tokio::try_join!(
                read_stream_to_string(stdout, false, stream_out),
                read_stream_to_string(stderr, true, stream_err),
            )?;
            let status = child.wait().await?;
            Ok::<_, std::io::Error>((stdout_text, stderr_text, status))
        },
    )
    .await;

    match io_result {
        Ok(Ok((stdout_text, stderr_text, status))) => {
            let code = status.code().unwrap_or(-1);
            let mut text = String::new();
            if !stdout_text.is_empty() {
                text.push_str(&stdout_text);
            }
            if !stderr_text.is_empty() {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(&stderr_text);
            }
            if text.chars().count() > COMMAND_MAX_OUTPUT_CHARS {
                text = text.chars().take(COMMAND_MAX_OUTPUT_CHARS).collect::<String>()
                    + "\n… [output truncated]";
            }
            let elapsed = started.elapsed().as_secs_f64();
            Ok(format!("exit_code: {code}\nelapsed_secs: {elapsed:.2}\n{text}"))
        }
        Ok(Err(e)) => Err(tool_err(format!("command failed: {e}"))),
        Err(_) => {
            let _ = child.kill().await;
            Err(tool_err(format!(
                "command timed out after {timeout_secs}s"
            )))
        }
    }
}

fn glob_match(name: &str, glob: &str) -> bool {
    if glob == "*" || glob.is_empty() {
        return true;
    }
    if let Some(ext) = glob.strip_prefix('*') {
        return name.ends_with(ext);
    }
    name == glob
}

fn coding_grep(
    workspace_root: &Path,
    ctx: &CodingTurnContext,
    pattern: &str,
    subpath: Option<&str>,
    glob: Option<&str>,
    case_insensitive: bool,
) -> Result<String, ProviderError> {
    if pattern.trim().is_empty() {
        return Err(tool_err("pattern is empty"));
    }
    let re = RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|e| tool_err(format!("invalid regex: {e}")))?;

    let start = workspace_path_for_repo_file(
        workspace_root,
        ctx,
        subpath.unwrap_or(""),
    )?;
    if !start.is_dir() {
        return Err(tool_err("grep path must be a directory"));
    }

    let mut matches = Vec::new();
    grep_walk(
        workspace_root,
        ctx,
        &start,
        subpath.unwrap_or(""),
        glob,
        &re,
        &mut matches,
    )?;

    if matches.is_empty() {
        return Ok("No matches.".into());
    }
    Ok(matches.join("\n"))
}

fn grep_walk(
    workspace_root: &Path,
    ctx: &CodingTurnContext,
    dir: &Path,
    rel_prefix: &str,
    glob: Option<&str>,
    re: &regex::Regex,
    out: &mut Vec<String>,
) -> Result<(), ProviderError> {
    if out.len() >= GREP_MAX_MATCHES {
        return Ok(());
    }
    assert_path_in_workspace(workspace_root, dir)?;
    let entries = std::fs::read_dir(dir).map_err(|e| tool_err(format!("read_dir: {e}")))?;
    for entry in entries.flatten() {
        if out.len() >= GREP_MAX_MATCHES {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_tree_entry(&name) {
            continue;
        }
        let ft = entry.file_type().map_err(|e| tool_err(format!("file_type: {e}")))?;
        let child_rel = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{rel_prefix}/{name}")
        };
        if ft.is_dir() {
            grep_walk(workspace_root, ctx, &entry.path(), &child_rel, glob, re, out)?;
        } else if ft.is_file() {
            if let Some(g) = glob {
                if !glob_match(&name, g) {
                    continue;
                }
            }
            let meta = entry.metadata().map_err(|e| tool_err(format!("metadata: {e}")))?;
            if meta.len() > GREP_MAX_FILE_BYTES {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path()) else {
                continue;
            };
            for (i, line) in text.lines().enumerate() {
                if re.is_match(line) {
                    out.push(format!("{}:{}:{}", child_rel, i + 1, line.trim()));
                    if out.len() >= GREP_MAX_MATCHES {
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}

fn should_skip_tree_entry(name: &str) -> bool {
    (name.starts_with('.') && name != ".")
        || SKIP_DIR_NAMES.iter().any(|s| name.eq_ignore_ascii_case(s))
}

fn coding_apply_patch(
    workspace_root: &Path,
    ctx: &CodingTurnContext,
    path: &str,
    old_string: &str,
    new_string: &str,
) -> Result<String, ProviderError> {
    if old_string.is_empty() {
        return Err(tool_err("old_string must not be empty"));
    }
    let file = workspace_path_for_repo_file(workspace_root, ctx, path)?;
    if !file.is_file() {
        return Err(tool_err(format!("not a file: {path}")));
    }
    let meta = std::fs::metadata(&file).map_err(|e| tool_err(format!("stat: {e}")))?;
    if meta.len() > PATCH_MAX_FILE_BYTES {
        return Err(tool_err("file too large to patch"));
    }
    let content = std::fs::read_to_string(&file).map_err(|e| tool_err(format!("read: {e}")))?;
    let count = content.matches(old_string).count();
    if count == 0 {
        return Err(tool_err("old_string not found in file"));
    }
    if count > 1 {
        return Err(tool_err(format!(
            "old_string appears {count} times — provide more context for a unique match"
        )));
    }
    let updated = content.replacen(old_string, new_string, 1);
    std::fs::write(&file, &updated).map_err(|e| tool_err(format!("write: {e}")))?;
    Ok(format!("Patched `{path}` (1 replacement)."))
}

pub fn repo_layout_hints(workspace_root: &Path, ctx: &CodingTurnContext) -> String {
    let Ok(repo) = workspace_path_for_repo_file(workspace_root, ctx, "") else {
        return String::new();
    };
    let mut lines = vec!["## Repository layout hints".to_string()];
    if repo.join("package.json").is_file() {
        lines.push("- Root `package.json` — npm/pnpm scripts run from repo root.".into());
    }
    if repo.join("src-tauri").join("Cargo.toml").is_file() {
        lines.push(
            "- **Tauri monorepo**: Rust backend in `src-tauri/` (no root `Cargo.toml`). \
             Run `cargo check` / `cargo test` via coding_run_command with `cwd: \"src-tauri\"`."
                .into(),
        );
    }
    if repo.join("Cargo.toml").is_file() {
        lines.push("- Root `Cargo.toml` — run `cargo` from repo root.".into());
    }
    lines.push(
        "- Use coding_run_command for build/check requests; do not infer stack from package.json alone."
            .into(),
    );
    lines.join("\n")
}

pub async fn run_coding_tool(
    workspace_root: &Path,
    ctx: &CodingTurnContext,
    name: &str,
    arguments_json: &str,
    tool_stream: Option<&crate::tool_stream::ToolStreamEmitter>,
    settings: Option<&crate::settings::SettingsManager>,
    data_directory: &Path,
) -> Result<String, ProviderError> {
    let v: Value = serde_json::from_str(arguments_json)
        .map_err(|e| tool_err(format!("bad tool JSON: {e}")))?;

    if name == "coding_repo_create" {
        let project_name = v["name"].as_str().unwrap_or("").trim();
        if project_name.is_empty() {
            return Err(tool_err("name is required"));
        }
        let template = v["template"].as_str().map(str::trim).filter(|s| !s.is_empty());
        let meta = crate::repos::create_repository(workspace_root, project_name, template)
            .map_err(tool_err)?;
        let template_label = template.unwrap_or("empty");
        return Ok(format!(
            "Created repo `{project_name}` with template `{template_label}` at `{}` (id: {}). It is now the active repo.",
            meta.path_rel, meta.id
        ));
    }

    let repo_dir = workspace_path_for_repo_file(workspace_root, ctx, "")?;

    match name {
        "coding_grep" => {
            let pattern = v["pattern"].as_str().unwrap_or("").trim();
            let sub = v["path"].as_str().map(str::trim);
            let glob = v["glob"].as_str().map(str::trim);
            let ci = v["case_insensitive"].as_bool().unwrap_or(false);
            coding_grep(workspace_root, ctx, pattern, sub, glob, ci)
        }
        "coding_apply_patch" => {
            let path = v["path"].as_str().unwrap_or("").trim();
            let old = v["old_string"].as_str().unwrap_or("");
            let new = v["new_string"].as_str().unwrap_or("");
            coding_apply_patch(workspace_root, ctx, path, old, new)
        }
        "coding_run_command" => {
            let cmd = v["command"].as_str().unwrap_or("").trim();
            let timeout = v["timeout_secs"].as_u64();
            let cwd = v["cwd"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let work_dir = if let Some(sub) = cwd {
                let path = workspace_path_for_repo_file(workspace_root, ctx, sub)?;
                if !path.is_dir() {
                    return Err(tool_err(format!(
                        "cwd `{sub}` is not a directory in this repo (looked for {})",
                        path.display()
                    )));
                }
                path
            } else {
                repo_dir
            };
            run_shell_in_repo(&work_dir, cmd, timeout, tool_stream, name).await
        }
        "coding_git_status" => run_git(&repo_dir, &["status", "--porcelain=v1", "-b"]).await,
        "coding_git_diff" => {
            let staged = v["staged"].as_bool().unwrap_or(false);
            let path = v["path"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let mut args: Vec<String> = vec!["diff".into()];
            if staged {
                args.push("--cached".into());
            }
            if let Some(p) = path {
                args.push(p.to_string());
            }
            let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
            run_git(&repo_dir, &arg_refs).await
        }
        "coding_git_commit" => {
            let msg = v["message"].as_str().unwrap_or("").trim();
            if msg.is_empty() {
                return Err(tool_err("commit message is required"));
            }
            run_git(&repo_dir, &["add", "-A"]).await?;
            run_git(&repo_dir, &["commit", "-m", msg]).await
        }
        "coding_git_push" => {
            let settings = settings.ok_or_else(|| tool_err("git remote tools unavailable"))?;
            let pat = crate::git_auth::require_github_pat(settings)?;
            let remote = v["remote"].as_str().unwrap_or("origin").trim();
            let branch = v["branch"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let mut args = vec!["push", remote];
            if let Some(b) = branch {
                args.push(b);
            }
            crate::git_auth::reject_force_git_args(&args)?;
            run_git_with_auth(&repo_dir, &args, Some(data_directory), Some(&pat)).await
        }
        "coding_git_pull" => {
            let settings = settings.ok_or_else(|| tool_err("git remote tools unavailable"))?;
            let pat = crate::git_auth::require_github_pat(settings)?;
            let remote = v["remote"].as_str().unwrap_or("origin").trim();
            let branch = v["branch"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let mut args = vec!["pull", remote];
            if let Some(b) = branch {
                args.push(b);
            }
            run_git_with_auth(&repo_dir, &args, Some(data_directory), Some(&pat)).await
        }
        "coding_git_fetch" => {
            let settings = settings.ok_or_else(|| tool_err("git remote tools unavailable"))?;
            let pat = crate::git_auth::require_github_pat(settings)?;
            let remote = v["remote"].as_str().unwrap_or("origin").trim();
            run_git_with_auth(
                &repo_dir,
                &["fetch", remote],
                Some(data_directory),
                Some(&pat),
            )
            .await
        }
        "coding_git_clone" => {
            let settings = settings.ok_or_else(|| tool_err("git remote tools unavailable"))?;
            let url = v["url"].as_str().unwrap_or("").trim();
            let name = v["name"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let meta = crate::repos::clone_repository(
                workspace_root,
                data_directory,
                settings,
                url,
                name,
            )
            .await
            .map_err(tool_err)?;
            Ok(format!(
                "Cloned `{}` into `{}` (id: {}).",
                url, meta.path_rel, meta.id
            ))
        }
        "coding_github_save_pat" => {
            let settings = settings.ok_or_else(|| tool_err("settings unavailable"))?;
            let token = v["token"].as_str().unwrap_or("").trim();
            if token.is_empty() {
                return Err(tool_err("token is required"));
            }
            crate::git_auth::save_github_pat(settings, token)?;
            Ok("GitHub PAT saved (encrypted locally).".into())
        }
        _ => Err(tool_err(format!("unknown coding tool: {name}"))),
    }
}

pub fn is_coding_tool_name(name: &str) -> bool {
    matches!(
        name,
        "coding_grep"
            | "coding_apply_patch"
            | "coding_run_command"
            | "coding_git_status"
            | "coding_git_diff"
            | "coding_git_commit"
            | "coding_git_push"
            | "coding_git_pull"
            | "coding_git_fetch"
            | "coding_git_clone"
            | "coding_github_save_pat"
            | "coding_repo_create"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_blocks_rm_rf() {
        assert!(validate_command("rm -rf /").is_err());
    }

    #[test]
    fn validate_allows_cargo() {
        assert!(validate_command("cargo test").is_ok());
    }

    #[test]
    fn validate_blocks_shell_control_syntax() {
        assert!(validate_command("echo ok; rm -rf /").is_err());
        assert!(validate_command("echo $(curl https://example.invalid/x)").is_err());
        assert!(validate_command("cmd /C echo ok && del /s important").is_err());
    }

    #[test]
    fn validate_blocks_interpreter_inline_execution() {
        assert!(validate_command("python -c \"print('owned')\"").is_err());
        assert!(validate_command("node --eval \"console.log('owned')\"").is_err());
        assert!(validate_command("pwsh -EncodedCommand AAAA").is_err());
    }
}
