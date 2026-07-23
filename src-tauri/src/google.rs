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
use std::net::TcpListener;
use std::sync::Arc;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::provider::{ProviderError, ToolDefinition};
use crate::settings::SettingsManager;
use crate::NovaState;

const TOKEN_SLOT: &str = "google_tokens";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_ENDPOINT: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const GMAIL_BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_BASE: &str = "https://www.googleapis.com/calendar/v3";
const DRIVE_BASE: &str = "https://www.googleapis.com/drive/v3";
/// Refresh access tokens this many seconds before expiry.
const REFRESH_SKEW_SECS: i64 = 60;
/// How long we wait for the user to finish the browser consent flow.
const AUTH_TIMEOUT_SECS: u64 = 300;

fn tool_err(msg: impl Into<String>) -> ProviderError {
    ProviderError::Api(msg.into())
}

/// Built-in app OAuth client, baked in at compile time for official builds:
/// `PS_GOOGLE_CLIENT_ID` / `PS_GOOGLE_CLIENT_SECRET` env vars during `cargo build`.
/// Users never need Google Cloud Console when these are present; a client ID
/// saved in Settings always overrides the built-in one (for self-builds/testing).
const BUILTIN_CLIENT_ID: Option<&str> = option_env!("PS_GOOGLE_CLIENT_ID");
const BUILTIN_CLIENT_SECRET: Option<&str> = option_env!("PS_GOOGLE_CLIENT_SECRET");

/// Effective OAuth client id: user override from Settings, else built-in.
fn effective_client_id(settings: &SettingsManager) -> String {
    let user = settings.google_client_id();
    if !user.trim().is_empty() {
        return user.trim().to_string();
    }
    BUILTIN_CLIENT_ID.unwrap_or("").trim().to_string()
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
    Ok(BUILTIN_CLIENT_SECRET.unwrap_or("").trim().to_string())
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

fn load_tokens(settings: &SettingsManager) -> Result<Option<StoredTokens>, ProviderError> {
    let raw = settings
        .decrypt_api_key(TOKEN_SLOT)
        .map_err(|e| tool_err(format!("read Google tokens: {e}")))?;
    match raw {
        None => Ok(None),
        Some(s) => serde_json::from_str::<StoredTokens>(&s)
            .map(Some)
            .map_err(|e| tool_err(format!("parse Google tokens: {e}"))),
    }
}

fn store_tokens(settings: &SettingsManager, tokens: &StoredTokens) -> Result<(), ProviderError> {
    let raw = serde_json::to_string(tokens).map_err(|e| tool_err(e.to_string()))?;
    settings
        .save_secret_slot(TOKEN_SLOT, &raw)
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
}

fn status_from_settings(settings: &SettingsManager) -> Result<GoogleStatus, String> {
    let view = settings.view().map_err(|e| e.to_string())?;
    let has_builtin = BUILTIN_CLIENT_ID.map(|s| !s.trim().is_empty()).unwrap_or(false);
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
    })
}

