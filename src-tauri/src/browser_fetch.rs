//! Headless Chromium fetch for agent `fetch_browser`: JS-rendered pages, browser-like UA,
//! persistent profile (cookies in the user cache dir), structured content extraction, optional screenshots.
//!
//! Chrome profiles live under the XDG cache (`~/.cache/persistent-sage/browser_profile`) so they are not tied to
//! the Persistent Sage data directory, which may be root-owned if the app was ever run with sudo. Ephemeral
//! profiles under `/tmp` are used when locks or permissions block the persistent profile.
//!
//! Requires a system Chrome/Chromium/Edge binary (`PERSISTENT_SAGE_CHROME_PATH` or common install paths).
//!
//! **Environment (optional):**
//! - `PERSISTENT_SAGE_CHROME_PATH` — path to Chrome/Chromium/Edge binary (`NOVA_CHROME_PATH` still works)
//! - `PERSISTENT_SAGE_CHROME_NO_SANDBOX` — `1` forces `--no-sandbox` / `--disable-setuid-sandbox` (auto in Docker/Podman)
//! - `PERSISTENT_SAGE_CHROME_IGNORE_CERT_ERRORS` — `1` ignores TLS errors (dev only; fix CA bundle in production)
//! - `SSL_CERT_FILE` / `SSL_CERT_DIR` — passed through; on Linux Persistent Sage sets these from system CA paths when unset

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::sync::Mutex as AsyncMutex;

use scraper::{ElementRef, Html, Selector};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::process::Command;
use url::Url;

use crate::agent_tools::{tool_err, validate_fetch_url};
use crate::provider::ProviderError;

pub const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BROWSER_FETCH_TIMEOUT_SECS: u64 = 55;
const HOST_MIN_INTERVAL_SECS: u64 = 2;
const ROBOTS_FETCH_TIMEOUT_SECS: u64 = 12;
const MAX_HEADINGS: usize = 80;
const MAX_PARAGRAPHS: usize = 120;
const MAX_LINKS: usize = 150;
const MAX_IMAGES: usize = 60;
const MAX_TEXT_FIELD_CHARS: usize = 4_000;
const MAX_PARAGRAPH_CHARS: usize = 2_000;

static HOST_RATE_LIMIT: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
/// Chrome allows only one process per `--user-data-dir`; serialize launches.
static CHROME_LAUNCH_MUTEX: AsyncMutex<()> = AsyncMutex::const_new(());

