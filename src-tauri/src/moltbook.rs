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

fn extract_submolts_array(body: &Value) -> Vec<Value> {
    if let Some(arr) = body.as_array() {
        return arr.clone();
    }
    for key in ["submolts", "communities", "results", "data"] {
        if let Some(arr) = body.get(key).and_then(|v| v.as_array()) {
            return arr.clone();
        }
        if let Some(arr) = body
            .get(key)
            .and_then(|v| v.get("submolts"))
            .and_then(|v| v.as_array())
        {
            return arr.clone();
        }
    }
    if let Some(data) = body.get("data") {
        if let Some(arr) = data.get("submolts").and_then(|v| v.as_array()) {
            return arr.clone();
        }
    }
    Vec::new()
}

/// Moltbook wraps lists in several shapes (`[]`, `{data:[]}`, `{data:{posts:[]}}`, `{posts:[]}`,
/// `{results:[]}` for semantic search).
fn extract_posts_array(body: &Value) -> Vec<Value> {
    if let Some(arr) = body.as_array() {
        return arr.iter().map(normalize_list_item).collect();
    }
    if let Some(arr) = body.get("posts").and_then(|v| v.as_array()) {
        return arr.iter().map(normalize_list_item).collect();
    }
    if let Some(arr) = body.get("comments").and_then(|v| v.as_array()) {
        return arr.iter().map(normalize_list_item).collect();
    }
    // Official semantic search: `{ "results": [ { type, title, content, ... }, ... ] }`
    if let Some(arr) = body.get("results").and_then(|v| v.as_array()) {
        return arr.iter().map(normalize_list_item).collect();
    }
    if let Some(arr) = body
        .get("results")
        .and_then(|v| v.get("posts"))
        .and_then(|v| v.as_array())
    {
        return arr.iter().map(normalize_list_item).collect();
    }
    if let Some(data) = body.get("data") {
        if let Some(arr) = data.as_array() {
            return arr.iter().map(normalize_list_item).collect();
        }
        if let Some(arr) = data.get("posts").and_then(|v| v.as_array()) {
            return arr.iter().map(normalize_list_item).collect();
        }
        if let Some(arr) = data.get("comments").and_then(|v| v.as_array()) {
            return arr.iter().map(normalize_list_item).collect();
        }
        if let Some(arr) = data.get("results").and_then(|v| v.as_array()) {
            return arr.iter().map(normalize_list_item).collect();
        }
    }
    Vec::new()
}

