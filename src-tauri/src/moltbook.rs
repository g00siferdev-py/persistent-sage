//! Moltbook integration — the social network for AI agents (moltbook.com).
//!
//! Talks to the Moltbook REST API (default base `https://www.moltbook.com/api/v1`)
//! with the Bearer API key stored in encrypted settings (slot `moltbook`).
//! Exposes both direct IPC commands for the UI (feed browser, share-to-Moltbook)
//! and optional agent tools so the companion itself can read and post.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::provider::{ProviderError, ToolDefinition};
use crate::settings::SettingsManager;
use crate::NovaState;

const MAX_TITLE_LEN: usize = 300;
const MAX_CONTENT_LEN: usize = 40_000;
const API_KEY_REDACTION: &str = "(saved to encrypted settings)";

// --- HTTP helpers --------------------------------------------------------------

fn base_url(settings: &SettingsManager) -> String {
    settings.moltbook_base_url().trim_end_matches('/').to_string()
}

fn api_key(settings: &SettingsManager) -> Result<String, String> {
    settings
        .decrypt_api_key("moltbook")
        .map_err(|e| format!("could not read Moltbook API key: {e}"))?
        .ok_or_else(|| {
            "No Moltbook API key saved. Register an agent or paste a key in Settings → Tools → Moltbook."
                .to_string()
        })
}

fn normalize_submolt(raw: &str) -> String {
    raw.trim().trim_start_matches("m/").trim().to_string()
}

/// Remove API keys from an API response before it crosses the IPC boundary.
///
/// Moltbook currently nests the registration key under `agent.api_key`, but
/// recursively redact both snake_case and camelCase fields so response-shape
/// changes cannot accidentally expose the credential to the webview.
fn redact_api_keys(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if key.eq_ignore_ascii_case("api_key") || key.eq_ignore_ascii_case("apiKey") {
                    *child = Value::String(API_KEY_REDACTION.into());
                } else {
                    redact_api_keys(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                redact_api_keys(item);
            }
        }
        _ => {}
    }
}

/// Moltbook wraps lists in several shapes (`[]`, `{data:[]}`, `{data:{posts:[]}}`, `{posts:[]}`).
fn extract_posts_array(body: &Value) -> Vec<Value> {
    if let Some(arr) = body.as_array() {
        return arr.clone();
    }
    if let Some(arr) = body.get("posts").and_then(|v| v.as_array()) {
        return arr.clone();
    }
    if let Some(arr) = body.get("comments").and_then(|v| v.as_array()) {
        return arr.clone();
    }
    if let Some(data) = body.get("data") {
        if let Some(arr) = data.as_array() {
            return arr.clone();
        }
        if let Some(arr) = data.get("posts").and_then(|v| v.as_array()) {
            return arr.clone();
        }
        if let Some(arr) = data.get("comments").and_then(|v| v.as_array()) {
            return arr.clone();
        }
    }
    if let Some(arr) = body
        .get("results")
        .and_then(|v| v.get("posts"))
        .and_then(|v| v.as_array())
    {
        return arr.clone();
    }
    Vec::new()
}

/// Prefer a flat agent profile object for the UI (`{name, karma, ...}`).
fn unwrap_agent_profile(body: Value) -> Value {
    if body.get("name").and_then(|v| v.as_str()).is_some() {
        return body;
    }
    body.get("agent")
        .cloned()
        .or_else(|| body.get("data").and_then(|d| d.get("agent")).cloned())
        .or_else(|| body.get("data").cloned())
        .unwrap_or(body)
}

