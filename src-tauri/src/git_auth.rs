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

fn apply_git_auth_env(
    cmd: &mut impl GitAuthCommand,
    data_dir: &Path,
    pat: &str,
) -> Result<(), ProviderError> {
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

pub fn apply_git_auth(
    cmd: &mut StdCommand,
    data_dir: &Path,
    pat: &str,
) -> Result<(), ProviderError> {
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
    settings.save_api_key("github", token).map_err(|e| match e {
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
    if !(u.starts_with("https://") || u.starts_with("http://")) {
        return Err(tool_err("git URL must start with https://"));
    }
    Ok(())
}

/// Remote and branch arguments for `push` / `pull` / `fetch` must be plain names.
///
/// Git treats a leading `+` as a force refspec (`git push origin +main` rewrites
/// remote history) and a leading `-` as an option (`--mirror`, `--delete`, `--force`).
/// A URL in the remote slot is fetched or pushed with the saved GitHub token,
/// because askpass supplies that token for any credential prompt.
pub fn reject_force_git_args(args: &[&str]) -> Result<(), ProviderError> {
    for a in args.iter().skip(1) {
        if !is_plain_git_name(a) {
            return Err(tool_err(
                "remote and branch must be plain names such as origin and main. Force refspecs (+branch), git options (--force, --mirror, --delete), and URLs are blocked.",
            ));
        }
    }
    Ok(())
}

fn is_plain_git_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_alphanumeric() {
        return false;
    }
    if name.contains("..") || name.contains("//") || name.ends_with('/') || name.ends_with('.') {
        return false;
    }
    name.chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
}

#[cfg(test)]
mod tests {
    use super::reject_force_git_args;

    #[test]
    fn allows_plain_push() {
        assert!(reject_force_git_args(&["push", "origin"]).is_ok());
        assert!(reject_force_git_args(&["push", "origin", "main"]).is_ok());
        assert!(reject_force_git_args(&["push", "upstream", "feature/login"]).is_ok());
        assert!(reject_force_git_args(&["pull", "origin", "HEAD"]).is_ok());
        assert!(reject_force_git_args(&["push", "origin", "機能/修正"]).is_ok());
    }

    #[test]
    fn blocks_force_refspec_and_options_and_urls() {
        assert!(reject_force_git_args(&["push", "origin", "+main"]).is_err());
        assert!(reject_force_git_args(&["push", "origin", "+HEAD:main"]).is_err());
        assert!(reject_force_git_args(&["push", "--force"]).is_err());
        assert!(reject_force_git_args(&["push", "--mirror"]).is_err());
        assert!(reject_force_git_args(&["push", "origin", "--delete"]).is_err());
        assert!(reject_force_git_args(&["push", "origin", "main:release"]).is_err());
        assert!(reject_force_git_args(&["push", "https://evil.example/repo.git"]).is_err());
        assert!(reject_force_git_args(&["fetch", "--upload-pack=evil"]).is_err());
        assert!(reject_force_git_args(&["pull", "--rebase"]).is_err());
    }
}