/// Normalize search hits (posts + comments) into a post-like object the UI/tools can display.
fn normalize_list_item(raw: &Value) -> Value {
    let mut obj = match raw.as_object() {
        Some(o) => o.clone(),
        None => return raw.clone(),
    };
    let item_type = obj
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("post")
        .to_string();
    if item_type == "comment" {
        // Prefer parent post id for opening the thread; keep comment id for replies.
        if let Some(pid) = obj
            .get("post_id")
            .and_then(|v| v.as_str())
            .or_else(|| {
                obj.get("post")
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
            })
            .map(str::to_string)
        {
            obj.insert("thread_post_id".into(), Value::String(pid.clone()));
            // Panel opens comments by post id — surface parent as primary id when title missing.
            if obj.get("title").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                let parent_title = obj
                    .get("post")
                    .and_then(|p| p.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Comment");
                obj.insert(
                    "title".into(),
                    Value::String(format!("💬 {parent_title}")),
                );
                obj.insert("id".into(), Value::String(pid));
            }
        }
    }
    if let Some(score) = obj.get("upvotes").cloned() {
        obj.entry("score".to_string()).or_insert(score);
    }
    Value::Object(obj)
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

pub(crate) async fn mb_get(
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

pub(crate) async fn mb_post(
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
    if let Some(obj) = sanitized.as_object_mut() {
        obj.insert("api_key".into(), Value::String("(saved to encrypted settings)".into()));
    }
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
        .or_else(|| state.settings.moltbook_preferred_submolt())
        .ok_or_else(|| {
            "submolt is required when no preferred community is set in Settings (agent should pick one)"
                .to_string()
        })?;
    let body = json!({
        "type": "text",
        "title": title,
        "content": content,
        "submolt": target,
        "submolt_name": target,
    });
    let resp = mb_post(&state.http, &state.settings, "/posts", &body).await?;
    let outcome = crate::moltbook_verify::complete_verification_if_needed(
        &state.http,
        &state.settings,
        &resp,
    )
    .await;
    if !outcome.is_verified() {
        return Err(outcome.summary());
    }
    Ok(json!({
        "response": resp,
        "verification": outcome.summary(),
        "verificationStatus": outcome.status_label(),
    }))
}

#[tauri::command]
pub async fn moltbook_search(
    query: String,
    limit: Option<u32>,
    search_type: Option<String>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Err("search query is required".into());
    }
    let limit = limit.unwrap_or(25).clamp(1, 100).to_string();
    let stype = search_type
        .as_deref()
        .map(str::trim)
        .filter(|s| ["posts", "comments", "all"].contains(s))
        .unwrap_or("posts")
        .to_string();
    let body = mb_get(
        &state.http,
        &state.settings,
        "/search",
        &[("q", q), ("limit", limit), ("type", stype)],
    )
    .await?;
    Ok(json!({ "posts": extract_posts_array(&body) }))
}

#[tauri::command]
pub async fn moltbook_home(state: State<'_, NovaState>) -> Result<Value, String> {
    fetch_home(&state.http, &state.settings).await
}

#[tauri::command]
pub async fn moltbook_list_submolts(state: State<'_, NovaState>) -> Result<Value, String> {
    let body = mb_get(&state.http, &state.settings, "/submolts", &[]).await?;
    Ok(json!({ "submolts": extract_submolts_array(&body) }))
}

/// Shared by IPC and the reply-watcher scheduler.
pub async fn fetch_home(
    http: &reqwest::Client,
    settings: &SettingsManager,
) -> Result<Value, String> {
    mb_get(http, settings, "/home", &[]).await
}

#[tauri::command]
pub async fn moltbook_post_comments(
    post_id: String,
    sort: Option<String>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&post_id)?;
    let sort = sort
        .as_deref()
        .map(str::trim)
        .filter(|s| ["best", "top", "new", "old"].contains(s))
        .unwrap_or("new")
        .to_string();
    let body = mb_get(
        &state.http,
        &state.settings,
        &format!("/posts/{id}/comments"),
        &[("sort", sort), ("limit", "50".into())],
    )
    .await?;
    Ok(json!({ "comments": extract_posts_array(&body) }))
}

#[tauri::command]
pub async fn moltbook_create_comment(
    post_id: String,
    content: String,
    parent_id: Option<String>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&post_id)?;
    let content: String = content.trim().chars().take(MAX_CONTENT_LEN).collect();
    if content.is_empty() {
        return Err("comment content is required".into());
    }
    let mut body = json!({ "content": content });
    if let Some(pid) = parent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let parent = sanitize_id(pid)?;
        body
            .as_object_mut()
            .unwrap()
            .insert("parent_id".into(), Value::String(parent));
    }
    let resp = mb_post(
        &state.http,
        &state.settings,
        &format!("/posts/{id}/comments"),
        &body,
    )
    .await?;
    let outcome = crate::moltbook_verify::complete_verification_if_needed(
        &state.http,
        &state.settings,
        &resp,
    )
    .await;
    if !outcome.is_verified() {
        return Err(outcome.summary());
    }
    Ok(json!({
        "response": resp,
        "verification": outcome.summary(),
        "verificationStatus": outcome.status_label(),
    }))
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

#[tauri::command]
pub async fn moltbook_upvote_comment(
    comment_id: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&comment_id)?;
    mb_post(
        &state.http,
        &state.settings,
        &format!("/comments/{id}/upvote"),
        &json!({}),
    )
    .await
}

#[tauri::command]
pub async fn moltbook_mark_notifications_read(
    post_id: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&post_id)?;
    mb_post(
        &state.http,
        &state.settings,
        &format!("/notifications/read-by-post/{id}"),
        &json!({}),
    )
    .await
}

#[tauri::command]
pub async fn moltbook_dm_check(state: State<'_, NovaState>) -> Result<Value, String> {
    // Prefer dedicated check endpoint; fall back to conversations list.
    match mb_get(&state.http, &state.settings, "/dms/check", &[]).await {
        Ok(v) => Ok(v),
        Err(_) => mb_get(&state.http, &state.settings, "/dms/conversations", &[("limit", "20".into())]).await,
    }
}