async fn parse_response(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let retry_after = resp
        .headers()
        .get("Retry-After")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let text = resp.text().await.map_err(|e| format!("Moltbook response read failed: {e}"))?;
    let body: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
    if status.is_success() {
        return Ok(body);
    }
    let detail = body
        .get("error")
        .and_then(|v| v.as_str())
        .or_else(|| body.get("message").and_then(|v| v.as_str()))
        .unwrap_or("");
    let msg = match status.as_u16() {
        401 => "Moltbook rejected the API key (401). Re-save your key in Settings → Tools → Moltbook.".to_string(),
        403 => format!("Moltbook permission denied (403). {detail}"),
        404 => format!("Moltbook resource not found (404). {detail}"),
        429 => format!(
            "Moltbook rate limit hit (429){}. Limits: 100 requests/min, 1 post per 30 min, 50 comments/hour. {detail}",
            retry_after
                .map(|s| format!(", retry after {s}s"))
                .unwrap_or_default()
        ),
        code => format!("Moltbook API error {code}. {detail}"),
    };
    Err(msg.trim().to_string())
}

async fn mb_get(
    http: &reqwest::Client,
    settings: &SettingsManager,
    path: &str,
    query: &[(&str, String)],
) -> Result<Value, String> {
    let key = api_key(settings)?;
    let url = format!("{}{}", base_url(settings), path);
    let resp = http
        .get(&url)
        .bearer_auth(key)
        .query(query)
        .send()
        .await
        .map_err(|e| format!("Moltbook request failed: {e}"))?;
    parse_response(resp).await
}

async fn mb_post(
    http: &reqwest::Client,
    settings: &SettingsManager,
    path: &str,
    body: &Value,
) -> Result<Value, String> {
    let key = api_key(settings)?;
    let url = format!("{}{}", base_url(settings), path);
    let resp = http
        .post(&url)
        .bearer_auth(key)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Moltbook request failed: {e}"))?;
    parse_response(resp).await
}

// --- IPC commands ---------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoltbookStatus {
    pub enabled: bool,
    pub has_api_key: bool,
    pub base_url: String,
    pub default_submolt: String,
    pub agent_tools_enabled: bool,
}

#[tauri::command]
pub fn moltbook_status(state: State<'_, NovaState>) -> Result<MoltbookStatus, String> {
    let view = state.settings.view().map_err(|e| e.to_string())?;
    Ok(MoltbookStatus {
        enabled: view.moltbook_enabled,
        has_api_key: view.has_moltbook_api_key,
        base_url: view.moltbook_base_url,
        default_submolt: view.moltbook_default_submolt,
        agent_tools_enabled: view.moltbook_agent_tools_enabled,
    })
}

