//! Native in-app code playground: run ad-hoc Python, Node.js, and shell snippets
//! in a temp sandbox outside the active repo so scratch files never leak into a project.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use which::which;

/// Playground run request from the frontend.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundRunRequest {
    pub language: String,
    pub code: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub stdin: String,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    #[serde(default)]
    pub allow_network: bool,
}

fn default_timeout_secs() -> u64 {
    30
}

/// Result returned to the frontend.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundRunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub elapsed_secs: f64,
    pub temp_file_path: Option<String>,
    pub error: Option<String>,
    pub network_allowed: bool,
    pub sandbox_applied: bool,
    pub telemetry_log_path: Option<String>,
}

/// Telemetry record written for every playground run.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundTelemetryRecord {
    pub timestamp_utc: String,
    pub language: String,
    pub network_allowed: bool,
    pub timeout_secs: u64,
    pub exit_code: Option<i32>,
    pub elapsed_secs: f64,
    pub stdout_chars: usize,
    pub stderr_chars: usize,
    pub error: Option<String>,
}

fn sanitize_filename(input: &str) -> String {
    input
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(32)
        .collect::<String>()
}

fn extension_for_language(language: &str) -> &'static str {
    match language.to_lowercase().as_str() {
        "python" | "py" => "py",
        "javascript" | "js" | "node" => "js",
        "typescript" | "ts" => "ts",
        "bash" | "shell" | "sh" => "sh",
        "powershell" | "ps1" => "ps1",
        "rust" | "rs" => "rs",
        _ => "txt",
    }
}

fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

/// Windows often exposes `bash.exe` in PATH as the WSL launcher, not a POSIX shell.
fn is_wsl_bash_shim(path: &Path) -> bool {
    if !is_windows() {
        return false;
    }
    let lower = path.to_string_lossy().to_lowercase();
    lower.contains("system32\\bash.exe")
        || lower.contains("windowsapps\\bash.exe")
        || lower.ends_with("\\wsl.exe")
        || lower.contains("\\wsl\\")
}

fn resolve_posix_shell(candidate: &Path) -> Option<PathBuf> {
    if candidate.extension().is_some() {
        return candidate.exists().then(|| candidate.to_path_buf());
    }
    let resolved = which(candidate).ok()?;
    if is_wsl_bash_shim(&resolved) {
        return None;
    }
    Some(resolved)
}

fn bash_shell_candidates() -> Vec<PathBuf> {
    if is_windows() {
        vec![
            PathBuf::from(r"C:\Program Files\Git\usr\bin\bash.exe"),
            PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Git\usr\bin\bash.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
            PathBuf::from(r"C:\msys64\usr\bin\bash.exe"),
            PathBuf::from(r"C:\cygwin64\bin\bash.exe"),
            PathBuf::from("bash"),
            PathBuf::from("sh"),
        ]
    } else {
        vec![PathBuf::from("bash"), PathBuf::from("sh")]
    }
}

/// Apply best-effort network isolation to a process by pointing common HTTP
/// proxy environment variables at a dead local endpoint. This is **not** a
/// container sandbox; malicious code can ignore these variables. It does
/// reliably block most naive HTTP/HTTPS requests from standard libraries.
fn apply_network_sandbox(cmd: &mut Command, allow_network: bool) -> bool {
    if allow_network {
        return false;
    }
    let dead_proxy = "http://127.0.0.1:0";
    // Rust side-effect: Command::env does nothing if the value already exists
    // at the OS level, but that is acceptable for defense-in-depth.
    cmd.env("HTTP_PROXY", dead_proxy)
        .env("HTTPS_PROXY", dead_proxy)
        .env("ALL_PROXY", dead_proxy)
        .env("http_proxy", dead_proxy)
        .env("https_proxy", dead_proxy)
        .env("all_proxy", dead_proxy);
    true
}

fn telemetry_dir(base_dir: &Path) -> PathBuf {
    base_dir.parent()
        .map(|p| p.join("lab").join("telemetry"))
        .unwrap_or_else(|| base_dir.join("lab").join("telemetry"))
}