const CHROME_LOCK_FILES: &[&str] = &["SingletonLock", "SingletonSocket", "SingletonCookie"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserWaitUntil {
    DomContentLoaded,
    Load,
    NetworkIdle,
}

impl BrowserWaitUntil {
    fn from_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "domcontentloaded" | "dom" => Self::DomContentLoaded,
            "load" => Self::Load,
            "networkidle" | "networkidle2" | "network_idle" => Self::NetworkIdle,
            _ => Self::NetworkIdle,
        }
    }

    fn virtual_time_budget_ms(self) -> u64 {
        match self {
            Self::DomContentLoaded => 1_500,
            Self::Load => 4_000,
            Self::NetworkIdle => 10_000,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeadingOut {
    level: u8,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkOut {
    text: String,
    href: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageOut {
    src: String,
    alt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserFetchResult {
    url: String,
    final_url: String,
    title: String,
    headings: Vec<HeadingOut>,
    paragraphs: Vec<String>,
    links: Vec<LinkOut>,
    images: Vec<ImageOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    screenshot_path: Option<String>,
    wait_until: String,
    robots_allowed: bool,
}

fn truncate_field(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    t.chars().take(max).collect::<String>() + "…"
}

async fn host_rate_limit_wait(host: &str) -> Result<(), ProviderError> {
    let wait_for = {
        let mut guard = HOST_RATE_LIMIT
            .lock()
            .map_err(|_| tool_err("rate limiter lock poisoned"))?;
        let map = guard.get_or_insert_with(HashMap::new);
        let now = Instant::now();
        let min = Duration::from_secs(HOST_MIN_INTERVAL_SECS);
        let delay = map.get(host).and_then(|last| {
            let elapsed = now.duration_since(*last);
            if elapsed < min {
                Some(min - elapsed)
            } else {
                None
            }
        });
        map.insert(host.to_string(), now);
        delay
    };
    if let Some(d) = wait_for {
        tokio::time::sleep(d).await;
    }
    Ok(())
}

/// Best-effort robots.txt: fetch and reject if `Disallow` matches URL path for `*` / `PersistentSage`.
async fn robots_txt_allows(http: &reqwest::Client, page_url: &Url) -> Result<bool, ProviderError> {
    let host = page_url
        .host_str()
        .ok_or_else(|| tool_err("URL missing host for robots.txt"))?;
    let robots_url = format!("{}://{}/robots.txt", page_url.scheme(), host);
    let res = match http
        .get(&robots_url)
        .header("User-Agent", BROWSER_USER_AGENT)
        .timeout(Duration::from_secs(ROBOTS_FETCH_TIMEOUT_SECS))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(true),
    };
    if !res.status().is_success() {
        return Ok(true);
    }
    let body = res.text().await.unwrap_or_default();
    let path = page_url.path();
    Ok(!robots_disallows_path(&body, path))
}

fn robots_disallows_path(robots_txt: &str, path: &str) -> bool {
    let path = if path.is_empty() { "/" } else { path };
    let mut applies = false;
    for line in robots_txt.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("user-agent:") {
            let agent = line
                .split_once(':')
                .map(|(_, v)| v.trim().to_ascii_lowercase())
                .unwrap_or_default();
            applies = agent == "*"
                || agent.contains("persistent")
                || agent.contains("sage")
                || agent.contains("nova");
            continue;
        }
        if !applies {
            continue;
        }
        if let Some(rule) = lower.strip_prefix("disallow:") {
            let rule = rule.trim();
            if rule.is_empty() {
                continue;
            }
            if path == rule || path.starts_with(rule.trim_end_matches('/')) {
                return true;
            }
        }
    }
    false
}

pub fn find_chrome_executable() -> Option<PathBuf> {
    if let Ok(p) =
        std::env::var("PERSISTENT_SAGE_CHROME_PATH").or_else(|_| std::env::var("NOVA_CHROME_PATH"))
    {
        let pb = PathBuf::from(p.trim());
        if pb.is_file() {
            return Some(pb);
        }
    }
    const CANDIDATES: &[&str] = &[
        "google-chrome-stable",
        "google-chrome",
        "chromium",
        "chromium-browser",
        "chrome",
        "microsoft-edge",
        "microsoft-edge-stable",
    ];
    for name in CANDIDATES {
        if let Ok(p) = which::which(name) {
            return Some(p);
        }
    }
    #[cfg(target_os = "macos")]
    {
        const MAC_PATHS: &[&str] = &[
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ];
        for p in MAC_PATHS {
            let pb = PathBuf::from(p);
            if pb.is_file() {
                return Some(pb);
            }
        }
    }
    #[cfg(windows)]
    {
        const WIN_PATHS: &[&str] = &[
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ];
        for p in WIN_PATHS {
            let pb = PathBuf::from(p);
            if pb.is_file() {
                return Some(pb);
            }
        }
    }
    None
}

/// Called at app startup: create the cache profile dir and warn about unusable legacy paths.
pub fn ensure_browser_directories(data_directory: &Path) {
    warn_if_path_not_owned_by_effective_user(data_directory, "Persistent Sage data directory");

    let cache_profile = cache_browser_profile_dir();
    if let Err(e) = std::fs::create_dir_all(&cache_profile) {
        eprintln!(
            "persistent-sage: warning: could not create browser profile cache {}: {e}",
            cache_profile.display()
        );
    }

    let legacy = data_directory.join("browser_profile");
    if legacy.exists() && !is_browser_profile_usable(&legacy) {
        eprintln!(
            "persistent-sage: warning: legacy browser profile {} is not usable by the current user \
             (often root-owned after running Persistent Sage with sudo). Using {} instead.",
            legacy.display(),
            cache_profile.display()
        );
    }
}

fn cache_browser_profile_dir() -> PathBuf {
    directories::ProjectDirs::from("app", "Persistent Sage", "Persistent Sage")
        .map(|d| d.cache_dir().join("browser_profile"))
        .unwrap_or_else(|| {
            std::env::temp_dir()
                .join("persistent-sage")
                .join("browser_profile")
        })
}

fn browser_profile_candidates(data_directory: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![
        cache_browser_profile_dir(),
        std::env::temp_dir()
            .join("persistent-sage")
            .join("browser_profile"),
    ];
    let legacy = data_directory.join("browser_profile");
    if path_usable_for_new_profile(&legacy) {
        candidates.push(legacy);
    }
    candidates
}

/// Whether we should try using `path` as a persistent profile (skip root-owned legacy dirs).
fn path_usable_for_new_profile(path: &Path) -> bool {
    if !path.exists() {
        return path
            .parent()
            .map(path_owned_by_effective_user)
            .unwrap_or(true);
    }
    path_owned_by_effective_user(path) && is_browser_profile_usable(path)
}

#[cfg(target_os = "linux")]
fn effective_unix_uid() -> Option<u32> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status
        .lines()
        .find(|l| l.starts_with("Uid:"))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

#[cfg(not(target_os = "linux"))]
fn effective_unix_uid() -> Option<u32> {
    None
}

#[cfg(unix)]
fn path_owned_by_effective_user(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    let Ok(meta) = std::fs::metadata(path) else {
        return true;
    };
    let Some(uid) = effective_unix_uid() else {
        return true;
    };
    meta.uid() == uid
}

#[cfg(not(unix))]
fn path_owned_by_effective_user(_path: &Path) -> bool {
    true
}

#[cfg(unix)]
fn warn_if_path_not_owned_by_effective_user(path: &Path, label: &str) {
    use std::os::unix::fs::MetadataExt;

    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    let Some(uid) = effective_unix_uid() else {
        return;
    };
    if meta.uid() != uid {
        eprintln!(
            "persistent-sage: warning: {label} {} is owned by uid {} (you are uid {}). \
             If browser fetch or settings fail, run: chown -R \"$USER:$USER\" {}",
            path.display(),
            meta.uid(),
            uid,
            path.display()
        );
    }
}

#[cfg(not(unix))]
fn warn_if_path_not_owned_by_effective_user(_path: &Path, _label: &str) {}

fn is_dir_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let test = dir.join(".nova_write_test");
    match std::fs::File::create(&test) {
        Ok(_) => {
            let _ = std::fs::remove_file(&test);
            true
        }
        Err(_) => false,
    }
}

fn can_remove_chrome_locks(dir: &Path) -> bool {
    for name in CHROME_LOCK_FILES {
        let p = dir.join(name);
        if p.exists() && std::fs::remove_file(&p).is_err() {
            return false;
        }
    }
    true
}

fn is_browser_profile_usable(dir: &Path) -> bool {
    if !is_dir_writable(dir) {
        return false;
    }
    if !can_remove_chrome_locks(dir) {
        return false;
    }
    let probe = dir.join("SingletonLock");
    if probe.exists() {
        return true;
    }
    match std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn resolve_browser_profile_dir(data_directory: &Path) -> Result<PathBuf, ProviderError> {
    let candidates = browser_profile_candidates(data_directory);
    for dir in &candidates {
        if is_browser_profile_usable(dir) {
            if dir != &candidates[0] {
                eprintln!(
                    "persistent-sage: using browser profile at {} (preferred cache path was not usable)",
                    dir.display()
                );
            }
            return Ok(dir.clone());
        }
    }
    let listed = candidates
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(tool_err(format!(
        "no writable Chrome profile directory (tried: {listed}). \
         If ~/.local/share/persistent-sage/data was created as root, run: chown -R \"$USER:$USER\" ~/.local/share/persistent-sage/data"
    )))
}

fn make_ephemeral_browser_profile() -> Result<PathBuf, ProviderError> {
    let dir = std::env::temp_dir()
        .join("persistent-sage")
        .join(format!("browser-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir)
        .map_err(|e| tool_err(format!("ephemeral browser profile: {e}")))?;
    Ok(dir)
}

fn cleanup_ephemeral_browser_profile(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

fn chrome_error_is_profile_lock(err: &ProviderError) -> bool {
    let msg = err.to_string();
    msg.contains("SingletonLock")
        || (msg.contains("profile") && msg.contains("Permission denied"))
        || msg.contains("could not lock its profile")
}

fn prepare_chrome_profile(dir: &Path) -> Result<(), ProviderError> {
    std::fs::create_dir_all(dir).map_err(|e| tool_err(format!("browser profile dir: {e}")))?;
    for name in CHROME_LOCK_FILES {
        let p = dir.join(name);
        if !p.exists() {
            continue;
        }
        std::fs::remove_file(&p).map_err(|e| {
            tool_err(format!(
                "could not remove stale Chrome lock {}: {e} (wrong owner or permissions)",
                p.display()
            ))
        })?;
    }
    Ok(())
}

async fn run_chrome_with_profile_fallback(
    chrome: &Path,
    profile_dir: &Path,
    url: &str,
    wait: BrowserWaitUntil,
    screenshot_path: Option<&Path>,
) -> Result<Vec<u8>, ProviderError> {
    prepare_chrome_profile(profile_dir)?;
    match run_chrome(chrome, profile_dir, url, wait, screenshot_path).await {
        Ok(bytes) => Ok(bytes),
        Err(e) if chrome_error_is_profile_lock(&e) => {
            eprintln!(
                "persistent-sage: Chrome profile error at {}, retrying with ephemeral profile",
                profile_dir.display()
            );
            let ephemeral = make_ephemeral_browser_profile()?;
            let result = async {
                prepare_chrome_profile(&ephemeral)?;
                run_chrome(chrome, &ephemeral, url, wait, screenshot_path).await
            }
            .await;
            cleanup_ephemeral_browser_profile(&ephemeral);
            result
        }
        Err(e) => Err(e),
    }
}

fn env_flag_true(name: &str) -> bool {
    std::env::var(name)
        .map(|s| {
            let s = s.trim();
            s == "1" || s.eq_ignore_ascii_case("true") || s.eq_ignore_ascii_case("yes")
        })
        .unwrap_or(false)
}

fn running_in_container() -> bool {
    Path::new("/.dockerenv").exists() || Path::new("/run/.containerenv").exists()
}

/// Sandbox off in Docker/Podman by default, or when `PERSISTENT_SAGE_CHROME_NO_SANDBOX=1`. Set `=0` to force sandbox.
fn chrome_no_sandbox_enabled() -> bool {
    match std::env::var("PERSISTENT_SAGE_CHROME_NO_SANDBOX")
        .or_else(|_| std::env::var("NOVA_CHROME_NO_SANDBOX"))
    {
        Ok(s) => {
            let s = s.trim();
            if s == "0" || s.eq_ignore_ascii_case("false") || s.eq_ignore_ascii_case("no") {
                false
            } else {
                env_flag_true("PERSISTENT_SAGE_CHROME_NO_SANDBOX")
                    || env_flag_true("NOVA_CHROME_NO_SANDBOX")
            }
        }
        Err(_) => running_in_container(),
    }
}

fn chrome_extra_launch_args() -> Vec<String> {
    let mut args = Vec::new();
    if chrome_no_sandbox_enabled() {
        args.push("--no-sandbox".into());
        args.push("--disable-setuid-sandbox".into());
    }
    if env_flag_true("PERSISTENT_SAGE_CHROME_IGNORE_CERT_ERRORS")
        || env_flag_true("NOVA_CHROME_IGNORE_CERT_ERRORS")
    {
        eprintln!("persistent-sage: warning: Chrome ignoring TLS certificate errors");
        args.push("--ignore-certificate-errors".into());
        args.push("--allow-insecure-localhost".into());
    }
    args
}

/// Point Chromium at the system CA store (critical in minimal containers without bundled roots).
fn apply_chrome_launch_env(cmd: &mut Command) {
    for key in [
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
    ] {
        if let Ok(v) = std::env::var(key) {
            if !v.trim().is_empty() {
                cmd.env(key, v);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("SSL_CERT_FILE").is_none() {
            const CA_FILES: &[&str] = &[
                "/etc/ssl/certs/ca-certificates.crt",
                "/etc/pki/tls/certs/ca-bundle.crt",
                "/etc/ssl/cert.pem",
            ];
            for p in CA_FILES {
                if Path::new(p).is_file() {
                    cmd.env("SSL_CERT_FILE", p);
                    break;
                }
            }
        }
        let nss_dir = Path::new("/etc/ssl/certs");
        if nss_dir.is_dir() && std::env::var_os("NSS_SSL_CERT_DIR").is_none() {
            cmd.env("NSS_SSL_CERT_DIR", nss_dir);
        }
        if nss_dir.is_dir() && std::env::var_os("SSL_CERT_DIR").is_none() {
            cmd.env("SSL_CERT_DIR", nss_dir);
        }
    }

    if chrome_no_sandbox_enabled()
        && std::env::var("PERSISTENT_SAGE_CHROME_NO_SANDBOX").is_err()
        && std::env::var("NOVA_CHROME_NO_SANDBOX").is_err()
        && running_in_container()
    {
        eprintln!("persistent-sage: container detected; Chrome launched with --no-sandbox");
    }
}

fn chrome_stderr_hint(stderr: &str) -> &'static str {
    if stderr.contains("SingletonLock") && stderr.contains("Permission denied") {
        " Chrome could not lock its profile directory (not writable, wrong owner, or another \
         Chrome is using the same profile). Persistent Sage stores browser data under the user cache \
         (~/.cache/persistent-sage/browser_profile); if this persists, remove stale locks or run: \
         chown -R \"$USER:$USER\" ~/.local/share/persistent-sage/data"
    } else if stderr.contains("error while loading shared libraries")
        || stderr.contains("No such file")
    {
        " Install Google Chrome or Chromium, or set PERSISTENT_SAGE_CHROME_PATH to the browser binary."
    } else if stderr.contains("certificate")
        || stderr.contains("SSL")
        || stderr.contains("ERR_CERT")
        || stderr.contains("NET::ERR_")
    {
        " TLS/CA issue: install system CA certs (e.g. apt install ca-certificates), mount /etc/ssl/certs \
         in containers, or set SSL_CERT_FILE. Dev only: PERSISTENT_SAGE_CHROME_IGNORE_CERT_ERRORS=1. \
         Sandbox: PERSISTENT_SAGE_CHROME_NO_SANDBOX=1"
    } else if stderr.contains("sandbox") || stderr.contains("Sandbox") {
        " Chrome sandbox blocked launch. Set PERSISTENT_SAGE_CHROME_NO_SANDBOX=1 (auto-enabled in Docker/Podman)."
    } else {
        ""
    }
}

async fn run_chrome(
    chrome: &Path,
    profile_dir: &Path,
    url: &str,
    wait: BrowserWaitUntil,
    screenshot_path: Option<&Path>,
) -> Result<Vec<u8>, ProviderError> {
    let mut args: Vec<String> = vec![
        "--headless=new".into(),
        "--disable-gpu".into(),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--disable-dev-shm-usage".into(),
        "--disable-blink-features=AutomationControlled".into(),
        format!("--user-agent={BROWSER_USER_AGENT}"),
        format!("--user-data-dir={}", profile_dir.display()),
        format!("--virtual-time-budget={}", wait.virtual_time_budget_ms()),
    ];
    args.extend(chrome_extra_launch_args());
    if let Some(path) = screenshot_path {
        args.push(format!("--screenshot={}", path.display()));
        args.push("--window-size=1280,900".into());
        args.push("--hide-scrollbars".into());
    }
    args.push("--dump-dom".into());
    args.push(url.to_string());

    let mut cmd = Command::new(chrome);
    cmd.args(&args);
    apply_chrome_launch_env(&mut cmd);
    let fut = cmd.output();
    let output = tokio::time::timeout(Duration::from_secs(BROWSER_FETCH_TIMEOUT_SECS), fut)
        .await
        .map_err(|_| tool_err("headless browser timed out"))?
        .map_err(|e| tool_err(format!("failed to start Chrome/Chromium: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let hint = chrome_stderr_hint(&stderr);
        return Err(tool_err(format!(
            "headless browser exited with {}: {}{}",
            output.status,
            stderr.trim(),
            hint
        )));
    }
    Ok(output.stdout)
}

fn resolve_href(base: &Url, raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('#') || raw.starts_with("javascript:") {
        return None;
    }
    Url::parse(raw)
        .or_else(|_| base.join(raw))
        .ok()
        .map(|u| u.to_string())
}

fn element_text(el: ElementRef<'_>) -> String {
    el.text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn extract_semantic_content(html: &str, base_url: &Url) -> BrowserFetchResult {
    let doc = Html::parse_document(html);
    let title = doc
        .select(&Selector::parse("title").unwrap())
        .next()
        .map(|el| truncate_field(&element_text(el), MAX_TEXT_FIELD_CHARS))
        .unwrap_or_default();

    let mut headings = Vec::new();
    for level in 1..=6u8 {
        if headings.len() >= MAX_HEADINGS {
            break;
        }
        let sel = Selector::parse(&format!("h{level}")).unwrap();
        for el in doc.select(&sel) {
            if headings.len() >= MAX_HEADINGS {
                break;
            }
            let text = truncate_field(&element_text(el), MAX_TEXT_FIELD_CHARS);
            if text.len() > 1 {
                headings.push(HeadingOut { level, text });
            }
        }
    }

    let p_sel = Selector::parse("p").unwrap();
    let mut paragraphs = Vec::new();
    for el in doc.select(&p_sel) {
        if paragraphs.len() >= MAX_PARAGRAPHS {
            break;
        }
        let t = truncate_field(&element_text(el), MAX_PARAGRAPH_CHARS);
        if t.chars().count() >= 20 {
            paragraphs.push(t);
        }
    }

    let a_sel = Selector::parse("a[href]").unwrap();
    let mut links = Vec::new();
    let mut seen_href = std::collections::BTreeSet::new();
    for el in doc.select(&a_sel) {
        if links.len() >= MAX_LINKS {
            break;
        }
        let href_raw = el.value().attr("href").unwrap_or("");
        let Some(href) = resolve_href(base_url, href_raw) else {
            continue;
        };
        if !seen_href.insert(href.clone()) {
            continue;
        }
        let text = truncate_field(&element_text(el), 300);
        links.push(LinkOut { text, href });
    }

    let img_sel = Selector::parse("img").unwrap();
    let mut images = Vec::new();
    for el in doc.select(&img_sel) {
        if images.len() >= MAX_IMAGES {
            break;
        }
        let src_raw = el
            .value()
            .attr("src")
            .or_else(|| el.value().attr("data-src"))
            .unwrap_or("");
        let Some(src) = resolve_href(base_url, src_raw) else {
            continue;
        };
        let alt = el
            .value()
            .attr("alt")
            .map(|a| truncate_field(a, 500))
            .unwrap_or_default();
        images.push(ImageOut { src, alt });
    }

    BrowserFetchResult {
        url: base_url.to_string(),
        final_url: base_url.to_string(),
        title,
        headings,
        paragraphs,
        links,
        images,
        screenshot_path: None,
        wait_until: "networkidle".into(),
        robots_allowed: true,
    }
}

pub async fn fetch_browser_page(
    http: &reqwest::Client,
    data_directory: &Path,
    workspace_root: Option<&Path>,
    ignore_robots: bool,
    args: &Value,
) -> Result<String, ProviderError> {
    let raw_url = args
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| tool_err("fetch_browser: `url` is required"))?
        .trim();
    if raw_url.is_empty() {
        return Err(tool_err("fetch_browser: url is empty"));
    }
    let page_url = validate_fetch_url(raw_url)?;
    let host = page_url
        .host_str()
        .ok_or_else(|| tool_err("URL must include a host"))?
        .to_string();

    host_rate_limit_wait(&host).await?;

    let robots_allowed = if ignore_robots {
        true
    } else {
        robots_txt_allows(http, &page_url).await?
    };
    if !robots_allowed {
        return Err(tool_err(format!(
            "robots.txt disallows fetching this path on {host}"
        )));
    }

    let chrome = find_chrome_executable().ok_or_else(|| {
        tool_err(
            "fetch_browser requires Google Chrome, Chromium, or Microsoft Edge on this system. \
             Install one or set PERSISTENT_SAGE_CHROME_PATH to the browser executable.",
        )
    })?;

    let wait = args
        .get("wait_until")
        .and_then(|v| v.as_str())
        .map(BrowserWaitUntil::from_str)
        .unwrap_or(BrowserWaitUntil::NetworkIdle);

    let want_screenshot = args
        .get("screenshot")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let profile_dir = resolve_browser_profile_dir(data_directory)?;

    let screenshot_path = if want_screenshot {
        let shots_dir = workspace_root
            .map(|w| w.join("browser-screenshots"))
            .unwrap_or_else(|| data_directory.join("browser-screenshots"));
        std::fs::create_dir_all(&shots_dir)
            .map_err(|e| tool_err(format!("screenshot dir: {e}")))?;
        let name = format!("shot-{}.png", uuid::Uuid::new_v4());
        Some(shots_dir.join(name))
    } else {
        None
    };

    let _chrome_guard = CHROME_LAUNCH_MUTEX.lock().await;
    let dom_bytes = run_chrome_with_profile_fallback(
        &chrome,
        &profile_dir,
        page_url.as_str(),
        wait,
        screenshot_path.as_deref(),
    )
    .await?;
    let html = String::from_utf8_lossy(&dom_bytes).into_owned();

    let mut result = extract_semantic_content(&html, &page_url);
    result.wait_until = match wait {
        BrowserWaitUntil::DomContentLoaded => "domcontentloaded",
        BrowserWaitUntil::Load => "load",
        BrowserWaitUntil::NetworkIdle => "networkidle",
    }
    .into();
    result.robots_allowed = robots_allowed;
    if let Some(ref shot) = screenshot_path {
        if shot.is_file() {
            result.screenshot_path = Some(shot.display().to_string());
        }
    }

    if result.title.is_empty() && result.headings.is_empty() && result.paragraphs.is_empty() {
        result.paragraphs.push(
            "(No article text extracted; page may still be blocked or heavily scripted. \
             Try a different wait_until or check the URL in a normal browser.)"
                .into(),
        );
    }

    let payload = json!(result);
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| tool_err(format!("serialize fetch_browser result: {e}")))?;
    const OUT_MAX: usize = 52_000;
    if text.chars().count() > OUT_MAX {
        Ok(text.chars().take(OUT_MAX).collect::<String>() + "\n… [truncated]")
    } else {
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn robots_disallow_blocks_path_prefix() {
        let robots = "User-agent: *\nDisallow: /private\n";
        assert!(robots_disallows_path(robots, "/private/page"));
        assert!(!robots_disallows_path(robots, "/public"));
    }

    #[test]
    fn extract_semantic_from_sample_html() {
        let html = r#"<!DOCTYPE html><html><head><title>News</title></head>
<body><h1>Headline</h1><p>This is a long enough paragraph for extraction testing here.</p>
<a href="https://example.com/x">Link</a><img src="/img.png" alt="pic"></body></html>"#;
        let base = Url::parse("https://news.example.com/article").unwrap();
        let r = extract_semantic_content(html, &base);
        assert_eq!(r.title, "News");
        assert_eq!(r.headings.len(), 1);
        assert!(!r.paragraphs.is_empty());
        assert!(r.links.iter().any(|l| l.href.contains("example.com")));
        assert!(r.images.iter().any(|i| i.src.contains("img.png")));
    }
}
