//! WebView camera/microphone permission helpers (Windows WebView2).

#[cfg(windows)]
fn allow_camera_for_origin(
    profile: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Profile4,
    origin: &str,
) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use windows_core::PCWSTR;

    let mut wide: Vec<u16> = origin.encode_utf16().chain(std::iter::once(0)).collect();
    let origin_w = PCWSTR::from_raw(wide.as_mut_ptr());
    unsafe {
        let _ = profile.SetPermissionState(
            COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            origin_w,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            None,
        );
    }
}

/// Pre-allow camera access for app origins in the embedded WebView2 (dev + packaged).
#[cfg(windows)]
pub fn allow_webview_camera_permissions(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_13, ICoreWebView2Profile4};
    use windows_core::Interface;

    let Some(win) = app.get_webview_window("main") else {
        return;
    };

    let _ = win.with_webview(|webview| {
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let Ok(core13) = Interface::cast::<ICoreWebView2_13>(&core) else {
                return;
            };
            let Ok(profile) = core13.Profile() else {
                return;
            };
            let Ok(profile4) = Interface::cast::<ICoreWebView2Profile4>(&profile) else {
                return;
            };

            for origin in [
                "http://localhost:1420",
                "http://127.0.0.1:1420",
                "https://tauri.localhost",
                "http://tauri.localhost",
            ] {
                allow_camera_for_origin(&profile4, origin);
            }
        }
    });
}

#[cfg(not(windows))]
pub fn allow_webview_camera_permissions(_app: &tauri::AppHandle) {}
