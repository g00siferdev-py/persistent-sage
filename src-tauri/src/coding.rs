//! Coding-mode system prompt and turn context (Persistent Sage v2).

/// Fixed personality scope for coding threads in SQLite (not a companion profile).
pub const CODING_PERSONALITY_ID: &str = "__coding__";

pub const APP_MODE_COMPANION: &str = "companion";
pub const APP_MODE_CODING: &str = "coding";

/// Active repository context injected into coding chat turns.
#[derive(Clone, Debug)]
pub struct CodingTurnContext {
    pub repo_id: String,
    pub repo_name: String,
    pub path_rel: String,
}

pub const CODING_SYSTEM_APPENDIX: &str = r#"

## Coding mode (Persistent Sage v2)

You are the **coding agent** for Persistent Sage. The user is working on a software project stored under the app workspace.

### Scope
- Work **only** inside the active repository path given in this session (under `workspace/repos/`).
- Prefer **minimal, correct changes** — read before editing, explain what you changed.
- When workspace tools are enabled, use `workspace_read_file`, `workspace_write_file`, and `workspace_list_directory` with paths **relative to the workspace root** (e.g. `repos/my-app/src/main.rs`).

### Workflow
1. Understand the request and inspect relevant files before editing.
2. Make focused changes; avoid drive-by refactors.
3. If you cannot run shell or git tools yet, say so and describe the commands the user should run.

### Shell commands
- **Always use `coding_run_command`** when the user asks to run checks — do not guess from `package.json` alone.
- **Never claim a command ran, its exit code, or how long it took** unless you called `coding_run_command` and read `elapsed_secs` from the tool result.
- On Windows, commands run via `cmd.exe /C` automatically — pass the **inner** command only (e.g. `timeout /t 15 /nobreak`, not `cmd /C timeout ...`).
- **Tauri monorepos** (React at root + Rust in `src-tauri/`): there is often **no** root `Cargo.toml`. Run Rust commands with `cwd: "src-tauri"` (e.g. `cargo check`, `cargo test`). Run `npm run build` from repo root (`cwd` omitted).
- First `cargo check` on a large project can take **10–20 minutes** (cold compile). The shell tool allows up to 1200s for cargo/npm build commands.
- Repo-relative paths for grep/patch; workspace-relative paths for `workspace_*` file tools.

### Tools (when enabled in Settings → Tools → Coding)
- `coding_grep` — regex search across the repo
- `coding_apply_patch` — surgical search/replace in a file (repo-relative path)
- `coding_run_command` — allowlisted shell commands in the repo directory
- `coding_git_status`, `coding_git_diff`, `coding_git_commit` — local git operations (commit does not push)
- `workspace_read_file`, `workspace_write_file`, `workspace_list_directory` — use **workspace-relative** paths (e.g. `repos/my-app/src/main.rs`)

### Safety
- Do not exfiltrate secrets from `.env`, keys, or credentials files.
- Ask before destructive git operations (reset, force push, mass delete).
"#;

/// User explicitly asked to run a shell command (parsed from the message text).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRunCommand {
    pub cwd: Option<String>,
    pub command: String,
}

const COMMAND_LINE_PREFIXES: &[&str] = &[
    "timeout", "cargo", "npm", "pnpm", "yarn", "git", "node", "echo", "for", "ping",
    "python", "pytest", "make", "dotnet", "go", "rustc", "tsc", "vitest", "jest",
];

/// When the user clearly wants a shell command executed, parse cwd + command so the backend
/// can run it directly (models often skip `coding_run_command` and hallucinate output).
pub fn parse_direct_run_command(text: &str) -> Option<ParsedRunCommand> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    let wants_run = lower.contains("coding_run_command")
        || lower.contains("to run:")
        || lower.contains("run command")
        || lower.contains("run this command")
        || lower.contains("run the command")
        || lower.contains("run `")
        || lower.contains("run '")
        || lower.starts_with("run ");
    if !wants_run {
        return None;
    }

    let cwd = extract_cwd(t, &lower);
    if let Some(pos) = lower.find("to run:") {
        let after = t[pos + "to run:".len()..].trim();
        if let Some(cmd) = first_command_line(after) {
            return Some(ParsedRunCommand { cwd, command: cmd });
        }
    }

    if let Some(cmd) = t
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .rev()
        .find(|line| looks_like_shell_command(line))
    {
        return Some(ParsedRunCommand {
            cwd,
            command: cmd.to_string(),
        });
    }

    None
}

fn extract_cwd(text: &str, lower: &str) -> Option<String> {
    for needle in ["cwd `", "cwd '", "cwd \"", "cwd:", "cwd "] {
        let Some(pos) = lower.find(needle) else {
            continue;
        };
        let rest = text[pos + needle.len()..].trim();
        let end = rest
            .find(['\n', '\r'])
            .unwrap_or(rest.len());
        let mut c = rest[..end].trim().trim_matches(['`', '\'', '"']).to_string();
        if let Some(pos) = c.to_ascii_lowercase().find(" to run:") {
            c.truncate(pos);
            c = c.trim().to_string();
        }
        if !c.is_empty() {
            return Some(c);
        }
    }
    None
}

fn first_command_line(block: &str) -> Option<String> {
    block
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && looks_like_shell_command(l))
        .map(str::to_string)
}

fn looks_like_shell_command(line: &str) -> bool {
    let first = line.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
    let base = first
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd");
    COMMAND_LINE_PREFIXES.iter().any(|p| base == *p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_explicit_coding_run_command() {
        let msg = "Use coding_run_command with cwd src-tauri to run:\ntimeout /t 15 /nobreak";
        let p = parse_direct_run_command(msg).expect("parse");
        assert_eq!(p.cwd.as_deref(), Some("src-tauri"));
        assert_eq!(p.command, "timeout /t 15 /nobreak");
    }

    #[test]
    fn parse_cargo_check_request() {
        let msg = "Please run cargo check in src-tauri";
        assert!(parse_direct_run_command(msg).is_none());
    }
}
