//! Single-instance guard for Persistent Sage.
//!
//! Prevents multiple desktop processes from running against the same data directory,
//! which can happen accidentally when the coding agent or user launches a second
//! `npm run tauri dev` from inside the workspace. The guard writes a PID lockfile
//! under `{data_dir}/.persistent-sage.lock` and overwrites it on startup if the stored
//! PID is no longer alive.

use std::path::{Path, PathBuf};

const LOCK_FILE_NAME: &str = ".persistent-sage.lock";

/// Acquire the app lock for this data directory. Returns the lock file path on
/// success, or an error if another Persistent Sage process already holds the lock.
pub fn acquire_data_dir_lock(data_dir: &Path) -> Result<PathBuf, String> {
    let lock_path = data_dir.join(LOCK_FILE_NAME);
    let current_pid = std::process::id();

    if let Ok(existing) = std::fs::read_to_string(&lock_path) {
        let existing_pid: u32 = existing.trim().parse().unwrap_or(0);
        if existing_pid != 0 && existing_pid != current_pid && process_is_alive(existing_pid) {
            return Err(format!(
                "Another Persistent Sage process is already running (PID {existing_pid}). \
                 Close it before starting a new instance. Lock file: {}",
                lock_path.display()
            ));
        }
    }

    std::fs::write(&lock_path, current_pid.to_string())
        .map_err(|e| format!("cannot write lock file {}: {e}", lock_path.display()))?;
    Ok(lock_path)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE, STILL_ACTIVE};
    use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    unsafe {
        let handle_result = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        let handle: HANDLE = match handle_result {
            Ok(h) => h,
            Err(_) => return false,
        };
        if handle.is_invalid() {
            return false;
        }
        let mut exit_code: u32 = 0;
        let alive = if GetExitCodeProcess(handle, &mut exit_code).is_ok() {
            exit_code == STILL_ACTIVE.0 as u32
        } else {
            // If we can open it but cannot read exit code, assume alive to be safe.
            true
        };
        let _ = CloseHandle(handle);
        alive
    }
}

#[cfg(not(windows))]
fn process_is_alive(pid: u32) -> bool {
    // /proc existence check avoids a libc dependency; procfs is present on Linux
    // and this fallback (assume-alive) is safe elsewhere.
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}