/// Register a brand-new Moltbook agent (no auth). On success the returned
/// API key is saved into encrypted settings automatically.
#[tauri::command]
pub async fn moltbook_register_agent(
    name: String,
    description: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("agent name is required".into());
    }
    let url = format!("{}/agents/register", base_url(&state.settings));
    let resp = state
        .http
        .post(&url)
        .json(&json!({ "name": n, "description": description.trim() }))
        .send()
        .await
        .map_err(|e| format!("Moltbook registration failed: {e}"))?;
    let body = parse_response(resp).await?;
    let key = body
        .get("api_key")
        .and_then(|v| v.as_str())
        .or_else(|| {
            body.get("agent")
                .and_then(|a| a.get("api_key"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("");
    if key.is_empty() {
        return Err(format!(
            "Moltbook registration did not return an api_key. Response: {body}"
        ));
    }
    state
        .settings
        .save_api_key("moltbook", key)
        .map_err(|e| format!("registered, but saving the API key failed: {e}"))?;
    // Never echo the raw key back to the UI; it is already stored encrypted.
    let mut sanitized = body;
    redact_api_keys(&mut sanitized);
    Ok(sanitized)
}

/// Verify connectivity + key by fetching the agent's own profile.
#[tauri::command]
pub async fn moltbook_me(state: State<'_, NovaState>) -> Result<Value, String> {
    let body = mb_get(&state.http, &state.settings, "/agents/me", &[]).await?;
    Ok(unwrap_agent_profile(body))
}

/// Claim / verification status for the registered agent (claim URL, pending, etc.).
#[tauri::command]
pub async fn moltbook_agent_status(state: State<'_, NovaState>) -> Result<Value, String> {
    mb_get(&state.http, &state.settings, "/agents/status", &[]).await
}

#[tauri::command]
pub async fn moltbook_feed(
    sort: Option<String>,
    limit: Option<u32>,
    submolt: Option<String>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let sort = sort
        .as_deref()
        .map(str::trim)
        .filter(|s| ["hot", "new", "top", "rising"].contains(s))
        .unwrap_or("hot")
        .to_string();
    let limit = limit.unwrap_or(25).clamp(1, 100).to_string();
    let mut query: Vec<(&str, String)> = vec![("sort", sort), ("limit", limit)];
    if let Some(s) = submolt.as_deref().map(normalize_submolt).filter(|s| !s.is_empty()) {
        query.push(("submolt", s));
    }
    let body = mb_get(&state.http, &state.settings, "/posts", &query).await?;
    // Always return a flat list the UI can map over.
    Ok(json!({ "posts": extract_posts_array(&body) }))
}

#[tauri::command]
pub async fn moltbook_create_post(
    title: String,
    content: String,
    submolt: Option<String>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let title: String = title.trim().chars().take(MAX_TITLE_LEN).collect();
    let content: String = content.trim().chars().take(MAX_CONTENT_LEN).collect();
    if title.is_empty() {
        return Err("post title is required".into());
    }
    if content.is_empty() {
        return Err("post content is required".into());
    }
    let target = submolt
        .as_deref()
        .map(normalize_submolt)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| state.settings.moltbook_default_submolt());
    let body = json!({
        "type": "text",
        "title": title,
        "content": content,
        "submolt": target,
    });
    mb_post(&state.http, &state.settings, "/posts", &body).await
}

#[tauri::command]
pub async fn moltbook_search(
    query: String,
    limit: Option<u32>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("search query is required".into());
    }
    let limit = limit.unwrap_or(25).clamp(1, 100).to_string();
    let body = mb_get(
        &state.http,
        &state.settings,
        "/search",
        &[("q", q), ("limit", limit)],
    )
    .await?;
    Ok(json!({ "posts": extract_posts_array(&body) }))
}

#[tauri::command]
pub async fn moltbook_post_comments(
    post_id: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&post_id)?;
    let body = mb_get(
        &state.http,
        &state.settings,
        &format!("/posts/{id}/comments"),
        &[("sort", "top".into()), ("limit", "50".into())],
    )
    .await?;
    Ok(json!({ "comments": extract_posts_array(&body) }))
}

#[tauri::command]
pub async fn moltbook_create_comment(
    post_id: String,
    content: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&post_id)?;
    let content: String = content.trim().chars().take(MAX_CONTENT_LEN).collect();
    if content.is_empty() {
        return Err("comment content is required".into());
    }
    mb_post(
        &state.http,
        &state.settings,
        &format!("/posts/{id}/comments"),
        &json!({ "content": content }),
    )
    .await
}

#[tauri::command]
pub async fn moltbook_upvote_post(
    post_id: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&post_id)?;
    mb_post(
        &state.http,
        &state.settings,
        &format!("/posts/{id}/upvote"),
        &json!({}),
    )
    .await
}

/// Ids go into URL paths — restrict to safe characters.
fn sanitize_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() || id.len() > 128 {
        return Err("invalid Moltbook id".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("invalid Moltbook id".into());
    }
    Ok(id.to_string())
}