#[tauri::command]
pub async fn moltbook_dm_conversations(
    limit: Option<u32>,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let limit = limit.unwrap_or(20).clamp(1, 50).to_string();
    mb_get(
        &state.http,
        &state.settings,
        "/dms/conversations",
        &[("limit", limit)],
    )
    .await
}

#[tauri::command]
pub async fn moltbook_dm_send(
    conversation_id: String,
    message: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let id = sanitize_id(&conversation_id)?;
    let message: String = message.trim().chars().take(MAX_CONTENT_LEN).collect();
    if message.is_empty() {
        return Err("DM message is required".into());
    }
    mb_post(
        &state.http,
        &state.settings,
        &format!("/dms/conversations/{id}"),
        &json!({ "message": message, "content": message }),
    )
    .await
}

#[tauri::command]
pub async fn moltbook_follow_agent(
    agent_name: String,
    state: State<'_, NovaState>,
) -> Result<Value, String> {
    let name = agent_name.trim();
    if name.is_empty() {
        return Err("agent name is required".into());
    }
    // Official follow is typically POST /agents/{name}/follow
    let path = format!(
        "/agents/{}/follow",
        urlencoding_simple(name)
    );
    mb_post(&state.http, &state.settings, &path, &json!({})).await
}

fn urlencoding_simple(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_string()
            } else {
                format!("%{:02X}", c as u8)
            }
        })
        .collect()
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
            name: "moltbook_home".into(),
            description: Some(
                "Check your Moltbook dashboard (GET /home): unread notifications, activity on your posts, DMs, and what to do next. Call this first on every engage or reply check-in.".into(),
            ),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "moltbook_feed".into(),
            description: Some(
                "Read recent posts from Moltbook. Optionally filter by submolt and sort (hot, new, top, rising).".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "sort": { "type": "string", "enum": ["hot", "new", "top", "rising"], "description": "Feed sort order (default hot)." },
                    "submolt": { "type": "string", "description": "Optional community name, e.g. 'general'." },
                    "limit": { "type": "integer", "description": "Number of posts (1-50, default 10)." }
                }
            }),
        },
        ToolDefinition {
            name: "moltbook_search".into(),
            description: Some(
                "Semantic search across Moltbook posts and comments. Natural language works best.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural-language search query." },
                    "limit": { "type": "integer", "description": "Number of results (1-25, default 10)." },
                    "type": { "type": "string", "enum": ["posts", "comments", "all"], "description": "What to search (default all)." }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "moltbook_get_comments".into(),
            description: Some(
                "Read comments on a Moltbook post. Use sort=new when responding to recent replies.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "post_id": { "type": "string" },
                    "sort": { "type": "string", "enum": ["best", "top", "new", "old"] },
                    "limit": { "type": "integer" }
                },
                "required": ["post_id"]
            }),
        },
        ToolDefinition {
            name: "moltbook_create_post".into(),
            description: Some(
                "Publish a text post to Moltbook. Always pass submolt (community name, e.g. 'general' or 'philosophy') \
                 unless Settings has a preferred default — then submolt is optional and you may still override it. \
                 Completes verification automatically; only reports success when verification_status is verified. \
                 Rate limited to 1 post per 30 minutes."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "content": { "type": "string" },
                    "submolt": {
                        "type": "string",
                        "description": "Community to post in (e.g. general, philosophy). Choose the best fit yourself when no preferred default is configured."
                    }
                },
                "required": ["title", "content"]
            }),
        },
        ToolDefinition {
            name: "moltbook_list_submolts".into(),
            description: Some(
                "List Moltbook communities (submolts) you can post in. Use this when choosing where to publish."
                    .into(),
            ),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "moltbook_comment".into(),
            description: Some(
                "Comment on a Moltbook post. Pass parent_id to reply to a specific comment (threaded replies). Max 50 comments/hour. Verification challenges are solved automatically.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "post_id": { "type": "string" },
                    "content": { "type": "string" },
                    "parent_id": { "type": "string", "description": "Optional parent comment id for a threaded reply." }
                },
                "required": ["post_id", "content"]
            }),
        },
        ToolDefinition {
            name: "moltbook_upvote".into(),
            description: Some(
                "Upvote a Moltbook post or comment. Provide post_id and/or comment_id.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "post_id": { "type": "string" },
                    "comment_id": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "moltbook_mark_notifications_read".into(),
            description: Some(
                "Mark notifications for a post as read after you have responded. Call after replying to activity on your posts.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "post_id": { "type": "string" }
                },
                "required": ["post_id"]
            }),
        },
        ToolDefinition {
            name: "moltbook_dm_check".into(),
            description: Some(
                "Check Moltbook direct messages: unread counts, pending requests, and recent conversations.".into(),
            ),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "moltbook_dm_send".into(),
            description: Some(
                "Send a message in an existing Moltbook DM conversation.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "conversation_id": { "type": "string" },
                    "message": { "type": "string" }
                },
                "required": ["conversation_id", "message"]
            }),
        },
        ToolDefinition {
            name: "moltbook_follow".into(),
            description: Some(
                "Follow another Moltbook agent by name when you genuinely enjoy their content.".into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "agent_name": { "type": "string" }
                },
                "required": ["agent_name"]
            }),
        },
    ]
}

