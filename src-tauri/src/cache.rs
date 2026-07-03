//! Application cache / temporary file manager.
//!
//! Provides a dedicated `cache/` directory under the Persistent Sage data
//! directory so audit scripts, HTML dumps, cookies, JSON output, and other
//! runtime artifacts never clutter the repository root.

use serde::Serialize;
use std::path::{Path, PathBuf};

const CACHE_DIR_NAME: &str = "cache";

/// Resolved cache directory information returned to the UI.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub path: String,
    pub exists: bool,
    pub item_count: usize,
    pub size_bytes: u64,
}

/// Returns the canonical cache directory under the Persistent Sage data dir.
///
/// Respects the same env overrides as the rest of the app:
/// `PERSISTENT_SAGE_DATA_DIR` / `NOVA_DATA_DIR`, or `PERSISTENT_SAGE_PORTABLE`
/// / `NOVA_PORTABLE`.
pub fn cache_dir() -> Result<PathBuf, String> {
    let data_dir = crate::memory::default_data_dir().map_err(|e| e.to_string())?;
    let cache = data_dir.join(CACHE_DIR_NAME);
    std::fs::create_dir_all(&cache).map_err(|e| format!("create cache dir: {e}"))?;
    Ok(cache)
}

/// Build a path inside a cache sub-directory, creating the sub-directory if needed.
pub fn cache_path(subdir: &str, filename: &str) -> Result<PathBuf, String> {
    let base = cache_dir()?;
    let dir = base.join(subdir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create cache subdir: {e}"))?;
    Ok(dir.join(filename))
}

/// Recursively calculate file count and total size for a directory.
fn dir_stats(dir: &Path) -> Result<(usize, u64), String> {
    let mut count = 0usize;
    let mut size = 0u64;
    for entry in std::fs::read_dir(dir)
        .map_err(|e| format!("read cache dir: {e}"))?
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
            let (c, s) = dir_stats(&path)?;
            count += c;
            size += s;
        } else {
            count += 1;
            if let Ok(meta) = entry.metadata() {
                size += meta.len();
            }
        }
    }
    Ok((count, size))
}

/// Get current cache directory info for display in the UI.
#[tauri::command]
pub fn cache_info() -> Result<CacheInfo, String> {
    let path = cache_dir()?;
    let exists = path.exists();
    let (item_count, size_bytes) = if exists {
        dir_stats(&path).unwrap_or((0, 0))
    } else {
        (0, 0)
    };
    Ok(CacheInfo {
        path: path.to_string_lossy().into_owned(),
        exists,
        item_count,
        size_bytes,
    })
}

/// Clear the entire application cache directory.
#[tauri::command]
pub fn clear_cache() -> Result<CacheInfo, String> {
    let path = cache_dir()?;
    if path.exists() {
        for entry in std::fs::read_dir(&path)
            .map_err(|e| format!("read cache dir: {e}"))?
            .filter_map(|e| e.ok())
        {
            let p = entry.path();
            if p.is_dir() {
                let _ = std::fs::remove_dir_all(&p);
            } else {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    cache_info()
}

/// Reveal the cache directory in the system file manager.
#[tauri::command]
pub fn reveal_cache_directory() -> Result<(), String> {
    let dir = cache_dir()?;
    opener::open(&dir).map_err(|e| format!("open cache folder: {e}"))
}
