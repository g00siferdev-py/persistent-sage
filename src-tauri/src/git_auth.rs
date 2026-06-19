//! Ephemeral HTTPS git auth for coding mode (GitHub PAT via GIT_ASKPASS — never written to `.git/config`).

use std::path::Path;
use std::process::Command as StdCommand;

use crate::agent_tools::tool_err;
use crate::provider::ProviderError;
use crate::settings::{SettingsError, SettingsManager};

const PS_GIT_PAT_ENV: &str = "PS_GIT_PAT";

pub fn decrypt_github_pat(settings: &SettingsManager) -> Result<Option<String>, ProviderError> {
    settings
        .decrypt_api_key("github")
        .map_err(|e| tool_err(e.to_string()))
        .map(|opt| opt.filter(|s| !s.trim().is_empty()))
}

pub fn require_github_pat(settings: &SettingsManager) -> Result<String, ProviderError> {
    decrypt_github_pat(settings)?.ok_or_else(|| {
        tool_err(
            "GitHub PAT not configured. Save one in Settings → GitHub, or ask the agent to save it with coding_github_save_pat.",
        )
    })
}

fn askpass_script_path(data_dir: &Path) -> std::path::PathBuf {
    let name = if cfg!(windows) {
        "git_askpass.cmd"
    } else {
        "git_askpass.sh"
    };
    data_dir.join(".nova_crypto").join(name)
}

fn askpass_script_body() -> &'static str {
    if cfg!(windows) {
        r#"@echo off
setlocal
if /i "%~1" NEQ "" echo %~1 | findstr /i "username" >nul && (echo x-access-token& exit /b 0)
echo %PS_GIT_PAT%
"#
    } else {
        r#"#!/bin/sh
case "$1" in
  *[Uu]ser*|*[Uu]sername*) echo "x-access-token" ;;
  *) echo "$PS_GIT_PAT" ;;
esac
"#
    }
}

