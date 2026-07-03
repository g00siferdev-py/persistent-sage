//! Path helpers — canonical data directory resolution and file-manager reveal.

use std::path::{Path, PathBuf};

use crate::memory;

/// Resolve the Persistent Sage data directory to the same on-disk location used at startup.
///
/// On Microsoft Store (MSIX) installs, Windows redirects known folders into
/// `AppData\Local\Packages\…\LocalCache\…`. Canonicalizing after the directory exists
/// resolves that redirect; we then strip the `\\?\` extended-path prefix so paths
/// look normal in Settings and open once in Explorer.
pub fn resolve_data_directory() -> Result<PathBuf, memory::MemoryError> {
    let dir = memory::default_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let canonical = std::fs::canonicalize(&dir).unwrap_or(dir);
    Ok(user_facing_path(canonical))
}

/// Strip Windows extended-length (`\\?\`) prefixes for display and shell open.
pub fn display_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let without_prefix = raw
        .strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .unwrap_or_else(|| {
            raw.strip_prefix(r"\\?\")
                .map(|s| s.to_string())
                .unwrap_or_else(|| raw.into_owned())
        });
    without_prefix
}

pub fn user_facing_path(path: PathBuf) -> PathBuf {
    PathBuf::from(display_path(&path))
}

/// Open a folder in the system file manager using the resolved on-disk path.
pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    let open_path = user_facing_path(path.to_path_buf());
    if !open_path.exists() {
        return Err(format!(
            "Folder does not exist: {}. Restart Persistent Sage; if this persists, set \
             PERSISTENT_SAGE_DATA_DIR to a folder you control.",
            display_path(&open_path)
        ));
    }

    #[cfg(windows)]
    {
        // explorer.exe often exits with code 1 even when the folder opens — spawn once, no fallback.
        std::process::Command::new("explorer.exe")
            .arg(open_path.as_os_str())
            .spawn()
            .map_err(|e| format!("open folder in Explorer: {e}"))?;
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        opener::open(&open_path).map_err(|e| format!("open folder in file manager: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_path_strips_verbatim_prefix() {
        let p = PathBuf::from(r"\\?\C:\Users\test\AppData\Local\Packages\foo");
        assert_eq!(
            display_path(&p),
            r"C:\Users\test\AppData\Local\Packages\foo"
        );
    }

    #[test]
    fn display_path_strips_verbatim_unc_prefix() {
        let p = PathBuf::from(r"\\?\UNC\server\share\folder");
        assert_eq!(display_path(&p), r"\\server\share\folder");
    }

    #[test]
    fn resolve_data_directory_honors_override() {
        let dir = std::env::temp_dir().join(format!(
            "persistent_sage_paths_test_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::env::set_var("PERSISTENT_SAGE_DATA_DIR", dir.to_string_lossy().as_ref());
        let resolved = resolve_data_directory().expect("resolve");
        let expected = user_facing_path(std::fs::canonicalize(&dir).unwrap_or(dir.clone()));
        assert_eq!(resolved, expected);
        assert!(!display_path(&resolved).starts_with(r"\\?\"));
        std::env::remove_var("PERSISTENT_SAGE_DATA_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
