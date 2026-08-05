//! Google Workspace integration: Gmail, Calendar, and Drive.
//!
//! OAuth 2.0 for installed apps with PKCE and a loopback redirect. The user
//! supplies their own Desktop OAuth client (client ID + optional secret) from
//! Google Cloud Console; tokens are stored AES-encrypted in `settings.json`
//! under the `google_tokens` slot, exactly like provider API keys.
//!
//! Exposes both Tauri commands (Productivity-mode widgets) and agent tools
//! (companion chat: "did I get an email from X?", "add a vet appointment…").

use std::io::{Read as _, Write as _};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::provider::{ProviderError, ToolDefinition};
use crate::settings::SettingsManager;
use crate::NovaState;

/// Which Google identity tokens/API calls use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoogleAccount {
    User,
    Sage,
}

impl GoogleAccount {
    pub fn parse(s: &str) -> Self {
        let t = s.trim();
        if t.eq_ignore_ascii_case("sage") || t.eq_ignore_ascii_case("agent") {
            Self::Sage
        } else {
            Self::User
        }
    }

    fn token_slot(self) -> &'static str {
        match self {
            Self::User => "google_tokens",
            Self::Sage => "google_tokens_sage",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::User => "your Google account",
            Self::Sage => "the agent's designated email account",
        }
    }

    /// Tool/API string: `user` or `agent` (legacy `sage` still accepted by parse).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Sage => "agent",
        }
    }
}

const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_ENDPOINT: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_BASE: &str = "https://www.googleapis.com/calendar/v3";
const DRIVE_BASE: &str = "https://www.googleapis.com/drive/v3";
const PEOPLE_BASE: &str = "https://people.googleapis.com/v1";
const TASKS_BASE: &str = "https://tasks.googleapis.com/tasks/v1";
/// Refresh access tokens this many seconds before expiry.
const REFRESH_SKEW_SECS: i64 = 60;
/// How long we wait for the user to finish the browser consent flow.
const AUTH_TIMEOUT_SECS: u64 = 300;

fn tool_err(msg: impl Into<String>) -> ProviderError {
    ProviderError::Api(msg.into())
}

/// Built-in app OAuth client, baked in at compile time for official builds:
/// `PS_GOOGLE_CLIENT_ID` / `PS_GOOGLE_CLIENT_SECRET` env vars during `cargo build`
/// (CI secrets, or a local `src-tauri/.env`). Users never need Google Cloud Console
/// when these are present; a client ID saved in Settings always overrides the built-in
/// one (for self-builds/testing).
const BUILTIN_CLIENT_ID: Option<&str> = option_env!("PS_GOOGLE_CLIENT_ID");
const BUILTIN_CLIENT_SECRET: Option<&str> = option_env!("PS_GOOGLE_CLIENT_SECRET");

fn builtin_client_id() -> String {
    let compiled = BUILTIN_CLIENT_ID.unwrap_or("").trim();
    if !compiled.is_empty() {
        return compiled.to_string();
    }
    // Runtime fallback for packaged launches that inject env without rebuild.
    std::env::var("PS_GOOGLE_CLIENT_ID")
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn builtin_client_secret() -> String {
    let compiled = BUILTIN_CLIENT_SECRET.unwrap_or("").trim();
    if !compiled.is_empty() {
        return compiled.to_string();
    }
    std::env::var("PS_GOOGLE_CLIENT_SECRET")
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Effective OAuth client id: user override from Settings, else built-in.
fn effective_client_id(settings: &SettingsManager) -> String {
    let user = settings.google_client_id();
    if !user.trim().is_empty() {
        return user.trim().to_string();
    }
    builtin_client_id()
}

/// Effective OAuth client secret: user secret when a user client id is in use,
/// else the built-in secret paired with the built-in client id.
fn effective_client_secret(settings: &SettingsManager) -> Result<String, ProviderError> {
    let user_id = settings.google_client_id();
    if !user_id.trim().is_empty() {
        return Ok(settings
            .decrypt_api_key("google_client_secret")
            .map_err(|e| tool_err(e.to_string()))?
            .unwrap_or_default());
    }
    Ok(builtin_client_secret())
}

// --- Token storage -------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTokens {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// Unix seconds when `access_token` expires.
    expires_at: i64,
    #[serde(default)]
    scopes: Vec<String>,
}

fn load_tokens(
    settings: &SettingsManager,
    account: GoogleAccount,
) -> Result<Option<StoredTokens>, ProviderError> {
    let raw = settings
        .decrypt_api_key(account.token_slot())
        .map_err(|e| tool_err(format!("read Google tokens: {e}")))?;
    match raw {
        None => Ok(None),
        Some(s) => serde_json::from_str::<StoredTokens>(&s)
            .map(Some)
            .map_err(|e| tool_err(format!("parse Google tokens: {e}"))),
    }
}

fn store_tokens(
    settings: &SettingsManager,
    account: GoogleAccount,
    tokens: &StoredTokens,
) -> Result<(), ProviderError> {
    let raw = serde_json::to_string(tokens).map_err(|e| tool_err(e.to_string()))?;
    settings
        .save_secret_slot(account.token_slot(), &raw)
        .map_err(|e| tool_err(format!("store Google tokens: {e}")))
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

// --- OAuth: PKCE + loopback -----------------------------------------------------

fn b64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

fn random_verifier() -> String {
    use ring::rand::SecureRandom as _;
    let rng = ring::rand::SystemRandom::new();
    let mut bytes = [0u8; 48];
    rng.fill(&mut bytes).expect("rng");
    b64url(&bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes());
    b64url(digest.as_ref())
}

fn requested_scopes(settings: &SettingsManager) -> Vec<&'static str> {
    let mut scopes = vec!["openid", "email"];
    if settings.google_gmail_enabled() {
        scopes.push("https://www.googleapis.com/auth/gmail.readonly");
        scopes.push("https://www.googleapis.com/auth/gmail.compose");
    }
    if settings.google_calendar_enabled() {
        scopes.push("https://www.googleapis.com/auth/calendar.events");
    }
    if settings.google_drive_enabled() {
        scopes.push("https://www.googleapis.com/auth/drive.readonly");
    }
    // Contacts + Tasks widgets (no separate Settings toggles).
    scopes.push("https://www.googleapis.com/auth/contacts.readonly");
    scopes.push("https://www.googleapis.com/auth/tasks");
    scopes
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    pub enabled: bool,
    pub connected: bool,
    pub account_email: String,
    pub has_client_id: bool,
    pub has_client_secret: bool,
    /// True when this build ships an app-level OAuth client (one-click sign-in).
    pub has_builtin_client: bool,
    /// True when the built-in client is what sign-in will use (no user override).
    pub using_builtin_client: bool,
    pub gmail_enabled: bool,
    pub calendar_enabled: bool,
    pub drive_enabled: bool,
    pub agent_tools_enabled: bool,
    pub agent_send_enabled: bool,
    pub sage_connected: bool,
    pub sage_account_email: String,
}

fn status_from_settings(settings: &SettingsManager) -> Result<GoogleStatus, String> {
    let view = settings.view().map_err(|e| e.to_string())?;
    let has_builtin = !builtin_client_id().is_empty();
    let user_id_set = !view.google_client_id.trim().is_empty();
    Ok(GoogleStatus {
        enabled: view.google_enabled,
        connected: view.google_connected,
        account_email: view.google_account_email,
        has_client_id: user_id_set || has_builtin,
        has_client_secret: view.has_google_client_secret,
        has_builtin_client: has_builtin,
        using_builtin_client: has_builtin && !user_id_set,
        gmail_enabled: view.google_gmail_enabled,
        calendar_enabled: view.google_calendar_enabled,
        drive_enabled: view.google_drive_enabled,
        agent_tools_enabled: view.google_agent_tools_enabled,
        agent_send_enabled: view.google_agent_send_enabled,
        sage_connected: view.google_sage_connected,
        sage_account_email: view.google_sage_account_email,
    })
}

/// Bind IPv4 loopback (and IPv6 when available) so the browser can reach us whether
/// Google/Chrome uses `127.0.0.1` or resolves `localhost` to `::1`.
fn bind_oauth_loopback() -> Result<(TcpListener, Option<TcpListener>, u16), String> {
    let v4 = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind loopback: {e}"))?;
    let port = v4
        .local_addr()
        .map_err(|e| format!("local addr: {e}"))?
        .port();
    // Best-effort IPv6 twin on the same port (may fail if IPv6 is disabled).
    let v6 = TcpListener::bind(("::1", port)).ok();
    for listener in std::iter::once(&v4).chain(v6.as_ref()) {
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("listener: {e}"))?;
    }
    Ok((v4, v6, port))
}

