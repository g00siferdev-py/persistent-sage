//! Single-instance guard for Persistent Sage.
//!
//! Prevents multiple desktop processes from running against the same data directory,
//! which can happen accidentally when the coding agent or user launches a second
//! `npm run tauri dev` from inside the workspace. The guard creates
//! `{data_dir}/.persistent-sage.lock` exclusively and overwrites it on startup only
//! when the stored PID is no longer alive.
//!
//! This lock must be acquired **before** opening the settings crypto material or
//! migrating API keys, otherwise two first-run processes can write mismatched
//! `.nova_crypto/{ikm,salt}` and `settings.json` and permanently orphan credentials.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

const LOCK_FILE_NAME: &str = ".persistent-sage.lock";

/// Acquire the app lock for this data directory. Returns the lock file path on
/// success, or an error if another Persistent Sage process already holds the lock.
pub fn acquire_data_dir_lock(data_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(data_dir).map_err(|e| {
        format!(
            "cannot create data directory {}: {e}",
            data_dir.display()
        )
    })?;
    let lock_path = data_dir.join(LOCK_FILE_NAME);
    let current_pid = std::process::id();

    for _ in 0..4 {
        match try_create_lock_file(&lock_path, current_pid) {
            Ok(()) => return Ok(lock_path),
            Err(LockCreateError::AlreadyExists) => {
                if let Ok(existing) = std::fs::read_to_string(&lock_path) {
                    let existing_pid: u32 = existing.trim().parse().unwrap_or(0);
                    if existing_pid == current_pid {
                        return Ok(lock_path);
                    }
                    if existing_pid != 0 && process_is_alive(existing_pid) {
                        return Err(format!(
                            "Another Persistent Sage process is already running (PID {existing_pid}). \
                             Close it before starting a new instance. Lock file: {}",
                            lock_path.display()
                        ));
                    }
                }
                // Stale or unreadable lock — remove and retry exclusive create.
                let _ = std::fs::remove_file(&lock_path);
            }
            Err(LockCreateError::Io(e)) => {
                return Err(format!(
                    "cannot write lock file {}: {e}",
                    lock_path.display()
                ));
            }
        }
    }

    Err(format!(
        "could not acquire single-instance lock at {}",
        lock_path.display()
    ))
}

enum LockCreateError {
    AlreadyExists,
    Io(std::io::Error),
}

fn try_create_lock_file(lock_path: &Path, current_pid: u32) -> Result<(), LockCreateError> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path)
    {
        Ok(mut f) => {
            f.write_all(current_pid.to_string().as_bytes())
                .map_err(LockCreateError::Io)?;
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(LockCreateError::AlreadyExists)
        }
        Err(e) => Err(LockCreateError::Io(e)),
    }
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
    // Sending signal 0 to a PID checks existence without affecting the process.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "persistent_sage_lock_{label}_{}_{}",
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[test]
    fn exclusive_lock_rejects_second_live_holder() {
        let dir = temp_dir("exclusive");
        let lock_path = dir.join(LOCK_FILE_NAME);
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleep holder");
        let holder_pid = child.id();
        std::fs::write(&lock_path, holder_pid.to_string()).expect("seed lock");
        let err = acquire_data_dir_lock(&dir)
            .expect_err("live holder pid must block second acquire");
        assert!(
            err.contains("already running"),
            "unexpected error: {err}"
        );
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_lock_is_replaced_by_current_process() {
        let dir = temp_dir("stale");
        let lock_path = dir.join(LOCK_FILE_NAME);
        // PID 0 is never a live process in our check (parse/alive guards).
        std::fs::write(&lock_path, "0").expect("seed stale lock");
        let acquired = acquire_data_dir_lock(&dir).expect("stale lock should be replaceable");
        assert_eq!(acquired, lock_path);
        let contents = std::fs::read_to_string(&lock_path).expect("read lock");
        assert_eq!(contents, std::process::id().to_string());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_pid_reacquire_succeeds() {
        let dir = temp_dir("reentrant");
        let first = acquire_data_dir_lock(&dir).expect("first acquire");
        let second = acquire_data_dir_lock(&dir).expect("same pid reacquire");
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