fn write_telemetry_record(
    base_dir: &Path,
    record: &PlaygroundTelemetryRecord,
) -> Result<PathBuf, String> {
    let dir = telemetry_dir(base_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create telemetry directory: {e}"))?;
    let now = chrono::Local::now();
    let file_name = format!("playground-{}.jsonl", now.format("%Y-%m-%d"));
    let path = dir.join(file_name);
    let line = serde_json::to_string(record)
        .map_err(|e| format!("telemetry serialization failed: {e}"))?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("could not open telemetry log: {e}"))?;
    use std::io::Write;
    writeln!(file, "{line}")
        .map_err(|e| format!("could not write telemetry record: {e}"))?;
    Ok(path)
}

/// Build the OS-specific command for a given language snippet.
fn build_command(language: &str, file_path: &Path, _base_dir: &Path) -> Result<Command, String> {
    let lang = language.to_lowercase();

    match lang.as_str() {
        "python" | "py" | "python3" => {
            let exe = if which::which("python3").is_ok() {
                "python3"
            } else {
                "python"
            };
            let mut cmd = Command::new(exe);
            cmd.arg(file_path.as_os_str());
            Ok(cmd)
        }
        "javascript" | "js" | "node" => {
            let mut cmd = Command::new("node");
            // Use the file name only (relative to current_dir) to avoid long
            // absolute paths with spaces being mis-parsed by Node on Windows.
            let file_name = file_path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| "invalid javascript file path".to_string())?;
            cmd.arg(file_name);
            Ok(cmd)
        }
        "typescript" | "ts" => {
            // Node.js v22.6+ / v24+ supports native type stripping.
            // This avoids the `npx` / `tsx` dependency entirely.
            let mut cmd = Command::new("node");
            let file_name = file_path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| "invalid typescript file path".to_string())?;
            cmd.arg("--experimental-strip-types").arg(file_name);
            Ok(cmd)
        }
        "bash" | "shell" | "sh" => {
            // Prefer real POSIX shells (Git Bash, MSYS). On Windows, bare `bash` in PATH
            // is often the WSL launcher, which fails without a configured distro.
            let file_name = file_path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| "invalid bash file path".to_string())?;
            for candidate in bash_shell_candidates() {
                if let Some(shell) = resolve_posix_shell(&candidate) {
                    let mut cmd = Command::new(shell);
                    // Pass only the file name; current_dir is already set to
                    // the playground directory. This avoids MSYS2/Git Bash
                    // choking on Windows absolute paths.
                    cmd.arg(file_name);
                    return Ok(cmd);
                }
            }
            if is_windows() {
                // Fall back to cmd /C with the script file. This won't handle
                // real bash syntax, but it lets simple commands run.
                let mut cmd = Command::new("cmd");
                cmd.arg("/C").arg(file_name);
                return Ok(cmd);
            }
            Err("bash not found. Install a POSIX shell, or use PowerShell.".into())
        }
        "powershell" | "ps1" => {
            let program = if is_windows() { "powershell" } else { "pwsh" };
            let mut cmd = Command::new(program);
            cmd.arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File")
                .arg(file_path.as_os_str());
            Ok(cmd)
        }
        "rust" | "rs" => {
            // `rustc <file>` produces `<filestem>` binary in the same directory.
            let stem = file_path
                .file_stem()
                .ok_or_else(|| "invalid rust file path".to_string())?;
            let bin = if is_windows() {
                file_path.with_file_name(stem).with_extension("exe")
            } else {
                file_path.with_file_name(stem)
            };
            let mut cmd = Command::new("rustc");
            cmd.arg(file_path.as_os_str())
                .arg("-o")
                .arg(bin.as_os_str());
            Ok(cmd)
        }
        _ => Err(format!("unsupported playground language: {language}")),
    }
}

fn binary_path_for_rust(file_path: &Path) -> Option<PathBuf> {
    let stem = file_path.file_stem()?;
    Some(if is_windows() {
        file_path.with_file_name(stem).with_extension("exe")
    } else {
        file_path.with_file_name(stem)
    })
}

/// Run an ad-hoc code snippet in a temporary directory under `data_directory`.
/// The directory is created if needed and the snippet file is written there.
#[tauri::command]
pub async fn coding_playground_run(
    state: tauri::State<'_, crate::NovaState>,
    request: PlaygroundRunRequest,
) -> Result<PlaygroundRunResult, String> {
    run_playground_request(&state.data_directory, request).await
}