/// Redirect URI must match what we bind. Prefer `127.0.0.1` (Google's recommended
/// loopback form) so the browser does not depend on `localhost` → IPv6 resolution.
fn oauth_redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn write_oauth_html(stream: &mut TcpStream, ok: bool) {
    let body = if ok {
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Connected</title></head><body style=\"font-family:sans-serif;background:#f1efeb;color:#161513;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h2>Persistent Sage is connected</h2><p>You can close this window and return to the app.</p></div></body></html>"
    } else {
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Sign-in</title></head><body style=\"font-family:sans-serif;background:#f1efeb;color:#161513;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h2>Sign-in was not completed</h2><p>You can close this window and try again from Persistent Sage.</p></div></body></html>"
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Handle one accepted TCP connection; returns Some(code) when OAuth finished.
fn handle_oauth_http(mut stream: TcpStream) -> Result<Option<String>, String> {
    // Accept from a non-blocking listener leaves the client socket non-blocking on
    // some platforms; switch to blocking so we reliably read the full redirect.
    stream.set_nonblocking(false).ok();
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .ok();
    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(0) => return Ok(None),
        Ok(n) => n,
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => return Ok(None),
        Err(e) => return Err(format!("read: {e}")),
    };
    let request = String::from_utf8_lossy(&buf[..n]);
    let first_line = request.lines().next().unwrap_or_default();
    // "GET /?code=...&scope=... HTTP/1.1"
    let path = first_line.split_whitespace().nth(1).unwrap_or_default();
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or_default();
    let mut code: Option<String> = None;
    let mut error: Option<String> = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let decoded = urldecode(v);
        match k {
            "code" => code = Some(decoded),
            "error" => error = Some(decoded),
            _ => {}
        }
    }
    write_oauth_html(&mut stream, code.is_some() && error.is_none());
    if let Some(err) = error {
        return Err(format!("Google returned an error: {err}"));
    }
    Ok(code)
}

/// Waits (blocking) for the OAuth redirect on any bound loopback listener.
fn wait_for_redirect(
    listeners: Vec<TcpListener>,
    ready: Option<std::sync::mpsc::Sender<()>>,
) -> Result<String, String> {
    if let Some(tx) = ready {
        let _ = tx.send(());
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(AUTH_TIMEOUT_SECS);
    loop {
        if std::time::Instant::now() > deadline {
            return Err(
                "timed out waiting for Google sign-in (5 minutes). Keep Persistent Sage open \
                 while the browser finishes, then try Sign in again."
                    .into(),
            );
        }
        let mut progress = false;
        for listener in &listeners {
            match listener.accept() {
                Ok((stream, _)) => {
                    progress = true;
                    match handle_oauth_http(stream) {
                        Ok(Some(code)) => return Ok(code),
                        Ok(None) => {
                            // Favicon / empty / incomplete — keep waiting.
                        }
                        Err(e) => return Err(e),
                    }
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::Interrupted =>
                {
                    // idle
                }
                Err(e) => {
                    // Do not abort the whole flow on a single transient accept error.
                    eprintln!("[google oauth] accept: {e}");
                }
            }
        }
        if !progress {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

fn urldecode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = &s[i + 1..i + 3];
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
}

async fn exchange_token(
    http: &reqwest::Client,
    params: &[(&str, &str)],
) -> Result<TokenResponse, String> {
    let resp = http
        .post(TOKEN_ENDPOINT)
        .form(params)
        .send()
        .await
        .map_err(|e| format!("token endpoint: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("token endpoint HTTP {status}: {}", clip(&body, 400)));
    }
    serde_json::from_str::<TokenResponse>(&body).map_err(|e| format!("token JSON: {e}"))
}

fn scopes_for_account(settings: &SettingsManager, account: GoogleAccount) -> Vec<&'static str> {
    match account {
        GoogleAccount::User => requested_scopes(settings),
        GoogleAccount::Sage => vec![
            "openid",
            "email",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.compose",
        ],
    }
}

/// Runs the full interactive OAuth consent flow for `account` (user or sage).
pub async fn auth_start(
    http: &reqwest::Client,
    settings: &Arc<SettingsManager>,
    account: GoogleAccount,
) -> Result<GoogleStatus, String> {
    // One-click Productivity path: enable Workspace when the user signs in.
    if !settings.google_enabled() {
        settings
            .apply_update(crate::settings::SettingsUpdatePayload {
                google_enabled: Some(true),
                google_gmail_enabled: Some(true),
                google_calendar_enabled: Some(true),
                google_drive_enabled: Some(true),
                ..Default::default()
            })
            .map_err(|e| e.to_string())?;
    }

    let client_id = effective_client_id(settings);
    if client_id.is_empty() {
        return Err(
            "This build has no built-in Google app credentials. Either use an official release, \
             or add your own OAuth Client ID (Settings → Tools → Google Workspace → Advanced) from a Desktop \
             app client at console.cloud.google.com → APIs & Services → Credentials."
                .into(),
        );
    }
    let client_secret = effective_client_secret(settings).map_err(|e| e.to_string())?;
    if !settings.google_client_id().trim().is_empty() && client_secret.trim().is_empty() {
        return Err(
            "Your custom Google OAuth Client ID is set, but the Client secret is missing. \
             Paste both from the Desktop app JSON (Settings → Tools → Google → Advanced), \
             then try Sign in again."
                .into(),
        );
    }

    let (v4, v6, port) = bind_oauth_loopback()?;
    let redirect_uri = oauth_redirect_uri(port);
    let mut listeners = vec![v4];
    if let Some(v6) = v6 {
        listeners.push(v6);
    }

    let verifier = random_verifier();
    let challenge = pkce_challenge(&verifier);
    let scopes = scopes_for_account(settings, account).join(" ");

    let login_hint = "";

    let auth_url = format!(
        "{AUTH_ENDPOINT}?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=select_account+consent{login_hint}",
        urlencode(&client_id),
        urlencode(&redirect_uri),
        urlencode(&scopes),
        urlencode(&challenge),
    );

    // Start accepting before the browser opens so the redirect never hits a dead port.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();
    let wait = tokio::task::spawn_blocking(move || wait_for_redirect(listeners, Some(ready_tx)));
    match ready_rx.recv_timeout(std::time::Duration::from_secs(5)) {
        Ok(()) => {}
        Err(_) => {
            return Err(
                "Google sign-in callback server failed to start. Try again, or check that \
                 nothing is blocking loopback (127.0.0.1) connections."
                    .into(),
            );
        }
    }

    // Prefer opening the system browser; if that fails, keep waiting so the user can
    // paste the auth URL manually while the loopback callback is still live.
    if let Err(e) = opener::open(&auth_url) {
        eprintln!(
            "[google oauth] could not open browser ({e}); waiting on {redirect_uri} — auth URL:\n{auth_url}"
        );
    }

    let code = wait.await.map_err(|e| format!("join: {e}"))??;

    let mut params: Vec<(&str, &str)> = vec![
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier.as_str()),
    ];
    if !client_secret.trim().is_empty() {
        params.push(("client_secret", client_secret.as_str()));
    }
    let token = exchange_token(http, &params).await?;

    let stored = StoredTokens {
        access_token: token.access_token.clone(),
        refresh_token: token.refresh_token.clone(),
        expires_at: now_unix() + token.expires_in.unwrap_or(3600),
        scopes: token
            .scope
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_string)
            .collect(),
    };
    store_tokens(settings, account, &stored).map_err(|e| e.to_string())?;

    if let Ok(resp) = http
        .get(USERINFO_ENDPOINT)
        .bearer_auth(&token.access_token)
        .send()
        .await
    {
        if let Ok(v) = resp.json::<Value>().await {
            if let Some(email) = v.get("email").and_then(Value::as_str) {
                match account {
                    GoogleAccount::User => {
                        settings
                            .set_google_account_email(email)
                            .map_err(|e| e.to_string())?;
                    }
                    GoogleAccount::Sage => {
                        settings
                            .set_google_sage_account_email(email)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }

    status_from_settings(settings)
}

pub fn disconnect(
    settings: &Arc<SettingsManager>,
    account: GoogleAccount,
) -> Result<GoogleStatus, String> {
    settings
        .save_secret_slot(account.token_slot(), "")
        .map_err(|e| e.to_string())?;
    match account {
        GoogleAccount::User => {
            settings
                .set_google_account_email("")
                .map_err(|e| e.to_string())?;
        }
        GoogleAccount::Sage => {
            settings
                .set_google_sage_account_email("")
                .map_err(|e| e.to_string())?;
        }
    }
    status_from_settings(settings)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Returns a valid access token, refreshing when close to expiry.
async fn access_token(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
) -> Result<String, ProviderError> {
    let Some(mut tokens) = load_tokens(settings, account)? else {
        return Err(tool_err(format!(
            "{} is not connected. Connect it in Settings → Tools → Google Workspace.",
            account.label()
        )));
    };
    if tokens.expires_at - now_unix() > REFRESH_SKEW_SECS {
        return Ok(tokens.access_token);
    }
    let Some(refresh) = tokens.refresh_token.clone() else {
        return Err(tool_err(format!(
            "{} session expired and no refresh token is stored — reconnect the account.",
            account.label()
        )));
    };
    let client_id = effective_client_id(settings);
    let client_secret = effective_client_secret(settings)?;
    let mut params: Vec<(&str, &str)> = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if !client_secret.trim().is_empty() {
        params.push(("client_secret", client_secret.as_str()));
    }
    let token = exchange_token(http, &params)
        .await
        .map_err(|e| tool_err(format!("refresh Google token: {e}")))?;
    tokens.access_token = token.access_token.clone();
    tokens.expires_at = now_unix() + token.expires_in.unwrap_or(3600);
    if let Some(r) = token.refresh_token {
        tokens.refresh_token = Some(r);
    }
    store_tokens(settings, account, &tokens)?;
    Ok(token.access_token)
}

// --- Small HTTP helpers ---------------------------------------------------------

fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

async fn api_get(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    url: &str,
    query: &[(&str, String)],
) -> Result<Value, ProviderError> {
    let token = access_token(http, settings, account).await?;
    let resp = http
        .get(url)
        .query(query)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| tool_err(format!("Google API: {e}")))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tool_err(format!(
            "Google API HTTP {status}: {}",
            clip(&body, 400)
        )));
    }
    serde_json::from_str(&body).map_err(|e| tool_err(format!("Google API JSON: {e}")))
}

async fn api_get_bytes(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    url: &str,
    query: &[(&str, String)],
) -> Result<Vec<u8>, ProviderError> {
    let token = access_token(http, settings, account).await?;
    let resp = http
        .get(url)
        .query(query)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| tool_err(format!("Google API: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(tool_err(format!(
            "Google API HTTP {status}: {}",
            clip(&body, 400)
        )));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| tool_err(format!("Google API body: {e}")))
}

async fn api_post(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    url: &str,
    body: &Value,
) -> Result<Value, ProviderError> {
    let token = access_token(http, settings, account).await?;
    let resp = http
        .post(url)
        .bearer_auth(&token)
        .json(body)
        .send()
        .await
        .map_err(|e| tool_err(format!("Google API: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tool_err(format!(
            "Google API HTTP {status}: {}",
            clip(&text, 400)
        )));
    }
    serde_json::from_str(&text).map_err(|e| tool_err(format!("Google API JSON: {e}")))
}

async fn api_delete(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    url: &str,
) -> Result<(), ProviderError> {
    let token = access_token(http, settings, account).await?;
    let resp = http
        .delete(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| tool_err(format!("Google API: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(tool_err(format!(
            "Google API HTTP {status}: {}",
            clip(&body, 400)
        )));
    }
    Ok(())
}