pub fn is_moltbook_tool_name(name: &str) -> bool {
    matches!(
        name,
        "moltbook_home"
            | "moltbook_feed"
            | "moltbook_search"
            | "moltbook_get_comments"
            | "moltbook_create_post"
            | "moltbook_list_submolts"
            | "moltbook_comment"
            | "moltbook_upvote"
            | "moltbook_mark_notifications_read"
            | "moltbook_dm_check"
            | "moltbook_dm_send"
            | "moltbook_follow"
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
        let submolt = p
            .get("submolt")
            .and_then(|v| v.as_str())
            .or_else(|| p.get("submolt").and_then(|v| v.get("name")).and_then(|v| v.as_str()))
            .unwrap_or("?");
        let score = p
            .get("score")
            .and_then(|v| v.as_i64())
            .or_else(|| p.get("upvotes").and_then(|v| v.as_i64()))
            .unwrap_or(0);
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
        let sim = p
            .get("similarity")
            .and_then(|v| v.as_f64())
            .map(|s| format!(" · sim={s:.2}"))
            .unwrap_or_default();
        out.push_str(&format!(
            "{}. [{score}] {title}\n   id={id} · m/{submolt} · by {author} · {comments} comments{sim}\n",
            i + 1
        ));
        if !snippet.trim().is_empty() {
            out.push_str(&format!("   {}\n", snippet.replace('\n', " ")));
        }
    }
    out
}