/// Waits (blocking, on a dedicated thread) for the single OAuth redirect and
/// returns the `code` query parameter.
fn wait_for_redirect(listener: TcpListener) -> Result<String, String> {
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("listener: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(AUTH_TIMEOUT_SECS);
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("listener: {e}"))?;
    loop {
        if std::time::Instant::now() > deadline {
            return Err("timed out waiting for Google sign-in (5 minutes)".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                    .ok();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).map_err(|e| format!("read: {e}"))?;
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
                let body = if code.is_some() {
                    "<html><body style=\"font-family:sans-serif;background:#f1efeb;color:#161513;display:flex;align-items:center;justify-content:center;height:100vh\"><div style=\"text-align:center\"><h2>Persistent Sage is connected</h2><p>You can close this window and return to the app.</p></div></body></html>"
                } else {
                    "<html><body style=\"font-family:sans-serif;background:#f1efeb;color:#161513;display:flex;align-items:center;justify-content:center;height:100vh\"><div style=\"text-align:center\"><h2>Sign-in was not completed</h2><p>You can close this window and try again from Persistent Sage.</p></div></body></html>"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes()).ok();
                stream.flush().ok();
                if let Some(err) = error {
                    return Err(format!("Google returned an error: {err}"));
                }
                if let Some(code) = code {
                    return Ok(code);
                }
                // Ignore stray requests (e.g. favicon) and keep waiting.
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(e) => return Err(format!("accept: {e}")),
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

/// Runs the full interactive OAuth consent flow. Returns the connected account email.
pub async fn auth_start(
    http: &reqwest::Client,
    settings: &Arc<SettingsManager>,
) -> Result<GoogleStatus, String> {
    let client_id = effective_client_id(settings);
    if client_id.is_empty() {
        return Err(
            "This build has no built-in Google app credentials. Either use an official release, \
             or add your own OAuth Client ID (Settings → Tools → Google Workspace) from a Desktop \
             app client at console.cloud.google.com → APIs & Services → Credentials."
                .into(),
        );
    }
    let client_secret = effective_client_secret(settings).map_err(|e| e.to_string())?;

    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind loopback: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local addr: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_verifier();
    let challenge = pkce_challenge(&verifier);
    let scopes = requested_scopes(settings).join(" ");

    let auth_url = format!(
        "{AUTH_ENDPOINT}?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        urlencode(&client_id),
        urlencode(&redirect_uri),
        urlencode(&scopes),
        urlencode(&challenge),
    );

    opener::open(&auth_url).map_err(|e| format!("open browser: {e}"))?;

    // Blocking accept loop on a plain thread; await it from async.
    let code = tokio::task::spawn_blocking(move || wait_for_redirect(listener))
        .await
        .map_err(|e| format!("join: {e}"))??;

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
    store_tokens(settings, &stored).map_err(|e| e.to_string())?;

    // Best-effort: resolve the account email for display.
    if let Ok(resp) = http
        .get(USERINFO_ENDPOINT)
        .bearer_auth(&token.access_token)
        .send()
        .await
    {
        if let Ok(v) = resp.json::<Value>().await {
            if let Some(email) = v.get("email").and_then(Value::as_str) {
                settings
                    .set_google_account_email(email)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    status_from_settings(settings)
}

pub fn disconnect(settings: &Arc<SettingsManager>) -> Result<GoogleStatus, String> {
    settings
        .save_secret_slot(TOKEN_SLOT, "")
        .map_err(|e| e.to_string())?;
    settings
        .set_google_account_email("")
        .map_err(|e| e.to_string())?;
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
) -> Result<String, ProviderError> {
    let Some(mut tokens) = load_tokens(settings)? else {
        return Err(tool_err(
            "Google account is not connected. Connect it in Productivity mode or Settings → Tools → Google Workspace.",
        ));
    };
    if tokens.expires_at - now_unix() > REFRESH_SKEW_SECS {
        return Ok(tokens.access_token);
    }
    let Some(refresh) = tokens.refresh_token.clone() else {
        return Err(tool_err(
            "Google session expired and no refresh token is stored — reconnect the account.",
        ));
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
    store_tokens(settings, &tokens)?;
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
    url: &str,
    query: &[(&str, String)],
) -> Result<Value, ProviderError> {
    let token = access_token(http, settings).await?;
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
    url: &str,
    query: &[(&str, String)],
) -> Result<Vec<u8>, ProviderError> {
    let token = access_token(http, settings).await?;
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
    url: &str,
    body: &Value,
) -> Result<Value, ProviderError> {
    let token = access_token(http, settings).await?;
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
    url: &str,
) -> Result<(), ProviderError> {
    let token = access_token(http, settings).await?;
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
    query: &str,
    max_results: u32,
) -> Result<Value, ProviderError> {
    let max = max_results.clamp(1, 25);
    let mut q: Vec<(&str, String)> = vec![("maxResults", max.to_string())];
    if !query.trim().is_empty() {
        q.push(("q", query.trim().to_string()));
    }
    let list = api_get(http, settings, &format!("{GMAIL_BASE}/messages"), &q).await?;
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
    message_id: &str,
    max_chars: usize,
) -> Result<Value, ProviderError> {
    let msg = api_get(
        http,
        settings,
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
        "from": header_value(headers, "From"),
        "to": header_value(headers, "To"),
        "cc": header_value(headers, "Cc"),
        "subject": header_value(headers, "Subject"),
        "date": header_value(headers, "Date"),
        "body": clip(&body, max),
    }))
}

/// RFC 2047 header word-encoding for non-ASCII subjects.
fn encode_header(value: &str) -> String {
    if value.is_ascii() {
        value.to_string()
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
) -> String {
    let mut headers = String::new();
    headers.push_str(&format!("To: {to}\r\n"));
    if !cc.trim().is_empty() {
        headers.push_str(&format!("Cc: {cc}\r\n"));
    }
    headers.push_str(&format!("Subject: {}\r\n", encode_header(subject)));
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
        headers.push_str(&format!("--{boundary}\r\n"));
        headers.push_str(&format!(
            "Content-Type: {}; name=\"{}\"\r\n",
            att.mime, att.filename
        ));
        headers.push_str(&format!(
            "Content-Disposition: attachment; filename=\"{}\"\r\n",
            att.filename
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
            &format!("{DRIVE_BASE}/files/{file_id}/export"),
            &[("mimeType", "application/pdf".to_string())],
        )
        .await?;
        (bytes, format!("{name}.pdf"), "application/pdf".to_string())
    } else {
        let bytes = api_get_bytes(
            http,
            settings,
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
    to: &str,
    cc: &str,
    subject: &str,
    body: &str,
    drive_attachment_ids: &[String],
    send: bool,
) -> Result<Value, ProviderError> {
    if to.trim().is_empty() {
        return Err(tool_err("`to` recipient is required"));
    }
    let mut attachments = Vec::new();
    for id in drive_attachment_ids.iter().take(5) {
        attachments.push(fetch_drive_attachment(http, settings, id).await?);
    }
    let mime = build_mime(to, cc, subject, body, &attachments);
    let raw = b64url(mime.as_bytes());

    if send {
        let resp = api_post(
            http,
            settings,
            &format!("{GMAIL_BASE}/messages/send"),
            &json!({ "raw": raw }),
        )
        .await?;
        Ok(json!({
            "status": "sent",
            "id": resp.get("id").and_then(Value::as_str).unwrap_or_default(),
            "attachments": attachments.iter().map(|a| a.filename.clone()).collect::<Vec<_>>(),
        }))
    } else {
        let resp = api_post(
            http,
            settings,
            &format!("{GMAIL_BASE}/drafts"),
            &json!({ "message": { "raw": raw } }),
        )
        .await?;
        Ok(json!({
            "status": "draft_created",
            "draftId": resp.get("id").and_then(Value::as_str).unwrap_or_default(),
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

pub async fn drive_read_document(
    http: &reqwest::Client,
    settings: &SettingsManager,
    file_id: &str,
    max_chars: usize,
) -> Result<Value, ProviderError> {
    let meta = api_get(
        http,
        settings,
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
            &format!("{DRIVE_BASE}/files/{file_id}/export"),
            &[("mimeType", "text/plain".to_string())],
        )
        .await?;
        String::from_utf8_lossy(&bytes).into_owned()
    } else if mime.starts_with("text/") || mime == "application/json" {
        let bytes = api_get_bytes(
            http,
            settings,
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
    )
}

pub fn tool_definitions(settings: &SettingsManager) -> Vec<ToolDefinition> {
    let mut tools = Vec::new();
    if settings.google_gmail_enabled() {
        tools.push(ToolDefinition {
            name: "gmail_search".into(),
            description: Some(
                "Search the user's Gmail inbox. Supports Gmail query syntax (from:, subject:, newer_than:2d, is:unread…). Returns sender, subject, date, snippet, and message ids.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Gmail search query, e.g. `from:vanessa newer_than:7d`. Empty = most recent inbox mail." },
                    "max_results": { "type": "integer", "description": "1-25, default 10" }
                },
                "required": []
            }),
        });
        tools.push(ToolDefinition {
            name: "gmail_read".into(),
            description: Some(
                "Read one email in full (headers + plain-text body) by message id from gmail_search.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "message_id": { "type": "string" },
                    "max_chars": { "type": "integer", "description": "Body truncation, default 8000" }
                },
                "required": ["message_id"]
            }),
        });
        tools.push(ToolDefinition {
            name: "gmail_create_draft".into(),
            description: Some(
                "Create a Gmail draft for the user to review and send. Optionally attach Google Drive files by id (Google Docs are converted to PDF). Prefer this over gmail_send.".into(),
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
                    }
                },
                "required": ["to", "subject", "body"]
            }),
        });
        if settings.google_agent_send_enabled() {
            tools.push(ToolDefinition {
                name: "gmail_send".into(),
                description: Some(
                    "Send an email immediately from the user's Gmail account. Only use when the user explicitly asked to send (not draft). Supports Drive attachments by id.".into(),
                ),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "to": { "type": "string" },
                        "cc": { "type": "string" },
                        "subject": { "type": "string" },
                        "body": { "type": "string" },
                        "drive_attachment_ids": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["to", "subject", "body"]
                }),
            });
        }
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

pub async fn run_google_tool(
    http: &reqwest::Client,
    settings: &SettingsManager,
    name: &str,
    args: &Value,
) -> Result<String, ProviderError> {
    if !settings.google_enabled() || !settings.google_agent_tools_enabled() {
        return Err(tool_err(
            "Google tools are disabled — enable them in Settings → Tools → Google Workspace.",
        ));
    }
    let result = match name {
        "gmail_search" => {
            gmail_list(http, settings, &arg_str(args, "query"), arg_u32(args, "max_results", 10))
                .await?
        }
        "gmail_read" => {
            gmail_read(
                http,
                settings,
                &arg_str(args, "message_id"),
                arg_u32(args, "max_chars", 8000) as usize,
            )
            .await?
        }
        "gmail_create_draft" | "gmail_send" => {
            let send = name == "gmail_send";
            if send && !settings.google_agent_send_enabled() {
                return Err(tool_err(
                    "Direct sending is disabled — create a draft with gmail_create_draft instead, or the user can enable agent sending in Settings → Tools → Google Workspace.",
                ));
            }
            gmail_compose(
                http,
                settings,
                &arg_str(args, "to"),
                &arg_str(args, "cc"),
                &arg_str(args, "subject"),
                &arg_str(args, "body"),
                &arg_str_vec(args, "drive_attachment_ids"),
                send,
            )
            .await?
        }
        "calendar_list_events" => {
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
            calendar_delete_event(http, settings, &arg_str(args, "event_id")).await?
        }
        "drive_search" => {
            drive_list(http, settings, &arg_str(args, "query"), arg_u32(args, "max_results", 10))
                .await?
        }
        "drive_read_document" => {
            drive_read_document(
                http,
                settings,
                &arg_str(args, "file_id"),
                arg_u32(args, "max_chars", 12_000) as usize,
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
pub async fn google_auth_start(state: State<'_, NovaState>) -> Result<GoogleStatus, String> {
    auth_start(&state.http, &state.settings).await
}

#[tauri::command]
pub fn google_disconnect(state: State<'_, NovaState>) -> Result<GoogleStatus, String> {
    disconnect(&state.settings)
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
    gmail_read(&state.http, &state.settings, &message_id, 20_000)
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
        &to,
        cc.as_deref().unwrap_or_default(),
        &subject,
        &body,
        &[],
        send.unwrap_or(false),
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