async fn api_patch(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    url: &str,
    body: &Value,
) -> Result<Value, ProviderError> {
    let token = access_token(http, settings, account).await?;
    let resp = http
        .patch(url)
        .bearer_auth(&token)
        .json(body)
        .send()
        .await
        .map_err(|e| tool_err(format!("Google API: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(tool_err(format!(
            "Google API HTTP {status}: {}",
            clip(&text, 400)
        )));
    }
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).map_err(|e| tool_err(format!("Google API JSON: {e}")))
}

// --- Gmail ----------------------------------------------------------------------

fn header_value(headers: &[Value], name: &str) -> String {
    headers
        .iter()
        .find(|h| {
            h.get("name")
                .and_then(Value::as_str)
                .is_some_and(|n| n.eq_ignore_ascii_case(name))
        })
        .and_then(|h| h.get("value"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub async fn gmail_list(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    query: &str,
    max_results: u32,
) -> Result<Value, ProviderError> {
    let max = max_results.clamp(1, 25);
    let mut q: Vec<(&str, String)> = vec![("maxResults", max.to_string())];
    if !query.trim().is_empty() {
        q.push(("q", query.trim().to_string()));
    }
    let list = api_get(http, settings, account, &format!("{GMAIL_BASE}/messages"), &q).await?;
    let ids: Vec<String> = list
        .get("messages")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let mut messages = Vec::new();
    for id in ids.iter().take(max as usize) {
        let meta = api_get(
            http,
            settings,
            account,
            &format!("{GMAIL_BASE}/messages/{id}"),
            &[
                ("format", "metadata".to_string()),
                ("metadataHeaders", "From".to_string()),
                ("metadataHeaders", "To".to_string()),
                ("metadataHeaders", "Subject".to_string()),
                ("metadataHeaders", "Date".to_string()),
            ],
        )
        .await?;
        let empty = Vec::new();
        let headers = meta
            .pointer("/payload/headers")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let label_ids: Vec<String> = meta
            .get("labelIds")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        messages.push(json!({
            "id": id,
            "threadId": meta.get("threadId").and_then(Value::as_str).unwrap_or_default(),
            "from": header_value(headers, "From"),
            "to": header_value(headers, "To"),
            "subject": header_value(headers, "Subject"),
            "date": header_value(headers, "Date"),
            "snippet": meta.get("snippet").and_then(Value::as_str).unwrap_or_default(),
            "unread": label_ids.iter().any(|l| l == "UNREAD"),
        }));
    }
    Ok(json!({ "messages": messages, "totalListed": messages.len() }))
}

fn walk_for_body(part: &Value, prefer: &str) -> Option<String> {
    let mime = part.get("mimeType").and_then(Value::as_str).unwrap_or("");
    if mime.eq_ignore_ascii_case(prefer) {
        if let Some(data) = part.pointer("/body/data").and_then(Value::as_str) {
            if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE.decode(data) {
                return Some(String::from_utf8_lossy(&bytes).into_owned());
            }
        }
    }
    if let Some(parts) = part.get("parts").and_then(Value::as_array) {
        for p in parts {
            if let Some(found) = walk_for_body(p, prefer) {
                return Some(found);
            }
        }
    }
    None
}

fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub async fn gmail_read(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    message_id: &str,
    max_chars: usize,
) -> Result<Value, ProviderError> {
    let msg = api_get(
        http,
        settings,
        account,
        &format!("{GMAIL_BASE}/messages/{message_id}"),
        &[("format", "full".to_string())],
    )
    .await?;
    let empty = Vec::new();
    let headers = msg
        .pointer("/payload/headers")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let payload = msg.get("payload").cloned().unwrap_or(Value::Null);
    let body = walk_for_body(&payload, "text/plain")
        .or_else(|| walk_for_body(&payload, "text/html").map(|h| strip_html(&h)))
        .unwrap_or_else(|| {
            msg.get("snippet")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        });
    let max = max_chars.clamp(200, 40_000);
    Ok(json!({
        "id": message_id,
        "threadId": msg.get("threadId").and_then(Value::as_str).unwrap_or_default(),
        "messageIdHeader": header_value(headers, "Message-ID"),
        "from": header_value(headers, "From"),
        "to": header_value(headers, "To"),
        "cc": header_value(headers, "Cc"),
        "subject": header_value(headers, "Subject"),
        "date": header_value(headers, "Date"),
        "body": clip(&body, max),
        "account": account.as_str(),
    }))
}

/// Strip CR/LF and other ASCII controls so attacker-controlled fields cannot
/// inject extra MIME headers (e.g. `Bcc:`) into `build_mime` output.
fn sanitize_header_value(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(c, '\0'..='\x1f' | '\x7f'))
        .collect()
}

/// RFC 2047 header word-encoding for non-ASCII subjects.
fn encode_header(value: &str) -> String {
    let value = sanitize_header_value(value);
    if value.is_ascii() {
        value
    } else {
        format!(
            "=?UTF-8?B?{}?=",
            base64::engine::general_purpose::STANDARD.encode(value.as_bytes())
        )
    }
}

struct Attachment {
    filename: String,
    mime: String,
    bytes: Vec<u8>,
}

fn build_mime(
    to: &str,
    cc: &str,
    subject: &str,
    body: &str,
    attachments: &[Attachment],
    in_reply_to: &str,
    references: &str,
) -> String {
    let to = sanitize_header_value(to);
    let cc = sanitize_header_value(cc);
    let in_reply_to = sanitize_header_value(in_reply_to);
    let references = sanitize_header_value(references);

    let mut headers = String::new();
    headers.push_str(&format!("To: {to}\r\n"));
    if !cc.trim().is_empty() {
        headers.push_str(&format!("Cc: {cc}\r\n"));
    }
    headers.push_str(&format!("Subject: {}\r\n", encode_header(subject)));
    if !in_reply_to.trim().is_empty() {
        headers.push_str(&format!("In-Reply-To: {}\r\n", in_reply_to.trim()));
    }
    let refs = if !references.trim().is_empty() {
        references.trim()
    } else {
        in_reply_to.trim()
    };
    if !refs.is_empty() {
        headers.push_str(&format!("References: {refs}\r\n"));
    }
    headers.push_str("MIME-Version: 1.0\r\n");

    if attachments.is_empty() {
        headers.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
        headers.push_str("Content-Transfer-Encoding: base64\r\n\r\n");
        headers.push_str(&base64::engine::general_purpose::STANDARD.encode(body.as_bytes()));
        return headers;
    }

    let boundary = format!("ps-{}", uuid::Uuid::new_v4());
    headers.push_str(&format!(
        "Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"
    ));
    headers.push_str(&format!("--{boundary}\r\n"));
    headers.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
    headers.push_str("Content-Transfer-Encoding: base64\r\n\r\n");
    headers.push_str(&base64::engine::general_purpose::STANDARD.encode(body.as_bytes()));
    headers.push_str("\r\n");
    for att in attachments {
        let mime = sanitize_header_value(&att.mime);
        let filename = sanitize_header_value(&att.filename);
        headers.push_str(&format!("--{boundary}\r\n"));
        headers.push_str(&format!(
            "Content-Type: {}; name=\"{}\"\r\n",
            mime, filename
        ));
        headers.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{}\"\r\n",
            filename
        ));
        headers.push_str("Content-Transfer-Encoding: base64\r\n\r\n");
        let encoded = base64::engine::general_purpose::STANDARD.encode(&att.bytes);
        for chunk in encoded.as_bytes().chunks(76) {
            headers.push_str(&String::from_utf8_lossy(chunk));
            headers.push_str("\r\n");
        }
    }
    headers.push_str(&format!("--{boundary}--\r\n"));
    headers
}