fn summarize_comments(body: &Value, limit: usize) -> String {
    let items = extract_posts_array(body);
    if items.is_empty() {
        return format!("No comments. Raw: {body}");
    }
    let mut out = String::new();
    for (i, c) in items.iter().take(limit).enumerate() {
        let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("?");
        let author = c
            .get("author")
            .and_then(|a| a.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let content: String = c
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .chars()
            .take(400)
            .collect();
        out.push_str(&format!("{}. id={id} by {author}\n   {content}\n", i + 1));
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
        "moltbook_home" => {
            let body = mb_get(http, settings, "/home", &[])
                .await
                .map_err(tool_err)?;
            Ok(format!("Moltbook /home:\n{body}"))
        }
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
            let stype = args
                .get("type")
                .and_then(|v| v.as_str())
                .filter(|s| ["posts", "comments", "all"].contains(s))
                .unwrap_or("all");
            let body = mb_get(
                http,
                settings,
                "/search",
                &[
                    ("q", q.to_string()),
                    ("limit", limit.to_string()),
                    ("type", stype.to_string()),
                ],
            )
            .await
            .map_err(tool_err)?;
            Ok(summarize_posts(&body, limit as usize))
        }
        "moltbook_get_comments" => {
            let post_id = args.get("post_id").and_then(|v| v.as_str()).unwrap_or("");
            let id = sanitize_id(post_id).map_err(tool_err)?;
            let sort = args
                .get("sort")
                .and_then(|v| v.as_str())
                .filter(|s| ["best", "top", "new", "old"].contains(s))
                .unwrap_or("new");
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(35)
                .clamp(1, 50);
            let body = mb_get(
                http,
                settings,
                &format!("/posts/{id}/comments"),
                &[("sort", sort.into()), ("limit", limit.to_string())],
            )
            .await
            .map_err(tool_err)?;
            Ok(summarize_comments(&body, limit as usize))
        }
        "moltbook_list_submolts" => {
            let body = mb_get(http, settings, "/submolts", &[])
                .await
                .map_err(tool_err)?;
            let items = extract_submolts_array(&body);
            if items.is_empty() {
                return Ok(format!("No submolts returned. Raw: {body}"));
            }
            let mut out = String::from("Available submolts:\n");
            for (i, s) in items.iter().take(80).enumerate() {
                let name = s
                    .get("name")
                    .and_then(|v| v.as_str())
                    .or_else(|| s.get("submolt").and_then(|v| v.as_str()))
                    .unwrap_or("?");
                let display = s
                    .get("display_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(name);
                let desc: String = s
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .chars()
                    .take(120)
                    .collect();
                out.push_str(&format!("{}. m/{name} — {display}", i + 1));
                if !desc.is_empty() {
                    out.push_str(&format!(" ({desc})"));
                }
                out.push('\n');
            }
            Ok(out)
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
                .or_else(|| settings.moltbook_preferred_submolt())
                .ok_or_else(|| {
                    tool_err(
                        "moltbook_create_post requires submolt (no preferred community in Settings). \
                         Call moltbook_list_submolts, then pick the best community yourself.",
                    )
                })?;
            let body = json!({
                "type": "text",
                "title": title.chars().take(MAX_TITLE_LEN).collect::<String>(),
                "content": content.chars().take(MAX_CONTENT_LEN).collect::<String>(),
                "submolt": submolt,
                "submolt_name": submolt,
            });
            let resp = mb_post(http, settings, "/posts", &body)
                .await
                .map_err(tool_err)?;
            let id = resp
                .get("id")
                .and_then(|v| v.as_str())
                .or_else(|| resp.get("post").and_then(|p| p.get("id")).and_then(|v| v.as_str()))
                .unwrap_or("?")
                .to_string();
            let title_out: String = title.chars().take(80).collect();
            let outcome =
                crate::moltbook_verify::complete_verification_if_needed(http, settings, &resp)
                    .await;
            let confirmed = if outcome.is_verified() {
                crate::moltbook_verify::confirm_content_verified(http, settings, "post", &id)
                    .await
            } else {
                None
            };
            if !outcome.is_verified() {
                return Err(tool_err(format!(
                    "Post created in m/{submolt} (id {id}, title {title_out:?}) but NOT published. {}. \
                     Do not tell the user it was posted — it is invisible until verified.",
                    outcome.summary()
                )));
            }
            if confirmed.as_deref() == Some("failed") {
                return Err(tool_err(format!(
                    "Post {id} verify API returned success but post verification_status=failed. {}",
                    outcome.summary()
                )));
            }
            let status = confirmed.unwrap_or_else(|| "verified".into());
            Ok(format!(
                "Published to m/{submolt} (post id {id}, title {title_out:?}). \
                 verification_status={status}. {}",
                outcome.summary()
            ))
        }
        "moltbook_comment" => {
            let post_id = args.get("post_id").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("").trim();
            let id = sanitize_id(post_id).map_err(tool_err)?;
            if content.is_empty() {
                return Err(tool_err("moltbook_comment requires content"));
            }
            let mut payload = json!({
                "content": content.chars().take(MAX_CONTENT_LEN).collect::<String>()
            });
            if let Some(parent) = args.get("parent_id").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
                let pid = sanitize_id(parent).map_err(tool_err)?;
                payload.as_object_mut().unwrap().insert("parent_id".into(), Value::String(pid));
            }
            let resp = mb_post(
                http,
                settings,
                &format!("/posts/{id}/comments"),
                &payload,
            )
            .await
            .map_err(tool_err)?;
            let cid = resp
                .get("id")
                .and_then(|v| v.as_str())
                .or_else(|| resp.get("comment").and_then(|c| c.get("id")).and_then(|v| v.as_str()))
                .unwrap_or("?")
                .to_string();
            let outcome =
                crate::moltbook_verify::complete_verification_if_needed(http, settings, &resp)
                    .await;
            let confirmed = if outcome.is_verified() {
                crate::moltbook_verify::confirm_content_verified(http, settings, "comment", &cid)
                    .await
            } else {
                None
            };
            if !outcome.is_verified() {
                return Err(tool_err(format!(
                    "Comment created on {id} (comment id {cid}) but NOT published. {}. \
                     Do not claim the comment is live.",
                    outcome.summary()
                )));
            }
            if confirmed.as_deref() == Some("failed") {
                return Err(tool_err(format!(
                    "Comment {cid} verify API returned success but verification_status=failed. {}",
                    outcome.summary()
                )));
            }
            let status = confirmed.unwrap_or_else(|| "verified".into());
            Ok(format!(
                "Comment published on {id} (comment id {cid}). verification_status={status}. {}",
                outcome.summary()
            ))
        }
        "moltbook_upvote" => {
            let mut parts = Vec::new();
            if let Some(post_id) = args.get("post_id").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
                let id = sanitize_id(post_id).map_err(tool_err)?;
                mb_post(http, settings, &format!("/posts/{id}/upvote"), &json!({}))
                    .await
                    .map_err(tool_err)?;
                parts.push(format!("upvoted post {id}"));
            }
            if let Some(comment_id) = args.get("comment_id").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
                let id = sanitize_id(comment_id).map_err(tool_err)?;
                mb_post(http, settings, &format!("/comments/{id}/upvote"), &json!({}))
                    .await
                    .map_err(tool_err)?;
                parts.push(format!("upvoted comment {id}"));
            }
            if parts.is_empty() {
                return Err(tool_err("moltbook_upvote requires post_id and/or comment_id"));
            }
            Ok(parts.join("; "))
        }
        "moltbook_mark_notifications_read" => {
            let post_id = args.get("post_id").and_then(|v| v.as_str()).unwrap_or("");
            let id = sanitize_id(post_id).map_err(tool_err)?;
            mb_post(
                http,
                settings,
                &format!("/notifications/read-by-post/{id}"),
                &json!({}),
            )
            .await
            .map_err(tool_err)?;
            Ok(format!("Marked notifications read for post {id}."))
        }
        "moltbook_dm_check" => {
            let body = match mb_get(http, settings, "/dms/check", &[]).await {
                Ok(v) => v,
                Err(_) => mb_get(
                    http,
                    settings,
                    "/dms/conversations",
                    &[("limit", "20".into())],
                )
                .await
                .map_err(tool_err)?,
            };
            Ok(format!("Moltbook DMs:\n{body}"))
        }
        "moltbook_dm_send" => {
            let cid = args
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let message = args.get("message").and_then(|v| v.as_str()).unwrap_or("").trim();
            let id = sanitize_id(cid).map_err(tool_err)?;
            if message.is_empty() {
                return Err(tool_err("moltbook_dm_send requires message"));
            }
            mb_post(
                http,
                settings,
                &format!("/dms/conversations/{id}"),
                &json!({ "message": message, "content": message }),
            )
            .await
            .map_err(tool_err)?;
            Ok(format!("DM sent in conversation {id}."))
        }
        "moltbook_follow" => {
            let name = args
                .get("agent_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if name.is_empty() {
                return Err(tool_err("moltbook_follow requires agent_name"));
            }
            let path = format!("/agents/{}/follow", urlencoding_simple(name));
            mb_post(http, settings, &path, &json!({}))
                .await
                .map_err(tool_err)?;
            Ok(format!("Now following {name}."))
        }
        other => Err(tool_err(format!("unknown Moltbook tool: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_posts_array, normalize_submolt, sanitize_id};
    use serde_json::json;

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
    fn extract_search_results_array() {
        let body = json!({
            "success": true,
            "results": [
                { "id": "abc", "type": "post", "title": "Hello", "content": "world", "upvotes": 3 }
            ]
        });
        let items = extract_posts_array(&body);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].get("title").and_then(|v| v.as_str()), Some("Hello"));
        assert_eq!(items[0].get("score").and_then(|v| v.as_i64()), Some(3));
    }
}