/// Internal entry point shared by the Tauri command and the agent tool.
pub async fn run_playground_request(
    data_directory: &std::path::Path,
    request: PlaygroundRunRequest,
) -> Result<PlaygroundRunResult, String> {
    let language = request.language.trim().to_string();
    if language.is_empty() {
        return Err("language is required".into());
    }
    if request.code.is_empty() {
        return Err("code is required".into());
    }

    let base_dir = data_directory.join("playground");
    if let Err(e) = std::fs::create_dir_all(&base_dir) {
        return Err(format!("could not create playground directory: {e}"));
    }

    let slug = sanitize_filename(&language);
    let file_name = format!("{}_{}.{}", slug, uuid::Uuid::new_v4(), extension_for_language(&language));
    let file_path = base_dir.join(&file_name);

    if let Err(e) = tokio::fs::write(&file_path, request.code.as_bytes()).await {
        return Err(format!("could not write playground file: {e}"));
    }

    let start = std::time::Instant::now();

    let mut cmd = match build_command(&language, &file_path, &base_dir) {
        Ok(c) => c,
        Err(e) => {
            let record = PlaygroundTelemetryRecord {
                timestamp_utc: chrono::Utc::now().to_rfc3339(),
                language: language.clone(),
                network_allowed: request.allow_network,
                timeout_secs: request.timeout_secs,
                exit_code: None,
                elapsed_secs: start.elapsed().as_secs_f64(),
                stdout_chars: 0,
                stderr_chars: 0,
                error: Some(format!("build command failed: {e}")),
            };
            let _ = write_telemetry_record(&base_dir, &record);
            return Ok(PlaygroundRunResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                elapsed_secs: start.elapsed().as_secs_f64(),
                temp_file_path: Some(file_path.to_string_lossy().into_owned()),
                error: Some(e),
                network_allowed: request.allow_network,
                sandbox_applied: false,
                telemetry_log_path: None,
            });
        }
    };

    let sandbox_applied = apply_network_sandbox(&mut cmd, request.allow_network);

    cmd.current_dir(&base_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .args(&request.args);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let record = PlaygroundTelemetryRecord {
                timestamp_utc: chrono::Utc::now().to_rfc3339(),
                language: language.clone(),
                network_allowed: request.allow_network,
                timeout_secs: request.timeout_secs,
                exit_code: None,
                elapsed_secs: start.elapsed().as_secs_f64(),
                stdout_chars: 0,
                stderr_chars: 0,
                error: Some(format!("failed to spawn process: {e}")),
            };
            let telemetry_path = write_telemetry_record(&base_dir, &record).ok();
            return Ok(PlaygroundRunResult {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                elapsed_secs: start.elapsed().as_secs_f64(),
                temp_file_path: Some(file_path.to_string_lossy().into_owned()),
                error: Some(format!("failed to spawn process: {e}")),
                network_allowed: request.allow_network,
                sandbox_applied,
                telemetry_log_path: telemetry_path.map(|p| p.to_string_lossy().into_owned()),
            });
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(request.stdin.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }

    let timeout = tokio::time::Duration::from_secs(request.timeout_secs.max(1).min(300));
    let output = tokio::time::timeout(timeout, child.wait_with_output()).await;

    let elapsed = start.elapsed().as_secs_f64();

    let mut result = match output {
        Ok(Ok(out)) => PlaygroundRunResult {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            exit_code: out.status.code(),
            elapsed_secs: elapsed,
            temp_file_path: Some(file_path.to_string_lossy().into_owned()),
            error: None,
            network_allowed: request.allow_network,
            sandbox_applied,
            telemetry_log_path: None,
        },
        Ok(Err(e)) => PlaygroundRunResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            elapsed_secs: elapsed,
            temp_file_path: Some(file_path.to_string_lossy().into_owned()),
            error: Some(format!("process error: {e}")),
            network_allowed: request.allow_network,
            sandbox_applied,
            telemetry_log_path: None,
        },
        Err(_) => PlaygroundRunResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            elapsed_secs: elapsed,
            temp_file_path: Some(file_path.to_string_lossy().into_owned()),
            error: Some(format!("killed after {}s timeout", request.timeout_secs)),
            network_allowed: request.allow_network,
            sandbox_applied,
            telemetry_log_path: None,
        }
    };

    // Rust is a two-stage run: compile, then execute the binary.
    if result.error.is_none()
        && result.exit_code == Some(0)
        && matches!(language.to_lowercase().as_str(), "rust" | "rs")
    {
        if let Some(bin) = binary_path_for_rust(&file_path) {
            let run_start = std::time::Instant::now();
            let mut run_cmd = Command::new(&bin);
            run_cmd.current_dir(&base_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .args(&request.args);
            let _ = apply_network_sandbox(&mut run_cmd, request.allow_network);

            let mut run_child = match run_cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    result.error = Some(format!("compiled successfully but failed to run binary: {e}"));
                    result.elapsed_secs = run_start.elapsed().as_secs_f64();
                    return Ok(result);
                }
            };

            if let Some(mut stdin) = run_child.stdin.take() {
                let _ = stdin.write_all(request.stdin.as_bytes()).await;
                let _ = stdin.shutdown().await;
            }

            let run_timeout = tokio::time::Duration::from_secs(request.timeout_secs.max(1).min(300));
            let run_output = tokio::time::timeout(run_timeout, run_child.wait_with_output()).await;
            let run_elapsed = run_start.elapsed().as_secs_f64();

            result = match run_output {
                Ok(Ok(out)) => PlaygroundRunResult {
                    stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                    stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                    exit_code: out.status.code(),
                    elapsed_secs: run_elapsed,
                    temp_file_path: Some(file_path.to_string_lossy().into_owned()),
                    error: None,
                    network_allowed: request.allow_network,
                    sandbox_applied,
                    telemetry_log_path: None,
                },
                Ok(Err(e)) => PlaygroundRunResult {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: None,
                    elapsed_secs: run_elapsed,
                    temp_file_path: Some(file_path.to_string_lossy().into_owned()),
                    error: Some(format!("binary process error: {e}")),
                    network_allowed: request.allow_network,
                    sandbox_applied,
                    telemetry_log_path: None,
                },
                Err(_) => PlaygroundRunResult {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: None,
                    elapsed_secs: run_elapsed,
                    temp_file_path: Some(file_path.to_string_lossy().into_owned()),
                    error: Some(format!("binary killed after {}s timeout", request.timeout_secs)),
                    network_allowed: request.allow_network,
                    sandbox_applied,
                    telemetry_log_path: None,
                },
            };
        }
    }

    let record = PlaygroundTelemetryRecord {
        timestamp_utc: chrono::Utc::now().to_rfc3339(),
        language: language.clone(),
        network_allowed: request.allow_network,
        timeout_secs: request.timeout_secs,
        exit_code: result.exit_code,
        elapsed_secs: result.elapsed_secs,
        stdout_chars: result.stdout.chars().count(),
        stderr_chars: result.stderr.chars().count(),
        error: result.error.clone(),
    };
    result.telemetry_log_path = write_telemetry_record(&base_dir, &record)
        .ok()
        .map(|p| p.to_string_lossy().into_owned());

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_record_serializes() {
        let record = PlaygroundTelemetryRecord {
            timestamp_utc: "2026-06-25T00:00:00+00:00".into(),
            language: "python".into(),
            network_allowed: false,
            timeout_secs: 30,
            exit_code: Some(0),
            elapsed_secs: 0.12,
            stdout_chars: 5,
            stderr_chars: 0,
            error: None,
        };
        let s = serde_json::to_string(&record).expect("serialize");
        assert!(s.contains("networkAllowed"));
        assert!(s.contains("stdoutChars"));
    }

    #[test]
    fn apply_network_sandbox_flag_disabled_when_allowed() {
        let mut cmd = Command::new("node");
        assert!(!apply_network_sandbox(&mut cmd, true));
    }

    #[test]
    fn apply_network_sandbox_flag_enabled_when_blocked() {
        let mut cmd = Command::new("node");
        assert!(apply_network_sandbox(&mut cmd, false));
    }

    #[test]
    fn wsl_bash_shim_detected_on_windows() {
        assert!(is_wsl_bash_shim(Path::new(r"C:\Windows\System32\bash.exe")));
        assert!(is_wsl_bash_shim(Path::new(
            r"C:\Users\me\AppData\Local\Microsoft\WindowsApps\bash.exe",
        )));
        assert!(!is_wsl_bash_shim(Path::new(
            r"C:\Program Files\Git\usr\bin\bash.exe",
        )));
    }
}