// --- Agent tools ------------------------------------------------------------------

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "moltbook_feed".into(),
            description: Some(
                "Read recent posts from Moltbook, the social network for AI agents. Optionally filter by submolt (community) and sort (hot, new, top, rising).".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "sort": { "type": "string", "enum": ["hot", "new", "top", "rising"], "description": "Feed sort order (default hot)." },
                    "submolt": { "type": "string", "description": "Optional community name, e.g. 'general' or 'm/aithoughts'." },
                    "limit": { "type": "integer", "description": "Number of posts (1-50, default 10)." }
                }
            }),
        },
        ToolDefinition {
            name: "moltbook_search".into(),
            description: Some(
                "Semantic search across Moltbook posts and comments. Good for finding what other AI agents are discussing about a topic.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural-language search query." },
                    "limit": { "type": "integer", "description": "Number of results (1-25, default 10)." }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "moltbook_create_post".into(),
            description: Some(
                "Publish a text post to Moltbook under the user's registered agent identity. Rate limited to 1 post per 30 minutes — only post when the user explicitly asks you to share something.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Post title (max 300 chars)." },
                    "content": { "type": "string", "description": "Post body (markdown supported)." },
                    "submolt": { "type": "string", "description": "Target community. Omit to use the default submolt from Settings." }
                },
                "required": ["title", "content"]
            }),
        },
        ToolDefinition {
            name: "moltbook_comment".into(),
            description: Some(
                "Comment on a Moltbook post (max 50 comments/hour). Use the post id from moltbook_feed or moltbook_search results.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "post_id": { "type": "string", "description": "Id of the post to comment on." },
                    "content": { "type": "string", "description": "Comment text." }
                },
                "required": ["post_id", "content"]
            }),
        },
    ]
}

pub fn is_moltbook_tool_name(name: &str) -> bool {
    matches!(
        name,
        "moltbook_feed" | "moltbook_search" | "moltbook_create_post" | "moltbook_comment"
    )
}

fn tool_err(msg: impl Into<String>) -> ProviderError {
    ProviderError::Api(msg.into())
}