const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;

async fn fetch_drive_attachment(
    http: &reqwest::Client,
    settings: &SettingsManager,
    file_id: &str,
) -> Result<Attachment, ProviderError> {
    let meta = api_get(
        http,
        settings,
        GoogleAccount::User,
        &format!("{DRIVE_BASE}/files/{file_id}"),
        &[("fields", "id,name,mimeType,size".to_string())],
    )
    .await?;
    let name = meta
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("attachment")
        .to_string();
    let mime = meta
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();

    // Google-native docs must be exported; regular files download directly.
    let (bytes, final_name, final_mime) = if mime.starts_with("application/vnd.google-apps") {
        let bytes = api_get_bytes(
            http,
            settings,
            GoogleAccount::User,
            &format!("{DRIVE_BASE}/files/{file_id}/export"),
            &[("mimeType", "application/pdf".to_string())],
        )
        .await?;
        (bytes, format!("{name}.pdf"), "application/pdf".to_string())
    } else {
        let bytes = api_get_bytes(
            http,
            settings,
            GoogleAccount::User,
            &format!("{DRIVE_BASE}/files/{file_id}"),
            &[("alt", "media".to_string())],
        )
        .await?;
        (bytes, name, mime)
    };
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(tool_err(format!(
            "attachment {final_name} is {} bytes; limit is {MAX_ATTACHMENT_BYTES}",
            bytes.len()
        )));
    }
    Ok(Attachment {
        filename: final_name,
        mime: final_mime,
        bytes,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn gmail_compose(
    http: &reqwest::Client,
    settings: &SettingsManager,
    account: GoogleAccount,
    to: &str,
    cc: &str,
    subject: &str,
    body: &str,
    drive_attachment_ids: &[String],
    send: bool,
    thread_id: &str,
    in_reply_to: &str,
    references: &str,
) -> Result<Value, ProviderError> {
    if to.trim().is_empty() {
        return Err(tool_err("`to` recipient is required"));
    }
    let mut attachments = Vec::new();
    for id in drive_attachment_ids.iter().take(5) {
        attachments.push(fetch_drive_attachment(http, settings, id).await?);
    }
    let mime = build_mime(
        to,
        cc,
        subject,
        body,
        &attachments,
        in_reply_to,
        references,
    );
    let raw = b64url(mime.as_bytes());

    let mut message = json!({ "raw": raw });
    if !thread_id.trim().is_empty() {
        message["threadId"] = json!(thread_id.trim());
    }

    if send {
        let resp = api_post(
            http,
            settings,
            account,
            &format!("{GMAIL_BASE}/messages/send"),
            &message,
        )
        .await?;
        Ok(json!({
            "status": "sent",
            "id": resp.get("id").and_then(Value::as_str).unwrap_or_default(),
            "threadId": resp.get("threadId").and_then(Value::as_str).unwrap_or(thread_id.trim()),
            "account": account.as_str(),
            "attachments": attachments.iter().map(|a| a.filename.clone()).collect::<Vec<_>>(),
        }))
    } else {
        let resp = api_post(
            http,
            settings,
            account,
            &format!("{GMAIL_BASE}/drafts"),
            &json!({ "message": message }),
        )
        .await?;
        Ok(json!({
            "status": "draft_created",
            "draftId": resp.get("id").and_then(Value::as_str).unwrap_or_default(),
            "account": account.as_str(),
            "attachments": attachments.iter().map(|a| a.filename.clone()).collect::<Vec<_>>(),
            "note": "Draft saved to Gmail — the user can review and send it from Gmail or the Email widget.",
        }))
    }
}

// --- Calendar --------------------------------------------------------------------

pub async fn calendar_list_events(
    http: &reqwest::Client,
    settings: &SettingsManager,
    time_min: &str,
    time_max: &str,
    query: &str,
    max_results: u32,
) -> Result<Value, ProviderError> {
    let now = chrono::Utc::now();
    let min = if time_min.trim().is_empty() {
        now.to_rfc3339()
    } else {
        normalize_rfc3339(time_min, false)?
    };
    let max_t = if time_max.trim().is_empty() {
        (now + chrono::Duration::days(14)).to_rfc3339()
    } else {
        normalize_rfc3339(time_max, true)?
    };
    let mut q: Vec<(&str, String)> = vec![
        ("timeMin", min),
        ("timeMax", max_t),
        ("singleEvents", "true".to_string()),
        ("orderBy", "startTime".to_string()),
        ("maxResults", max_results.clamp(1, 50).to_string()),
    ];
    if !query.trim().is_empty() {
        q.push(("q", query.trim().to_string()));
    }
    let resp = api_get(
        http,
        settings,
        GoogleAccount::User,
        &format!("{CALENDAR_BASE}/calendars/primary/events"),
        &q,
    )
    .await?;
    let events: Vec<Value> = resp
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|e| {
                    json!({
                        "id": e.get("id").and_then(Value::as_str).unwrap_or_default(),
                        "summary": e.get("summary").and_then(Value::as_str).unwrap_or("(no title)"),
                        "start": e.pointer("/start/dateTime").or_else(|| e.pointer("/start/date")).and_then(Value::as_str).unwrap_or_default(),
                        "end": e.pointer("/end/dateTime").or_else(|| e.pointer("/end/date")).and_then(Value::as_str).unwrap_or_default(),
                        "location": e.get("location").and_then(Value::as_str).unwrap_or_default(),
                        "description": clip(e.get("description").and_then(Value::as_str).unwrap_or_default(), 300),
                        "htmlLink": e.get("htmlLink").and_then(Value::as_str).unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(json!({ "events": events }))
}

/// Accepts RFC3339 (`2026-07-28T11:00:00-04:00`), naive local (`2026-07-28T11:00`),
/// or plain date (`2026-07-28`). Naive values are interpreted in local time.
fn normalize_rfc3339(raw: &str, end_of_day: bool) -> Result<String, ProviderError> {
    let s = raw.trim();
    if chrono::DateTime::parse_from_rfc3339(s).is_ok() {
        return Ok(s.to_string());
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Ok(attach_local_offset(naive));
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M") {
        return Ok(attach_local_offset(naive));
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        let time = if end_of_day {
            chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap()
        } else {
            chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
        };
        return Ok(attach_local_offset(date.and_time(time)));
    }
    Err(tool_err(format!(
        "could not parse time `{s}` — use RFC3339 (2026-07-28T11:00:00-04:00), naive local (2026-07-28T11:00), or a date (2026-07-28)"
    )))
}

fn attach_local_offset(naive: chrono::NaiveDateTime) -> String {
    use chrono::TimeZone as _;
    match chrono::Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) | chrono::LocalResult::Ambiguous(dt, _) => dt.to_rfc3339(),
        chrono::LocalResult::None => chrono::Utc.from_utc_datetime(&naive).to_rfc3339(),
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn calendar_create_event(
    http: &reqwest::Client,
    settings: &SettingsManager,
    summary: &str,
    start: &str,
    end: &str,
    description: &str,
    location: &str,
    all_day: bool,
) -> Result<Value, ProviderError> {
    if summary.trim().is_empty() {
        return Err(tool_err("event `summary` (title) is required"));
    }
    if start.trim().is_empty() {
        return Err(tool_err("event `start` is required"));
    }
    let mut body = json!({ "summary": summary.trim() });
    if !description.trim().is_empty() {
        body["description"] = json!(description.trim());
    }
    if !location.trim().is_empty() {
        body["location"] = json!(location.trim());
    }
    if all_day {
        let start_date = start.trim().split('T').next().unwrap_or(start.trim());
        let end_date = if end.trim().is_empty() {
            // Google all-day `end.date` is exclusive → next day.
            chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
                .map(|d| (d + chrono::Duration::days(1)).format("%Y-%m-%d").to_string())
                .map_err(|e| tool_err(format!("bad all-day start date: {e}")))?
        } else {
            end.trim().split('T').next().unwrap_or(end.trim()).to_string()
        };
        body["start"] = json!({ "date": start_date });
        body["end"] = json!({ "date": end_date });
    } else {
        let start_rfc = normalize_rfc3339(start, false)?;
        let end_rfc = if end.trim().is_empty() {
            // Default one-hour event.
            let dt = chrono::DateTime::parse_from_rfc3339(&start_rfc)
                .map_err(|e| tool_err(format!("start parse: {e}")))?;
            (dt + chrono::Duration::hours(1)).to_rfc3339()
        } else {
            normalize_rfc3339(end, false)?
        };
        body["start"] = json!({ "dateTime": start_rfc });
        body["end"] = json!({ "dateTime": end_rfc });
    }
    let resp = api_post(
        http,
        settings,
        GoogleAccount::User,
        &format!("{CALENDAR_BASE}/calendars/primary/events"),
        &body,
    )
    .await?;
    Ok(json!({
        "status": "created",
        "id": resp.get("id").and_then(Value::as_str).unwrap_or_default(),
        "htmlLink": resp.get("htmlLink").and_then(Value::as_str).unwrap_or_default(),
        "summary": resp.get("summary").and_then(Value::as_str).unwrap_or_default(),
        "start": resp.pointer("/start/dateTime").or_else(|| resp.pointer("/start/date")).and_then(Value::as_str).unwrap_or_default(),
    }))
}

pub async fn calendar_delete_event(
    http: &reqwest::Client,
    settings: &SettingsManager,
    event_id: &str,
) -> Result<Value, ProviderError> {
    if event_id.trim().is_empty() {
        return Err(tool_err("`event_id` is required"));
    }
    api_delete(
        http,
        settings,
        GoogleAccount::User,
        &format!("{CALENDAR_BASE}/calendars/primary/events/{}", event_id.trim()),
    )
    .await?;
    Ok(json!({ "status": "deleted", "id": event_id.trim() }))
}

// --- Drive -----------------------------------------------------------------------

pub async fn drive_list(
    http: &reqwest::Client,
    settings: &SettingsManager,
    query: &str,
    max_results: u32,
) -> Result<Value, ProviderError> {
    let mut q_parts = vec!["trashed = false".to_string()];
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        let escaped = trimmed.replace('\\', "\\\\").replace('\'', "\\'");
        q_parts.push(format!(
            "(name contains '{escaped}' or fullText contains '{escaped}')"
        ));
    }
    let resp = api_get(
        http,
        settings,
        GoogleAccount::User,
        &format!("{DRIVE_BASE}/files"),
        &[
            ("q", q_parts.join(" and ")),
            ("pageSize", max_results.clamp(1, 30).to_string()),
            (
                "fields",
                "files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)".to_string(),
            ),
            ("orderBy", "modifiedTime desc".to_string()),
        ],
    )
    .await?;
    Ok(json!({ "files": resp.get("files").cloned().unwrap_or_else(|| json!([])) }))
}

// --- People (Contacts) -----------------------------------------------------------

fn person_display_name(person: &Value) -> String {
    person
        .pointer("/names/0/displayName")
        .and_then(Value::as_str)
        .or_else(|| person.pointer("/names/0/unstructuredName").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

fn person_emails(person: &Value) -> Vec<String> {
    person
        .get("emailAddresses")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.get("value").and_then(Value::as_str).map(str::to_string))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn person_phones(person: &Value) -> Vec<String> {
    person
        .get("phoneNumbers")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.get("value").and_then(Value::as_str).map(str::to_string))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn contact_row(person: &Value) -> Option<Value> {
    let resource = person
        .get("resourceName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let name = person_display_name(person);
    let emails = person_emails(person);
    let phones = person_phones(person);
    if name.is_empty() && emails.is_empty() && phones.is_empty() {
        return None;
    }
    Some(json!({
        "id": resource,
        "name": name,
        "emails": emails,
        "phones": phones,
    }))
}

pub async fn contacts_list(
    http: &reqwest::Client,
    settings: &SettingsManager,
    query: &str,
    page_size: u32,
) -> Result<Value, ProviderError> {
    let size = page_size.clamp(1, 50);
    let q = query.trim();
    let people: Vec<Value> = if q.is_empty() {
        let resp = api_get(
            http,
            settings,
            GoogleAccount::User,
            &format!("{PEOPLE_BASE}/people/me/connections"),
            &[
                ("personFields", "names,emailAddresses,phoneNumbers".into()),
                ("pageSize", size.to_string()),
                ("sortOrder", "FIRST_NAME_ASCENDING".into()),
            ],
        )
        .await?;
        resp.get("connections")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    } else {
        let resp = api_get(
            http,
            settings,
            GoogleAccount::User,
            &format!("{PEOPLE_BASE}/people:searchContacts"),
            &[
                ("query", q.to_string()),
                ("readMask", "names,emailAddresses,phoneNumbers".into()),
                ("pageSize", size.to_string()),
            ],
        )
        .await?;
        resp.get("results")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|r| r.get("person").cloned())
                    .collect()
            })
            .unwrap_or_default()
    };
    let contacts: Vec<Value> = people.iter().filter_map(contact_row).collect();
    Ok(json!({ "contacts": contacts }))
}

// --- Tasks -----------------------------------------------------------------------

async fn default_task_list_id(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<String, ProviderError> {
    let resp = api_get(
        http,
        settings,
        GoogleAccount::User,
        &format!("{TASKS_BASE}/users/@me/lists"),
        &[("maxResults", "20".into())],
    )
    .await?;
    let lists = resp
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let id = lists
        .iter()
        .find(|l| {
            l.get("title")
                .and_then(Value::as_str)
                .is_some_and(|t| t.eq_ignore_ascii_case("My Tasks") || t.eq_ignore_ascii_case("Tasks"))
        })
        .or_else(|| lists.first())
        .and_then(|l| l.get("id").and_then(Value::as_str))
        .unwrap_or_default();
    if id.is_empty() {
        return Err(tool_err(
            "No Google Tasks list found. Create a list in Google Tasks, then retry.",
        ));
    }
    Ok(id.to_string())
}

pub async fn tasks_list(
    http: &reqwest::Client,
    settings: &SettingsManager,
    max_results: u32,
) -> Result<Value, ProviderError> {
    let list_id = default_task_list_id(http, settings).await?;
    let resp = api_get(
        http,
        settings,
        GoogleAccount::User,
        &format!("{TASKS_BASE}/lists/{list_id}/tasks"),
        &[
            ("maxResults", max_results.clamp(1, 50).to_string()),
            ("showCompleted", "true".into()),
            ("showHidden", "false".into()),
        ],
    )
    .await?;
    let items = resp
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let tasks: Vec<Value> = items
        .iter()
        .filter_map(|t| {
            let id = t.get("id")?.as_str()?.to_string();
            let title = t
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let status = t
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("needsAction")
                .to_string();
            let due = t.get("due").and_then(Value::as_str).unwrap_or("").to_string();
            let notes = t
                .get("notes")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            Some(json!({
                "id": id,
                "title": title,
                "status": status,
                "completed": status == "completed",
                "due": due,
                "notes": notes,
                "listId": list_id,
            }))
        })
        .collect();
    Ok(json!({ "listId": list_id, "tasks": tasks }))
}

pub async fn tasks_add(
    http: &reqwest::Client,
    settings: &SettingsManager,
    title: &str,
) -> Result<Value, ProviderError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(tool_err("Task title is required"));
    }
    let list_id = default_task_list_id(http, settings).await?;
    let resp = api_post(
        http,
        settings,
        GoogleAccount::User,
        &format!("{TASKS_BASE}/lists/{list_id}/tasks"),
        &json!({ "title": title }),
    )
    .await?;
    Ok(json!({
        "id": resp.get("id").and_then(Value::as_str).unwrap_or_default(),
        "title": resp.get("title").and_then(Value::as_str).unwrap_or(title),
        "status": resp.get("status").and_then(Value::as_str).unwrap_or("needsAction"),
        "completed": false,
        "listId": list_id,
    }))
}

pub async fn tasks_set_completed(
    http: &reqwest::Client,
    settings: &SettingsManager,
    task_id: &str,
    completed: bool,
    list_id: Option<&str>,
) -> Result<Value, ProviderError> {
    if task_id.trim().is_empty() {
        return Err(tool_err("`task_id` is required"));
    }
    let list = match list_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => id.to_string(),
        None => default_task_list_id(http, settings).await?,
    };
    let status = if completed {
        "completed"
    } else {
        "needsAction"
    };
    let mut body = json!({ "status": status });
    if completed {
        body["completed"] = json!(chrono::Utc::now().to_rfc3339());
    } else {
        body["completed"] = Value::Null;
    }
    let resp = api_patch(
        http,
        settings,
        GoogleAccount::User,
        &format!("{TASKS_BASE}/lists/{list}/tasks/{}", task_id.trim()),
        &body,
    )
    .await?;
    Ok(json!({
        "id": resp.get("id").and_then(Value::as_str).unwrap_or(task_id.trim()),
        "status": resp.get("status").and_then(Value::as_str).unwrap_or(status),
        "completed": completed,
        "listId": list,
    }))
}

pub async fn drive_read_document(
    http: &reqwest::Client,
    settings: &SettingsManager,
    file_id: &str,
    max_chars: usize,
) -> Result<Value, ProviderError> {
    let meta = api_get(
        http,
        settings,
        GoogleAccount::User,
        &format!("{DRIVE_BASE}/files/{file_id}"),
        &[("fields", "id,name,mimeType,size,webViewLink".to_string())],
    )
    .await?;
    let name = meta.get("name").and_then(Value::as_str).unwrap_or_default();
    let mime = meta
        .get("mimeType")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let max = max_chars.clamp(200, 60_000);

    let text = if mime.starts_with("application/vnd.google-apps") {
        let bytes = api_get_bytes(
            http,
            settings,
            GoogleAccount::User,
            &format!("{DRIVE_BASE}/files/{file_id}/export"),
            &[("mimeType", "text/plain".to_string())],
        )
        .await?;
        String::from_utf8_lossy(&bytes).into_owned()
    } else if mime.starts_with("text/") || mime == "application/json" {
        let bytes = api_get_bytes(
            http,
            settings,
            GoogleAccount::User,
            &format!("{DRIVE_BASE}/files/{file_id}"),
            &[("alt", "media".to_string())],
        )
        .await?;
        String::from_utf8_lossy(&bytes).into_owned()
    } else {
        return Err(tool_err(format!(
            "file `{name}` has binary type {mime} — only Google Docs/Sheets/Slides and text files can be read as text. It can still be attached to email drafts by id."
        )));
    };
    Ok(json!({
        "id": file_id,
        "name": name,
        "mimeType": mime,
        "webViewLink": meta.get("webViewLink").and_then(Value::as_str).unwrap_or_default(),
        "content": clip(&text, max),
    }))
}

// --- Agent tools -------------------------------------------------------------------

pub fn is_google_tool_name(name: &str) -> bool {
    matches!(
        name,
        "gmail_search"
            | "gmail_read"
            | "gmail_create_draft"
            | "gmail_send"
            | "calendar_list_events"
            | "calendar_create_event"
            | "calendar_delete_event"
            | "drive_search"
            | "drive_read_document"
            | "contacts_search"
            | "tasks_list"
            | "tasks_add"
            | "tasks_set_completed"
    )
}

pub fn tool_definitions(settings: &SettingsManager) -> Vec<ToolDefinition> {
    let mut tools = Vec::new();
    if settings.google_gmail_enabled() {
        tools.push(ToolDefinition {
            name: "gmail_search".into(),
            description: Some(
                "Search Gmail. Default account=user (your inbox). Pass account=agent for the companion's designated email (a separate Gmail you created for the agent). Supports Gmail query syntax (from:, subject:, newer_than:2d, is:unread…).".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Gmail search query, e.g. `from:vanessa newer_than:7d`. Empty = most recent inbox mail." },
                    "max_results": { "type": "integer", "description": "1-25, default 10" },
                    "account": { "type": "string", "description": "`user` (default) = your inbox; `agent` = agent's designated email account" }
                },
                "required": []
            }),
        });
        tools.push(ToolDefinition {
            name: "gmail_read".into(),
            description: Some(
                "Read one email in full (headers + plain-text body) by message id from gmail_search. Returns threadId and messageIdHeader for replies.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "message_id": { "type": "string" },
                    "max_chars": { "type": "integer", "description": "Body truncation, default 8000" },
                    "account": { "type": "string", "description": "`user` or `agent`" }
                },
                "required": ["message_id"]
            }),
        });
        tools.push(ToolDefinition {
            name: "gmail_create_draft".into(),
            description: Some(
                "Create a Gmail draft. Optionally attach Drive files by id. Prefer this over gmail_send for the user's inbox. For agent mailbox replies, gmail_send with account=agent is OK when correspondence is expected.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "to": { "type": "string", "description": "Recipient email (comma-separate multiple)" },
                    "cc": { "type": "string" },
                    "subject": { "type": "string" },
                    "body": { "type": "string", "description": "Plain-text body" },
                    "drive_attachment_ids": {
                        "type": "array", "items": { "type": "string" },
                        "description": "Drive file ids from drive_search to attach (max 5)"
                    },
                    "account": { "type": "string", "description": "`user` or `agent`" },
                    "thread_id": { "type": "string", "description": "Gmail thread id when replying (from gmail_read)" },
                    "in_reply_to": { "type": "string", "description": "RFC Message-ID header from gmail_read (messageIdHeader)" },
                    "references": { "type": "string", "description": "Optional References header; defaults to in_reply_to" }
                },
                "required": ["to", "subject", "body"]
            }),
        });
        // Always expose gmail_send when agent tools are on: human send still gated in run_google_tool;
        // agent-account send is allowed for designated-agent correspondence.
        tools.push(ToolDefinition {
            name: "gmail_send".into(),
            description: Some(
                "Send email. For account=user, only when the user enabled direct agent sending. \
                 For account=agent, ONLY the dedicated Email Agent thread may send (bind in Settings). \
                 Pass thread_id + in_reply_to from gmail_read to keep the thread. \
                 Other threads should leave pending actions via correspondence_sync."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "to": { "type": "string" },
                    "cc": { "type": "string" },
                    "subject": { "type": "string" },
                    "body": { "type": "string" },
                    "drive_attachment_ids": { "type": "array", "items": { "type": "string" } },
                    "account": { "type": "string", "description": "`user` or `agent`" },
                    "thread_id": { "type": "string" },
                    "in_reply_to": { "type": "string" },
                    "references": { "type": "string" }
                },
                "required": ["to", "subject", "body"]
            }),
        });
    }
    if settings.google_calendar_enabled() {
        tools.push(ToolDefinition {
            name: "calendar_list_events".into(),
            description: Some(
                "List upcoming events from the user's primary Google Calendar (default: next 14 days).".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "time_min": { "type": "string", "description": "RFC3339 or YYYY-MM-DD; default now" },
                    "time_max": { "type": "string", "description": "RFC3339 or YYYY-MM-DD; default +14 days" },
                    "query": { "type": "string", "description": "Free-text filter" },
                    "max_results": { "type": "integer", "description": "1-50, default 15" }
                },
                "required": []
            }),
        });
        tools.push(ToolDefinition {
            name: "calendar_create_event".into(),
            description: Some(
                "Create an event on the user's primary Google Calendar. Times may be RFC3339 or naive local (2026-07-28T11:00); naive times use the user's local timezone. End defaults to one hour after start.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "summary": { "type": "string", "description": "Event title" },
                    "start": { "type": "string" },
                    "end": { "type": "string" },
                    "description": { "type": "string" },
                    "location": { "type": "string" },
                    "all_day": { "type": "boolean" }
                },
                "required": ["summary", "start"]
            }),
        });
        tools.push(ToolDefinition {
            name: "calendar_delete_event".into(),
            description: Some(
                "Delete an event from the user's primary calendar by event id (from calendar_list_events). Confirm with the user before deleting.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": { "event_id": { "type": "string" } },
                "required": ["event_id"]
            }),
        });
    }
    if settings.google_drive_enabled() {
        tools.push(ToolDefinition {
            name: "drive_search".into(),
            description: Some(
                "Search the user's Google Drive by name or content. Returns file ids usable for reading or email attachments.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Name or content keywords; empty = recent files" },
                    "max_results": { "type": "integer", "description": "1-30, default 10" }
                },
                "required": []
            }),
        });
        tools.push(ToolDefinition {
            name: "drive_read_document".into(),
            description: Some(
                "Read a Google Doc/Sheet/Slides or text file from Drive as plain text by file id.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "file_id": { "type": "string" },
                    "max_chars": { "type": "integer", "description": "Default 12000" }
                },
                "required": ["file_id"]
            }),
        });
    }
    // Contacts + Tasks widgets (always available when Google agent tools are on).
    tools.push(ToolDefinition {
        name: "contacts_search".into(),
        description: Some(
            "Search or list the user's Google Contacts (name, emails, phones). Empty query returns recent/alphabetical connections.".into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Name or email fragment; empty = browse contacts" },
                "page_size": { "type": "integer", "description": "1-50, default 20" }
            },
            "required": []
        }),
    });
    tools.push(ToolDefinition {
        name: "tasks_list".into(),
        description: Some(
            "List tasks from the user's Google Tasks default list (includes completed and open items).".into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "max_results": { "type": "integer", "description": "1-50, default 25" }
            },
            "required": []
        }),
    });
    tools.push(ToolDefinition {
        name: "tasks_add".into(),
        description: Some(
            "Add a new task to the user's Google Tasks default list.".into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Task title / text" }
            },
            "required": ["title"]
        }),
    });
    tools.push(ToolDefinition {
        name: "tasks_set_completed".into(),
        description: Some(
            "Mark a Google Task completed or reopen it. Use task id from tasks_list.".into(),
        ),
        parameters: json!({
            "type": "object",
            "properties": {
                "task_id": { "type": "string" },
                "completed": { "type": "boolean", "description": "true = complete, false = reopen" },
                "list_id": { "type": "string", "description": "Optional; defaults to the primary Tasks list" }
            },
            "required": ["task_id", "completed"]
        }),
    });
    tools
}

