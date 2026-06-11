//! Microsoft Store package update check/install (Windows MSIX / Store installs only).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreUpdateCheckResult {
    pub up_to_date: bool,
    pub update_available: bool,
    pub package_count: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreUpdateInstallResult {
    pub message: String,
    pub restart_required: bool,
}

#[cfg(windows)]
mod imp {
    use super::{StoreUpdateCheckResult, StoreUpdateInstallResult};
    use tauri::Manager;
    use windows::{
        core::Interface,
        Foundation::Collections::IVectorView,
        Services::Store::{StoreContext, StorePackageUpdate, StorePackageUpdateState},
        Win32::Foundation::HWND,
        Win32::UI::Shell::IInitializeWithWindow,
    };

    fn store_context(hwnd: HWND) -> Result<StoreContext, String> {
        let context = StoreContext::GetDefault()
            .map_err(|e| format!("Microsoft Store is unavailable ({e})."))?;
        let init: IInitializeWithWindow = context
            .cast()
            .map_err(|e| format!("Could not prepare Store update check ({e})."))?;
        unsafe {
            init.Initialize(hwnd)
                .map_err(|e| format!("Could not attach Store UI to this window ({e})."))?;
        }
        Ok(context)
    }

    fn pending_updates(context: &StoreContext) -> Result<IVectorView<StorePackageUpdate>, String> {
        let op = context
            .GetAppAndOptionalStorePackageUpdatesAsync()
            .map_err(|e| format!("Could not check Microsoft Store for updates ({e})."))?;
        op.get()
            .map_err(|e| format!("Microsoft Store update check did not complete ({e})."))
    }

    pub fn check_updates(hwnd: HWND) -> Result<StoreUpdateCheckResult, String> {
        let context = store_context(hwnd)?;
        let updates = pending_updates(&context)?;
        let count = updates
            .Size()
            .map_err(|e| format!("Could not read Store update results ({e})."))?;
        if count == 0 {
            Ok(StoreUpdateCheckResult {
                up_to_date: true,
                update_available: false,
                package_count: 0,
                message: "Persistent Sage is up to date (Microsoft Store).".into(),
            })
        } else {
            Ok(StoreUpdateCheckResult {
                up_to_date: false,
                update_available: true,
                package_count: count,
                message: format!(
                    "{count} Microsoft Store update(s) available. Choose Download & install to update through the Store."
                ),
            })
        }
    }

    pub fn install_updates(hwnd: HWND) -> Result<StoreUpdateInstallResult, String> {
        let context = store_context(hwnd)?;
        let updates = pending_updates(&context)?;
        let count = updates
            .Size()
            .map_err(|e| format!("Could not read Store update results ({e})."))?;
        if count == 0 {
            return Ok(StoreUpdateInstallResult {
                message: "No Microsoft Store updates are available.".into(),
                restart_required: false,
            });
        }

        let install_op = context
            .RequestDownloadAndInstallStorePackageUpdatesAsync(&updates)
            .map_err(|e| format!("Could not start Microsoft Store update ({e})."))?;
        let result = install_op
            .get()
            .map_err(|e| format!("Microsoft Store update did not complete ({e})."))?;
        let state = result
            .OverallState()
            .map_err(|e| format!("Could not read Microsoft Store update status ({e})."))?;

        if state == StorePackageUpdateState::Completed {
            Ok(StoreUpdateInstallResult {
                message: "Microsoft Store update completed. Windows may close Persistent Sage to finish installing.".into(),
                restart_required: true,
            })
        } else if state == StorePackageUpdateState::Canceled {
            Ok(StoreUpdateInstallResult {
                message: "Microsoft Store update was canceled.".into(),
                restart_required: false,
            })
        } else {
            Err(format!(
                "Microsoft Store update did not install successfully (status: {state:?})."
            ))
        }
    }

    pub fn hwnd_from_app(app: &tauri::AppHandle) -> Result<HWND, String> {
        let window = app
            .get_webview_window("main")
            .ok_or("Main window is not available.")?;
        let hwnd = window
            .hwnd()
            .map_err(|e| format!("Could not read window handle: {e}"))?;
        Ok(HWND(hwnd.0))
    }
}

pub fn check_store_updates(app: &tauri::AppHandle) -> Result<StoreUpdateCheckResult, String> {
    if !crate::distribution::updates_via_microsoft_store() {
        return Err(
            "This install uses GitHub Releases for updates, not the Microsoft Store.".into(),
        );
    }

    #[cfg(windows)]
    {
        let hwnd = imp::hwnd_from_app(app)?;
        return imp::check_updates(hwnd);
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Microsoft Store updates are only supported on Windows.".into())
    }
}

pub fn install_store_updates(app: &tauri::AppHandle) -> Result<StoreUpdateInstallResult, String> {
    if !crate::distribution::updates_via_microsoft_store() {
        return Err(
            "This install uses GitHub Releases for updates, not the Microsoft Store.".into(),
        );
    }

    #[cfg(windows)]
    {
        let hwnd = imp::hwnd_from_app(app)?;
        return imp::install_updates(hwnd);
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Microsoft Store updates are only supported on Windows.".into())
    }
}