/// Compact text rendering of feed/search results for the model context.
fn summarize_posts(body: &Value, limit: usize) -> String {
    let items = extract_posts_array(body);
    if items.is_empty() {
        return format!("No posts returned. Raw response: {body}");
    }
    let mut out = String::new();
    for (i, p) in items.iter().take(limit).enumerate() {
        let title = p.get("title").and_then(|v| v.as_str()).unwrap_or("(untitled)");
        let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("?");
        let submolt = p.get("submolt").and_then(|v| v.as_str()).unwrap_or("?");
        let score = p.get("score").and_then(|v| v.as_i64()).unwrap_or(0);
        let author = p
            .get("author")
            .and_then(|a| a.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let comments = p.get("comment_count").and_then(|v| v.as_i64()).unwrap_or(0);
        let snippet: String = p
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .chars()
            .take(280)
            .collect();
        out.push_str(&format!(
            "{}. [{score}] {title}\n   id={id} · m/{submolt} · by {author} · {comments} comments\n",
            i + 1
        ));
        if !snippet.trim().is_empty() {
            out.push_str(&format!("   {}\n", snippet.replace('\n', " ")));
        }
    }
    out
}

pub async fn run_moltbook_tool(
    http: &reqwest::Client,
    settings: &SettingsManager,
    name: &str,
    args: &Value,
) -> Result<String, ProviderError> {
    if !settings.moltbook_enabled() || !settings.moltbook_agent_tools_enabled() {
        return Err(tool_err(
            "Moltbook agent tools are not enabled in Settings → Tools → Moltbook",
        ));
    }
    match name {
        "moltbook_feed" => {
            let sort = args
                .get("sort")
                .and_then(|v| v.as_str())
                .filter(|s| ["hot", "new", "top", "rising"].contains(s))
                .unwrap_or("hot");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(10)
                .clamp(1, 50);
            let mut query: Vec<(&str, String)> =
                vec![("sort", sort.into()), ("limit", limit.to_string())];
            if let Some(s) = args
                .get("submolt")
                .and_then(|v| v.as_str())
                .map(normalize_submolt)
                .filter(|s| !s.is_empty())
            {
                query.push(("submolt", s));
            }
            let body = mb_get(http, settings, "/posts", &query)
                .await
                .map_err(tool_err)?;
            Ok(summarize_posts(&body, limit as usize))
        }
        "moltbook_search" => {
            let q = args.get("query").and_then(|v| v.as_str()).unwrap_or("").trim();
            if q.is_empty() {
                return Err(tool_err("moltbook_search requires a query"));
            }
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(10)
                .clamp(1, 25);
            let body = mb_get(
                http,
                settings,
                "/search",
                &[("q", q.to_string()), ("limit", limit.to_string())],
            )
            .await
            .map_err(tool_err)?;
            Ok(summarize_posts(&body, limit as usize))
        }
        "moltbook_create_post" => {
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("").trim();
            if title.is_empty() || content.is_empty() {
                return Err(tool_err("moltbook_create_post requires title and content"));
            }
            let submolt = args
                .get("submolt")
                .and_then(|v| v.as_str())
                .map(normalize_submolt)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| settings.moltbook_default_submolt());
            let body = json!({
                "type": "text",
                "title": title.chars().take(MAX_TITLE_LEN).collect::<String>(),
                "content": content.chars().take(MAX_CONTENT_LEN).collect::<String>(),
                "submolt": submolt,
            });
            let resp = mb_post(http, settings, "/posts", &body)
                .await
                .map_err(tool_err)?;
            let id = resp
                .get("id")
                .and_then(|v| v.as_str())
                .or_else(|| resp.get("post").and_then(|p| p.get("id")).and_then(|v| v.as_str()))
                .unwrap_or("?");
            Ok(format!("Posted to m/{submolt} (post id {id})."))
        }
        "moltbook_comment" => {
            let post_id = args.get("post_id").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("").trim();
            let id = sanitize_id(post_id).map_err(tool_err)?;
            if content.is_empty() {
                return Err(tool_err("moltbook_comment requires content"));
            }
            let resp = mb_post(
                http,
                settings,
                &format!("/posts/{id}/comments"),
                &json!({ "content": content.chars().take(MAX_CONTENT_LEN).collect::<String>() }),
            )
            .await
            .map_err(tool_err)?;
            let cid = resp.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            Ok(format!("Comment posted on {id} (comment id {cid})."))
        }
        other => Err(tool_err(format!("unknown Moltbook tool: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{normalize_submolt, redact_api_keys, sanitize_id, API_KEY_REDACTION};

    #[test]
    fn normalizes_submolt_prefix() {
        assert_eq!(normalize_submolt(" m/general "), "general");
        assert_eq!(normalize_submolt("aithoughts"), "aithoughts");
    }

    #[test]
    fn sanitize_id_rejects_path_traversal() {
        assert!(sanitize_id("post_abc123").is_ok());
        assert!(sanitize_id("../etc").is_err());
        assert!(sanitize_id("a/b").is_err());
        assert!(sanitize_id("").is_err());
    }

    #[test]
    fn registration_response_redacts_nested_api_keys() {
        let mut body = json!({
            "agent": {
                "api_key": "moltbook_nested_secret",
                "claim_url": "https://www.moltbook.com/claim/example"
            },
            "api_key": "moltbook_top_level_secret",
            "metadata": [{ "apiKey": "moltbook_future_secret" }]
        });

        redact_api_keys(&mut body);

        assert_eq!(body["agent"]["api_key"], API_KEY_REDACTION);
        assert_eq!(body["api_key"], API_KEY_REDACTION);
        assert_eq!(body["metadata"][0]["apiKey"], API_KEY_REDACTION);
        assert_eq!(
            body["agent"]["claim_url"],
            "https://www.moltbook.com/claim/example"
        );
        let rendered = body.to_string();
        assert!(!rendered.contains("moltbook_nested_secret"));
        assert!(!rendered.contains("moltbook_top_level_secret"));
        assert!(!rendered.contains("moltbook_future_secret"));
    }
}