fn arg_str(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn arg_u32(v: &Value, key: &str, default: u32) -> u32 {
    v.get(key)
        .and_then(Value::as_u64)
        .map(|n| n as u32)
        .unwrap_or(default)
}

fn arg_str_vec(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn require_google_service(enabled: bool, service: &str) -> Result<(), ProviderError> {
    if enabled {
        Ok(())
    } else {
        Err(tool_err(format!(
            "Google {service} is disabled — enable it in Settings → Tools → Google Workspace."
        )))
    }
}

pub async fn run_google_tool(
    http: &reqwest::Client,
    settings: &SettingsManager,
    name: &str,
    args: &Value,
    conversation_id: Option<&str>,
) -> Result<String, ProviderError> {
    if !settings.google_enabled() || !settings.google_agent_tools_enabled() {
        return Err(tool_err(
            "Google tools are disabled — enable them in Settings → Tools → Google Workspace.",
        ));
    }
    // Defense in depth: even text-embedded tool XML must not reach Gmail/Drive from the
    // autonomous Moltbook scheduler thread (untrusted public feed content).
    if let Some(cid) = conversation_id.map(str::trim).filter(|s| !s.is_empty()) {
        if settings
            .moltbook_scheduler_conversation_id()
            .as_deref()
            .is_some_and(|sched| sched == cid)
        {
            return Err(tool_err(
                "Google Workspace tools are not available on autonomous Moltbook scheduler turns.",
            ));
        }
    }
    let result = match name {
        "gmail_search" => {
            require_google_service(settings.google_gmail_enabled(), "Gmail")?;
            let account = GoogleAccount::parse(&arg_str(args, "account"));
            gmail_list(
                http,
                settings,
                account,
                &arg_str(args, "query"),
                arg_u32(args, "max_results", 10),
            )
            .await?
        }
        "gmail_read" => {
            require_google_service(settings.google_gmail_enabled(), "Gmail")?;
            let account = GoogleAccount::parse(&arg_str(args, "account"));
            gmail_read(
                http,
                settings,
                account,
                &arg_str(args, "message_id"),
                arg_u32(args, "max_chars", 8000) as usize,
            )
            .await?
        }
        "gmail_create_draft" | "gmail_send" => {
            require_google_service(settings.google_gmail_enabled(), "Gmail")?;
            let send = name == "gmail_send";
            let account = GoogleAccount::parse(&arg_str(args, "account"));
            // Human inbox send stays opt-in; agent mailbox send is Email-Agent-thread only.
            if send && account == GoogleAccount::User && !settings.google_agent_send_enabled() {
                return Err(tool_err(
                    "Direct sending from your inbox is disabled — create a draft with gmail_create_draft, enable agent sending in Settings, or send from account=agent in the Email Agent thread.",
                ));
            }
            if send && account == GoogleAccount::Sage {
                let Some(cid) = conversation_id.map(str::trim).filter(|s| !s.is_empty()) else {
                    return Err(tool_err(
                        "Agent-mailbox send requires an active chat thread context.",
                    ));
                };
                if !settings.is_email_agent_conversation(cid) {
                    return Err(tool_err(
                        "Only the dedicated Email Agent thread may gmail_send with account=agent. \
                         Bind that thread in Settings → Google → Agent email, or leave a pending action via correspondence_sync for the Email Agent.",
                    ));
                }
            }
            gmail_compose(
                http,
                settings,
                account,
                &arg_str(args, "to"),
                &arg_str(args, "cc"),
                &arg_str(args, "subject"),
                &arg_str(args, "body"),
                &arg_str_vec(args, "drive_attachment_ids"),
                send,
                &arg_str(args, "thread_id"),
                &arg_str(args, "in_reply_to"),
                &arg_str(args, "references"),
            )
            .await?
        }
        "calendar_list_events" => {
            require_google_service(settings.google_calendar_enabled(), "Calendar")?;
            calendar_list_events(
                http,
                settings,
                &arg_str(args, "time_min"),
                &arg_str(args, "time_max"),
                &arg_str(args, "query"),
                arg_u32(args, "max_results", 15),
            )
            .await?
        }
        "calendar_create_event" => {
            require_google_service(settings.google_calendar_enabled(), "Calendar")?;
            calendar_create_event(
                http,
                settings,
                &arg_str(args, "summary"),
                &arg_str(args, "start"),
                &arg_str(args, "end"),
                &arg_str(args, "description"),
                &arg_str(args, "location"),
                args.get("all_day").and_then(Value::as_bool).unwrap_or(false),
            )
            .await?
        }
        "calendar_delete_event" => {
            require_google_service(settings.google_calendar_enabled(), "Calendar")?;
            calendar_delete_event(http, settings, &arg_str(args, "event_id")).await?
        }
        "drive_search" => {
            require_google_service(settings.google_drive_enabled(), "Drive")?;
            drive_list(http, settings, &arg_str(args, "query"), arg_u32(args, "max_results", 10))
                .await?
        }
        "drive_read_document" => {
            require_google_service(settings.google_drive_enabled(), "Drive")?;
            drive_read_document(
                http,
                settings,
                &arg_str(args, "file_id"),
                arg_u32(args, "max_chars", 12_000) as usize,
            )
            .await?
        }
        "contacts_search" => {
            contacts_list(
                http,
                settings,
                &arg_str(args, "query"),
                arg_u32(args, "page_size", 20),
            )
            .await?
        }
        "tasks_list" => {
            tasks_list(http, settings, arg_u32(args, "max_results", 25)).await?
        }
        "tasks_add" => tasks_add(http, settings, &arg_str(args, "title")).await?,
        "tasks_set_completed" => {
            let completed = args
                .get("completed")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let list = arg_str(args, "list_id");
            tasks_set_completed(
                http,
                settings,
                &arg_str(args, "task_id"),
                completed,
                if list.trim().is_empty() {
                    None
                } else {
                    Some(list.as_str())
                },
            )
            .await?
        }
        other => return Err(tool_err(format!("unknown Google tool: {other}"))),
    };
    serde_json::to_string(&result).map_err(|e| tool_err(e.to_string()))
}

// --- Tauri commands (Productivity widgets) ----------------------------------------

#[tauri::command]
pub fn google_status(state: State<'_, NovaState>) -> Result<GoogleStatus, String> {
    status_from_settings(&state.settings)
}

#[tauri::command]
pub async fn google_auth_start(
    account: Option<String>,
    state: State<'_, NovaState>,
) -> Result<GoogleStatus, String> {
    let acct = GoogleAccount::parse(account.as_deref().unwrap_or("user"));
    auth_start(&state.http, &state.settings, acct).await
}

#[tauri::command]
pub fn google_disconnect(
    account: Option<String>,
    state: State<'_, NovaState>,
) -> Result<GoogleStatus, String> {
    let acct = GoogleAccount::parse(account.as_deref().unwrap_or("user"));
    disconnect(&state.settings, acct)
}

#[tauri::command]
pub async fn google_gmail_list(
    query: Option<String>,
    max_results: Option<u32>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    gmail_list(
        &state.http,
        &state.settings,
        GoogleAccount::User,
        query.as_deref().unwrap_or_default(),
        max_results.unwrap_or(15),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_gmail_get(
    message_id: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    gmail_read(
        &state.http,
        &state.settings,
        GoogleAccount::User,
        &message_id,
        20_000,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_gmail_send(
    to: String,
    subject: String,
    body: String,
    cc: Option<String>,
    send: Option<bool>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    gmail_compose(
        &state.http,
        &state.settings,
        GoogleAccount::User,
        &to,
        cc.as_deref().unwrap_or_default(),
        &subject,
        &body,
        &[],
        send.unwrap_or(false),
        "",
        "",
        "",
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_calendar_events(
    time_min: Option<String>,
    time_max: Option<String>,
    max_results: Option<u32>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    calendar_list_events(
        &state.http,
        &state.settings,
        time_min.as_deref().unwrap_or_default(),
        time_max.as_deref().unwrap_or_default(),
        "",
        max_results.unwrap_or(25),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_calendar_create_event(
    summary: String,
    start: String,
    end: Option<String>,
    description: Option<String>,
    location: Option<String>,
    all_day: Option<bool>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    calendar_create_event(
        &state.http,
        &state.settings,
        &summary,
        &start,
        end.as_deref().unwrap_or_default(),
        description.as_deref().unwrap_or_default(),
        location.as_deref().unwrap_or_default(),
        all_day.unwrap_or(false),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_calendar_delete_event(
    event_id: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    calendar_delete_event(&state.http, &state.settings, &event_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_drive_list(
    query: Option<String>,
    max_results: Option<u32>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    drive_list(
        &state.http,
        &state.settings,
        query.as_deref().unwrap_or_default(),
        max_results.unwrap_or(20),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_contacts_list(
    query: Option<String>,
    page_size: Option<u32>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    contacts_list(
        &state.http,
        &state.settings,
        query.as_deref().unwrap_or_default(),
        page_size.unwrap_or(30),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_tasks_list(
    max_results: Option<u32>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    tasks_list(&state.http, &state.settings, max_results.unwrap_or(40))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_tasks_add(
    title: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    tasks_add(&state.http, &state.settings, &title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_tasks_set_completed(
    task_id: String,
    completed: bool,
    list_id: Option<String>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    tasks_set_completed(
        &state.http,
        &state.settings,
        &task_id,
        completed,
        list_id.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpStream;

    #[test]
    fn oauth_redirect_uri_uses_loopback_with_port() {
        assert_eq!(oauth_redirect_uri(54321), "http://127.0.0.1:54321");
    }

    #[test]
    fn loopback_callback_accepts_redirect_with_code() {
        let (v4, v6, port) = bind_oauth_loopback().expect("bind");
        let mut listeners = vec![v4];
        if let Some(v6) = v6 {
            listeners.push(v6);
        }
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let wait = std::thread::spawn(move || wait_for_redirect(listeners, Some(ready_tx)));
        ready_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("ready");

        let mut stream =
            TcpStream::connect(("127.0.0.1", port)).expect("connect to oauth callback");
        stream
            .write_all(
                b"GET /?code=test-auth-code&scope=email HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
            )
            .expect("write");
        let code = wait.join().expect("join").expect("code");
        assert_eq!(code, "test-auth-code");
    }

    #[test]
    fn sanitize_header_value_strips_crlf_and_controls() {
        assert_eq!(
            sanitize_header_value("victim@example.com\r\nBcc: attacker@evil.com"),
            "victim@example.comBcc: attacker@evil.com"
        );
        assert_eq!(sanitize_header_value("ok\nline\x00\x1f\x7f"), "okline");
    }

    #[test]
    fn build_mime_rejects_header_injection_via_to() {
        let mime = build_mime(
            "victim@example.com\r\nBcc: attacker@evil.com",
            "",
            "Hello",
            "body",
            &[],
            "",
            "",
        );
        assert!(
            !mime.contains("\r\nBcc:"),
            "injected Bcc header must not appear: {mime}"
        );
        assert!(
            mime.starts_with("To: victim@example.comBcc: attacker@evil.com\r\n"),
            "To line should keep text without CR/LF split: {mime}"
        );
        assert!(mime.contains("Subject: Hello\r\n"));
    }

    #[test]
    fn build_mime_rejects_header_injection_via_subject_and_cc() {
        let mime = build_mime(
            "a@example.com",
            "b@example.com\r\nBcc: stealth@evil.com",
            "Hi\r\nBcc: subject-inject@evil.com",
            "body",
            &[],
            "",
            "",
        );
        assert!(!mime.contains("\r\nBcc:"), "injected Bcc must not appear: {mime}");
        assert!(mime.contains("Cc: b@example.comBcc: stealth@evil.com\r\n"));
        assert!(mime.contains("Subject: HiBcc: subject-inject@evil.com\r\n"));
    }

    #[test]
    fn build_mime_rejects_header_injection_via_reply_headers_and_attachment() {
        let attachments = [Attachment {
            filename: "report.pdf\r\nBcc: file@evil.com".into(),
            mime: "application/pdf\r\nX-Injected: yes".into(),
            bytes: b"pdf".to_vec(),
        }];
        let mime = build_mime(
            "a@example.com",
            "",
            "Re: thread",
            "body",
            &attachments,
            "<id@x>\r\nBcc: reply@evil.com",
            "<ref@x>\r\nBcc: refs@evil.com",
        );
        assert!(!mime.contains("\r\nBcc:"), "injected Bcc must not appear: {mime}");
        assert!(!mime.contains("\r\nX-Injected:"), "injected mime header must not appear: {mime}");
        assert!(mime.contains("In-Reply-To: <id@x>Bcc: reply@evil.com\r\n"));
        assert!(mime.contains("filename=\"report.pdfBcc: file@evil.com\""));
    }
}
