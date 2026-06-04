//! How Persistent Sage was installed (Microsoft Store MSIX vs direct GitHub download).

use serde::Serialize;

/// Where Windows users should get app updates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateChannel {
    /// Microsoft Store (MSIX). Updates via Partner Center / Store app — not GitHub.
    MicrosoftStore,
    /// GitHub Releases + optional Tauri in-app updater (NSIS / portable).
    DirectDownload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionInfo {
    pub channel: UpdateChannel,
    /// When true, route **Check for updates** to the Microsoft Store instead of GitHub.
    pub updates_via_microsoft_store: bool,
    /// `ms-windows-store:` URI opened by **Open Microsoft Store updates**.
    pub store_library_uri: String,
}

const STORE_LIBRARY_URI: &str = "ms-windows-store://downloadsandupdates";

#[cfg(windows)]
fn is_windows_packaged_app() -> bool {
    use std::ptr;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentPackageFullName(
            package_full_name_length: *mut u32,
            package_full_name: *mut u16,
        ) -> i32;
    }

    const APPMODEL_ERROR_NO_PACKAGE: i32 = 15700;
    const ERROR_INSUFFICIENT_BUFFER: i32 = 122;

    unsafe {
        let mut length: u32 = 0;
        let hr = GetCurrentPackageFullName(&mut length, ptr::null_mut());
        if hr == APPMODEL_ERROR_NO_PACKAGE {
            return false;
        }
        // First call with null buffer returns ERROR_INSUFFICIENT_BUFFER when packaged.
        hr == ERROR_INSUFFICIENT_BUFFER || (hr == 0 && length > 0)
    }
}

#[cfg(not(windows))]
fn is_windows_packaged_app() -> bool {
    false
}

/// True when this build/channel should not use the GitHub Tauri updater.
pub fn updates_via_microsoft_store() -> bool {
    is_windows_packaged_app()
}

pub fn distribution_info() -> DistributionInfo {
    let via_store = updates_via_microsoft_store();
    DistributionInfo {
        channel: if via_store {
            UpdateChannel::MicrosoftStore
        } else {
            UpdateChannel::DirectDownload
        },
        updates_via_microsoft_store: via_store,
        store_library_uri: STORE_LIBRARY_URI.into(),
    }
}

pub fn open_microsoft_store_updates() -> Result<(), String> {
    if !updates_via_microsoft_store() {
        return Err(
            "This install is not from the Microsoft Store. Use Settings → Updates (GitHub) or \
             download from GitHub Releases."
                .into(),
        );
    }
    opener::open(STORE_LIBRARY_URI).map_err(|e| format!("open Microsoft Store: {e}"))
}