pub fn ensure_askpass_script(data_dir: &Path) -> Result<std::path::PathBuf, ProviderError> {
    let path = askpass_script_path(data_dir);
    if path.is_file() {
        return Ok(path);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| tool_err(format!("askpass dir: {e}")))?;
    }
    std::fs::write(&path, askpass_script_body())
        .map_err(|e| tool_err(format!("askpass write: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&path)
            .map_err(|e| tool_err(format!("askpass chmod: {e}")))?
            .permissions();
        perms.set_mode(0o700);
        std::fs::set_permissions(&path, perms)
            .map_err(|e| tool_err(format!("askpass chmod: {e}")))?;
    }
    Ok(path)
}

fn apply_git_auth_env(cmd: &mut impl GitAuthCommand, data_dir: &Path, pat: &str) -> Result<(), ProviderError> {
    let script = ensure_askpass_script(data_dir)?;
    cmd.set_env("GIT_TERMINAL_PROMPT", "0");
    cmd.set_env("GIT_ASKPASS_NO_TTY", "1");
    cmd.set_env(PS_GIT_PAT_ENV, pat);
    cmd.set_env("GIT_ASKPASS", script.as_os_str());
    Ok(())
}

trait GitAuthCommand {
    fn set_env<K, V>(&mut self, key: K, val: V)
    where
        K: AsRef<std::ffi::OsStr>,
        V: AsRef<std::ffi::OsStr>;
}

impl GitAuthCommand for StdCommand {
    fn set_env<K, V>(&mut self, key: K, val: V)
    where
        K: AsRef<std::ffi::OsStr>,
        V: AsRef<std::ffi::OsStr>,
    {
        self.env(key, val);
    }
}

impl GitAuthCommand for tokio::process::Command {
    fn set_env<K, V>(&mut self, key: K, val: V)
    where
        K: AsRef<std::ffi::OsStr>,
        V: AsRef<std::ffi::OsStr>,
    {
        self.env(key, val);
    }
}

pub fn apply_git_auth(cmd: &mut StdCommand, data_dir: &Path, pat: &str) -> Result<(), ProviderError> {
    apply_git_auth_env(cmd, data_dir, pat)
}

pub fn apply_git_auth_tokio(
    cmd: &mut tokio::process::Command,
    data_dir: &Path,
    pat: &str,
) -> Result<(), ProviderError> {
    apply_git_auth_env(cmd, data_dir, pat)
}

pub fn save_github_pat(settings: &SettingsManager, token: &str) -> Result<(), ProviderError> {
    settings
        .save_api_key("github", token)
        .map_err(|e| match e {
            SettingsError::InvalidKeySlot(s) => tool_err(format!("invalid key slot: {s}")),
            other => tool_err(other.to_string()),
        })
}

pub fn validate_https_git_url(url: &str) -> Result<(), ProviderError> {
    let u = url.trim();
    if u.is_empty() {
        return Err(tool_err("url is empty"));
    }
    if u.starts_with("git@") {
        return Err(tool_err(
            "SSH git URLs are not supported. Use HTTPS (https://github.com/owner/repo.git).",
        ));
    }
    let parsed = url::Url::parse(u).map_err(|_| tool_err("git URL must be a valid HTTPS URL"))?;
    if parsed.scheme() != "https" {
        return Err(tool_err("git URL must start with https://"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(tool_err("git URL must not include embedded credentials"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| tool_err("git URL must include a host"))?;
    if !host.eq_ignore_ascii_case("github.com") {
        return Err(tool_err(
            "GitHub PATs may only be used with https://github.com/ remotes",
        ));
    }
    if parsed.path().trim_matches('/').is_empty() {
        return Err(tool_err("git URL must include an owner/repo path"));
    }
    Ok(())
}

pub fn validate_git_remote_name(remote: &str) -> Result<(), ProviderError> {
    let r = remote.trim();
    if r.is_empty() {
        return Err(tool_err("remote name is required"));
    }
    if r.starts_with('-') {
        return Err(tool_err("remote name must not start with '-'"));
    }
    if r == "." || r == ".." {
        return Err(tool_err("remote name is invalid"));
    }
    if r.chars().any(|c| {
        c.is_ascii_whitespace()
            || c.is_ascii_control()
            || matches!(c, '/' | '\\' | ':' | '*' | '?' | '[' | ']')
    }) {
        return Err(tool_err(
            "remote must be a simple configured remote name (for example, origin)",
        ));
    }
    if !r
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(tool_err("remote name contains unsupported characters"));
    }
    Ok(())
}

pub fn validate_git_branch_name(branch: &str) -> Result<(), ProviderError> {
    let b = branch.trim();
    if b.is_empty() {
        return Err(tool_err("branch name is required"));
    }
    if b.eq_ignore_ascii_case("head") {
        return Err(tool_err("branch must be a branch name, not HEAD"));
    }
    if b.starts_with('-') || b.starts_with(':') || b.starts_with('/') {
        return Err(tool_err("branch name is invalid"));
    }
    if b.ends_with('/') || b.ends_with('.') || b.ends_with(".lock") {
        return Err(tool_err("branch name is invalid"));
    }
    if b.contains("..") || b.contains("//") || b.contains("@{") {
        return Err(tool_err("branch name is invalid"));
    }
    if b.chars().any(|c| {
        c.is_ascii_whitespace()
            || c.is_ascii_control()
            || matches!(c, '\\' | ':' | '~' | '^' | '?' | '*' | '[' | ']')
    }) {
        return Err(tool_err(
            "branch must be a simple branch name, not a refspec or option",
        ));
    }
    for part in b.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.starts_with('.') {
            return Err(tool_err("branch name is invalid"));
        }
    }
    Ok(())
}

pub fn reject_force_git_args(args: &[&str]) -> Result<(), ProviderError> {
    for a in args {
        let lower = a.to_ascii_lowercase();
        if lower.contains("--force") || lower == "-f" || lower.contains("force-with-lease") {
            return Err(tool_err(
                "force push is blocked. Remove --force / -f from the request.",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_github_https_urls_without_credentials() {
        assert!(validate_https_git_url("https://github.com/owner/repo.git").is_ok());
        assert!(validate_https_git_url("http://github.com/owner/repo.git").is_err());
        assert!(validate_https_git_url("https://evil.example/owner/repo.git").is_err());
        assert!(validate_https_git_url("https://token@github.com/owner/repo.git").is_err());
        assert!(validate_https_git_url("git@github.com:owner/repo.git").is_err());
    }

    #[test]
    fn validates_remote_names_as_plain_names() {
        assert!(validate_git_remote_name("origin").is_ok());
        assert!(validate_git_remote_name("upstream-1").is_ok());
        assert!(validate_git_remote_name("https://github.com/owner/repo.git").is_err());
        assert!(validate_git_remote_name("--mirror").is_err());
        assert!(validate_git_remote_name("origin main").is_err());
    }

    #[test]
    fn validates_branch_names_without_refspecs_or_options() {
        assert!(validate_git_branch_name("main").is_ok());
        assert!(validate_git_branch_name("feature/safe-name_1").is_ok());
        assert!(validate_git_branch_name(":main").is_err());
        assert!(validate_git_branch_name("--delete").is_err());
        assert!(validate_git_branch_name("main:main").is_err());
        assert!(validate_git_branch_name("HEAD").is_err());
    }
}
