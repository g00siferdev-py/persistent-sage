//! Chat artifacts: structured HTML / Vega-Lite / Markdown blocks embedded in assistant replies.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::memory::{MessageRole, StoredMessage};

pub const ARTIFACT_FENCE: &str = "artifact";
const MAX_ARTIFACT_JSON_BYTES: usize = 512_000;
const MAX_HTML_BODY_CHARS: usize = 200_000;
const MAX_MARKDOWN_BODY_CHARS: usize = 100_000;

/// Appended to the latest user turn in the model context only (not stored in SQLite).
pub const USER_VISUAL_DELIVERABLE_HINT: &str = r#"

(System: The user wants a visual deliverable. Reply with 1–3 sentences of plain text, then exactly one ```artifact JSON block. Use type "html" for tables/reports (include a labeled CSS/SVG chart inside the HTML when they asked for a graph). Use type "vegaLite" for chart-only requests. Never use ```html, never paste HTML/XML/markdown tables/ASCII charts in chat.)"#;

/// Stronger nudge when the user explicitly asks for a chart/graph.
pub const USER_CHART_DELIVERABLE_HINT: &str = r#"

(System: Chart/graph request. Prefer type "html" with a data table plus inline SVG/CSS bar chart (labeled axes, values on bars, legend for USA/China etc.). If using vegaLite, include complete data.values with numeric GDP/amount fields — e.g. year, country, gdp as numbers. Never send an empty chart spec.)"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCitation {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_start: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_end: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatArtifact {
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub title: String,
    pub body: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub citations: Option<Vec<ArtifactCitation>>,
    /// Links artifact to a collaborative project slug under `workspace/projects/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

/// Instructions appended to the system prompt when artifacts are enabled.
pub const ARTIFACT_SYSTEM_APPENDIX: &str = r#"

## Chat artifacts (required for visual output)

The chat UI **only** renders tables, HTML pages, and charts from fenced **artifact** blocks. Nothing else will display as a report or chart.

### Mandatory behavior
- When the user asks for a table, plan, schedule, report, mockup, HTML page, graph, chart, or diagram: write **1–3 sentences** of normal prose, then append **exactly one** ```artifact fence with valid JSON.
- **Never** put HTML, XML, markdown tables, multi-line layouts, or ASCII/text “graphs” in the conversational reply.
- **Never** use ```html, ```json, or generic ``` fences for deliverables — only ```artifact with JSON.
- For **charts and graphs**, prefer **one** `type: "html"` artifact with a labeled table plus an inline **SVG or CSS bar chart** (most reliable). `vegaLite` is allowed only when you also include complete `data.values` with numeric fields.
- If they want **both** a table and a chart, use **one** `type: "html"` artifact (table + SVG/CSS chart).

### Artifact JSON shape
```artifact
{
  "type": "html" | "vegaLite" | "markdown" | "form",
  "title": "Short title",
  "projectId": "optional-project-slug",
  "body": "<full miniature HTML document | vega spec object | markdown | form fields>",
  "caption": "optional one-line note",
  "citations": [{"path": "workspace/relative/path", "lineStart": 1, "lineEnd": 10, "label": "optional"}]
}
```

### Type rules
- **html**: complete `<!DOCTYPE html>…</html>` with inline `<style>` only; no `<script>`, no external URLs, no inline event handlers.
- **vegaLite**: Vega-Lite spec object with inline `"data": {"values": [...]}` only.
- **form**: `body.fields` with stable `id`, `label`, `kind` (text|textarea|number|checkbox|select|radio). For `select`/`radio`, `options` must be strings or `{"label","value"}` objects — not bare `{}`.
- **markdown**: short formatted notes only — not substitutes for tables/charts.

### Chart quality (HTML/SVG strongly preferred)
- **Default for charts:** `type: "html"` with a `<table>` of the data plus an inline `<svg>` bar/line chart (labeled axes, values on bars/points, legend for multiple series). The app also polishes `vegaLite` artifacts into SVG charts when `data.values` is present.
- **vegaLite** only if you cannot use HTML; body must include `"data": {"values": [{"year":"2023","country":"USA","gdp":27.4}, ...]}` with real numbers.
- Use **realistic numeric data** tied to the user’s topic (not placeholders like 1,2,3 unless appropriate).
- Always set a **chart title** and **axis titles** (e.g. "Day of week", "Minutes") — never leave axes unlabeled.
- Prefer **bar** or **line** charts for comparisons over time; use **color** only when a legend is needed.
- For Vega-Lite bar charts, include readable **data labels** (e.g. a `layer` with `mark: {"type":"text","dy":-6}` encoding `text` on the value field) when values are few.
- For **grouped** bars (e.g. USA vs China by year): use `color` + `xOffset` on country — do **not** put `axis` on `color`.
- Example grouped bar (adapt fields/data to the request):
```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "title": "GDP by year",
  "data": {"values": [
    {"year": "2022", "country": "USA", "gdp": 25.5},
    {"year": "2022", "country": "China", "gdp": 18.0}
  ]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "year", "type": "ordinal", "axis": {"title": "Year"}},
    "y": {"field": "gdp", "type": "quantitative", "axis": {"title": "GDP (trillions USD)"}},
    "color": {"field": "country", "type": "nominal", "legend": {"title": "Country"}},
    "xOffset": {"field": "country"}
  }
}
```

### Source code (exception)
- Use a normal markdown **code block** (e.g. ```python) **only** when the user explicitly asks for **programming source code** to copy. That is not an artifact.
"#;

/// True when the user message implies HTML/table/chart output (not programming homework).
#[must_use]
pub fn user_requests_visual_deliverable(message: &str) -> bool {
    if user_requests_source_code(message) {
        return false;
    }
    let m = message.to_ascii_lowercase();
    const KEYS: &[&str] = &[
        "html",
        "table",
        "chart",
        "graph",
        "plot",
        "diagram",
        "mockup",
        "visualiz",
        "spreadsheet",
        "worksheet",
        "calendar",
        "schedule",
        "workout",
        "exercise plan",
        "exercise",
        "budget",
        "dashboard",
        "report",
        "bar chart",
        "line chart",
        "pie chart",
        "weekly plan",
        "send me a",
        "show me a",
    ];
    KEYS.iter().any(|k| m.contains(k))
}

/// Chart/graph/plot requests (gets a stronger artifact hint than generic visual).
#[must_use]
pub fn user_requests_chart(message: &str) -> bool {
    if user_requests_source_code(message) {
        return false;
    }
    let m = message.to_ascii_lowercase();
    const KEYS: &[&str] = &[
        "chart",
        "graph",
        "plot",
        "diagram",
        "visualiz",
        "histogram",
        "bar chart",
        "line chart",
        "pie chart",
        "scatter",
    ];
    KEYS.iter().any(|k| m.contains(k))
}

#[must_use]
pub fn user_requests_source_code(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    const KEYS: &[&str] = &[
        "source code",
        "show me the code",
        "code snippet",
        "sample code",
        "write code",
        "give me code",
        "in python",
        "in rust",
        "in javascript",
        "in typescript",
        "in java",
        "in c++",
        "in c#",
        "function(",
        "implement in",
        "program that",
        "script that",
    ];
    KEYS.iter().any(|k| m.contains(k))
}

/// Split assistant text into display content + optional serialized artifact JSON for storage.
pub fn split_assistant_reply(text: &str) -> (String, Option<String>) {
    if let Some((before, json_str, after)) = extract_artifact_fence(text) {
        return finalize_split(text, before, after, parse_and_store_artifact(json_str));
    }

    for lang in ["html", "htm", "xml"] {
        if let Some((before, html_body, after)) = extract_language_fence_ci(text, lang) {
            if looks_like_html(html_body) {
                return finalize_split(
                    text,
                    before,
                    after,
                    html_artifact_from_body(html_body),
                );
            }
        }
    }

    if let Some((before, body, after)) = extract_unlabeled_html_fence(text) {
        return finalize_split(text, before, after, html_artifact_from_body(body));
    }

    for lang in ["json", "vega-lite", "vegalite"] {
        if let Some((before, body, after)) = extract_language_fence_ci(text, lang) {
            if let Some(stored) = vega_artifact_from_body(body) {
                return finalize_split(text, before, after, Some(stored));
            }
        }
    }

    if let Some((before, html, after)) = extract_bare_html_document(text) {
        return finalize_split(text, &before, &after, html_artifact_from_body(&html));
    }

    if let Some((before, after, rows, title)) = extract_markdown_table(text) {
        let html = markdown_table_to_html_document(&rows, &title);
        return finalize_split(text, &before, &after, html_artifact_from_body(&html));
    }

    (text.to_string(), None)
}

/// When loading history, promote legacy replies that still contain ```html / tables in chat.
pub fn repair_assistant_messages(messages: &mut [StoredMessage]) {
    for msg in messages.iter_mut() {
        if msg.role != MessageRole::Assistant || msg.artifact_json.is_some() {
            continue;
        }
        let (body, artifact_json) = split_assistant_reply(&msg.content);
        if let Some(artifact_json) = artifact_json {
            msg.content = body;
            msg.artifact_json = Some(artifact_json);
        }
    }
}

fn html_artifact_from_body(html_body: &str) -> Option<String> {
    let artifact = ChatArtifact {
        artifact_type: "html".into(),
        title: infer_html_title(html_body),
        body: Value::String(html_body.to_string()),
        caption: None,
        citations: None,
        project_id: None,
    };
    validate_and_serialize_artifact(artifact)
}

fn vega_artifact_from_body(body: &str) -> Option<String> {
    let trimmed = body.trim();
    let value: Value = serde_json::from_str(trimmed).ok()?;
    if !looks_like_vega_lite(&value) {
        return None;
    }
    let title = value
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("Chart")
        .to_string();
    let body = enhance_vega_lite_spec(value, &title);
    let artifact = ChatArtifact {
        artifact_type: "vegaLite".into(),
        title,
        body,
        caption: None,
        citations: None,
        project_id: None,
    };
    validate_and_serialize_artifact(artifact)
}

const VEGA_LITE_SCHEMA: &str = "https://vega.github.io/schema/vega-lite/v6.json";

fn is_simple_vega_lite_spec(obj: &serde_json::Map<String, Value>) -> bool {
    if obj.contains_key("layer")
        || obj.contains_key("concat")
        || obj.contains_key("facet")
        || obj.contains_key("repeat")
        || obj.contains_key("vconcat")
        || obj.contains_key("hconcat")
    {
        return false;
    }
    obj.contains_key("mark")
}

/// Fill in common Vega-Lite gaps (size, title, axis labels) when models omit them.
fn enhance_vega_lite_spec(spec: Value, artifact_title: &str) -> Value {
    let Value::Object(mut obj) = spec else {
        return spec;
    };
    if !obj.contains_key("$schema") {
        obj.insert("$schema".into(), json!(VEGA_LITE_SCHEMA));
    }
    if !obj.contains_key("width") {
        obj.insert("width".into(), json!(440));
    }
    if !obj.contains_key("height") {
        obj.insert("height".into(), json!(300));
    }
    if obj.get("title").is_none() && !artifact_title.trim().is_empty() {
        obj.insert("title".into(), json!(artifact_title.trim()));
    }
    if is_simple_vega_lite_spec(&obj) {
        enhance_encoding_channel(&mut obj, "x");
        enhance_encoding_channel(&mut obj, "y");
    }
    obj.remove("config");
    Value::Object(obj)
}

fn enhance_encoding_channel(obj: &mut serde_json::Map<String, Value>, channel: &str) {
    let (field, guessed) = {
        let field = obj
            .get("encoding")
            .and_then(|e| e.get(channel))
            .and_then(|ch| ch.get("field"))
            .and_then(|f| f.as_str())
            .map(str::to_string);
        let guessed = field
            .as_deref()
            .map(|f| guess_field_type(obj, f))
            .unwrap_or("");
        (field, guessed)
    };
    let Some(Value::Object(enc)) = obj.get_mut("encoding") else {
        return;
    };
    let Some(Value::Object(ch)) = enc.get_mut(channel) else {
        return;
    };
    if let Some(ref field) = field {
        if ch.get("axis").is_none() {
            ch.insert(
                "axis".into(),
                json!({ "title": humanize_field_name(field) }),
            );
        }
        if ch.get("type").is_none() && !guessed.is_empty() {
            ch.insert("type".into(), json!(guessed));
        }
    }
}

fn guess_field_type(spec: &serde_json::Map<String, Value>, field: &str) -> &'static str {
    let Some(Value::Object(data)) = spec.get("data") else {
        return "";
    };
    let Some(values) = data.get("values").and_then(|v| v.as_array()) else {
        return "";
    };
    let Some(first) = values.first().and_then(|r| r.get(field)) else {
        return "";
    };
    if first.is_number() {
        "quantitative"
    } else if first.is_string() {
        "ordinal"
    } else {
        ""
    }
}

fn humanize_field_name(field: &str) -> String {
    let mut spaced = String::new();
    for (i, c) in field.chars().enumerate() {
        if c == '_' {
            spaced.push(' ');
        } else if c.is_ascii_uppercase() && i > 0 && !spaced.ends_with(' ') {
            spaced.push(' ');
            spaced.push(c);
        } else {
            spaced.push(c);
        }
    }
    spaced
        .split_whitespace()
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            let mut chars = lower.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let mut out = first.to_uppercase().to_string();
                    out.push_str(chars.as_str());
                    out
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn looks_like_vega_lite(v: &Value) -> bool {
    if v.get("mark").is_some() || v.get("layer").is_some() || v.get("encoding").is_some() {
        return true;
    }
    v.get("$schema")
        .and_then(|s| s.as_str())
        .is_some_and(|s| s.to_ascii_lowercase().contains("vega"))
}

fn looks_like_html(s: &str) -> bool {
    let t = s.trim_start();
    if !t.starts_with('<') {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    lower.contains("<html")
        || lower.contains("<!doctype")
        || lower.contains("<table")
        || lower.contains("<body")
        || lower.contains("<svg")
}

fn parse_and_store_artifact(json_str: &str) -> Option<String> {
    let artifact = parse_artifact_json(json_str).map_err(|e| {
        eprintln!("persistent-sage: artifact parse failed: {e}");
        e
    }).ok()?;
    validate_and_serialize_artifact(artifact)
}

fn validate_and_serialize_artifact(artifact: ChatArtifact) -> Option<String> {
    if let Err(e) = validate_artifact(&artifact) {
        eprintln!("persistent-sage: artifact validation failed: {e}");
        return None;
    }
    serde_json::to_string(&artifact)
        .map_err(|e| {
            eprintln!("persistent-sage: artifact serialize failed: {e}");
            e
        })
        .ok()
}

fn finalize_split(
    original: &str,
    before: &str,
    after: &str,
    stored: Option<String>,
) -> (String, Option<String>) {
    let Some(stored) = stored else {
        return (original.to_string(), None);
    };
    let title = parse_stored_artifact(&stored)
        .map(|a| a.title)
        .unwrap_or_else(|| "Report".into());
    let mut display = String::new();
    if !before.trim().is_empty() {
        display.push_str(before.trim());
    }
    if !after.trim().is_empty() {
        if !display.is_empty() {
            display.push_str("\n\n");
        }
        display.push_str(after.trim());
    }
    if display.trim().is_empty() {
        display = title;
    }
    (display, Some(stored))
}

fn infer_html_title(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    for tag in ["<h1", "<h2", "<title"] {
        if let Some(idx) = lower.find(tag) {
            let rest = &html[idx..];
            if let Some(start) = rest.find('>') {
                let inner = &rest[start + 1..];
                if let Some(end) = inner.find('<') {
                    let t = inner[..end].trim();
                    if !t.is_empty() && t.len() <= 120 {
                        return t.to_string();
                    }
                }
            }
        }
    }
    "Report".into()
}

fn extract_language_fence_ci<'a>(text: &'a str, lang: &str) -> Option<(&'a str, &'a str, &'a str)> {
    let lower = text.to_ascii_lowercase();
    let marker = format!("```{lang}");
    let start = lower.find(&marker)?;
    let after_marker = text[start + marker.len()..].trim_start_matches(['\r', '\n']);
    let end_fence = after_marker.find("```")?;
    let body = after_marker[..end_fence].trim();
    if body.is_empty() {
        return None;
    }
    let after = after_marker[end_fence + 3..].trim_start();
    let before = text[..start].trim_end();
    Some((before, body, after))
}

/// ``` with no language tag but body starts with HTML.
fn extract_bare_html_document(text: &str) -> Option<(String, String, String)> {
    let lower = text.to_ascii_lowercase();
    let idx = ["<!doctype", "<html"]
        .iter()
        .filter_map(|needle| lower.find(needle))
        .min()?;
    let html_part = &text[idx..];
    let end = html_part.to_ascii_lowercase().find("</html>")?;
    let html = html_part[..end + 7].trim();
    if !looks_like_html(html) {
        return None;
    }
    let before = text[..idx].trim_end().to_string();
    let after = html_part[end + 7..].trim_start().to_string();
    Some((before, html.to_string(), after))
}

fn extract_markdown_table(text: &str) -> Option<(String, String, Vec<Vec<String>>, String)> {
    let lines: Vec<&str> = text.lines().collect();
    let mut start = None;
    let mut end = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('|') && trimmed.ends_with('|') {
            if start.is_none() {
                start = Some(i);
            }
            end = Some(i);
        } else if start.is_some() {
            break;
        }
    }
    let start = start?;
    let end = end?;
    if end - start < 1 {
        return None;
    }
    let table_lines: Vec<&str> = lines[start..=end].to_vec();
    if table_lines.len() < 2 {
        return None;
    }
    let sep = table_lines[1].trim();
    if !sep.contains('|') || !sep.chars().any(|c| c == '-' || c == ':') {
        return None;
    }
    let parse_row = |line: &str| -> Vec<String> {
        line.trim()
            .trim_start_matches('|')
            .trim_end_matches('|')
            .split('|')
            .map(|c| c.trim().to_string())
            .collect()
    };
    let mut rows: Vec<Vec<String>> = Vec::new();
    for (i, line) in table_lines.iter().enumerate() {
        if i == 1 {
            continue;
        }
        let row = parse_row(line);
        if row.iter().any(|c| !c.is_empty()) {
            rows.push(row);
        }
    }
    if rows.is_empty() {
        return None;
    }
    let before = lines[..start].join("\n").trim_end().to_string();
    let after = lines[end + 1..].join("\n").trim_start().to_string();
    let title = before
        .lines()
        .last()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 120)
        .unwrap_or("Report")
        .trim_end_matches([':', '#', '*'])
        .trim()
        .to_string();
    let title = if title.is_empty() {
        "Report".into()
    } else {
        title
    };
    Some((before, after, rows, title))
}

fn markdown_table_to_html_document(rows: &[Vec<String>], title: &str) -> String {
    let header = rows.first().cloned().unwrap_or_default();
    let body_rows = if rows.len() > 1 { &rows[1..] } else { &[] as &[Vec<String>] };
    let head_cells: String = header
        .iter()
        .map(|c| format!("<th>{}</th>", html_escape(c)))
        .collect();
    let body_html: String = body_rows
        .iter()
        .map(|row| {
            let cells: String = row
                .iter()
                .map(|c| format!("<td>{}</td>", html_escape(c)))
                .collect();
            format!("<tr>{cells}</tr>")
        })
        .collect();
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 1rem; color: #1e293b; }}
  h1 {{ font-size: 1.25rem; margin-bottom: 0.75rem; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th, td {{ border: 1px solid #cbd5e1; padding: 0.5rem 0.65rem; text-align: left; }}
  th {{ background: #f1f5f9; }}
</style>
</head>
<body>
<h1>{title}</h1>
<table>
<thead><tr>{head_cells}</tr></thead>
<tbody>{body_html}</tbody>
</table>
</body>
</html>"#
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn extract_unlabeled_html_fence<'a>(text: &'a str) -> Option<(&'a str, &'a str, &'a str)> {
    let lower = text.to_ascii_lowercase();
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("```") {
        let start = search_from + rel;
        let after_ticks = &text[start + 3..];
        let mut i = 0;
        let bytes = after_ticks.as_bytes();
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < bytes.len() && bytes[i].is_ascii_alphabetic() {
            search_from = start + 3;
            continue;
        }
        let body_start = &after_ticks[i..];
        if !looks_like_html(body_start) {
            search_from = start + 3;
            continue;
        }
        let end_fence = body_start.find("```")?;
        let body = body_start[..end_fence].trim();
        if body.is_empty() {
            search_from = start + 3;
            continue;
        }
        let after = body_start[end_fence + 3..].trim_start();
        let before = text[..start].trim_end();
        return Some((before, body, after));
    }
    None
}

/// Parse stored artifact JSON for the frontend.
pub fn parse_stored_artifact(json: &str) -> Option<ChatArtifact> {
    parse_artifact_json(json).ok()
}

fn extract_artifact_fence(text: &str) -> Option<(&str, &str, &str)> {
    let lower = text.to_ascii_lowercase();
    let marker = format!("```{ARTIFACT_FENCE}");
    let start = lower.find(&marker)?;
    let after_marker = text[start + marker.len()..]
        .trim_start_matches(['\r', '\n']);
    let end_fence = after_marker.find("```")?;
    let json_str = after_marker[..end_fence].trim();
    let after = after_marker[end_fence + 3..].trim_start();
    let before = text[..start].trim_end();
    Some((before, json_str, after))
}

fn parse_artifact_json(json_str: &str) -> Result<ChatArtifact, String> {
    if json_str.len() > MAX_ARTIFACT_JSON_BYTES {
        return Err("artifact JSON too large".into());
    }
    let mut artifact: ChatArtifact =
        serde_json::from_str(json_str).map_err(|e| format!("invalid artifact JSON: {e}"))?;
    if artifact.artifact_type.trim().eq_ignore_ascii_case("vegalite") {
        let title = artifact.title.clone();
        artifact.body = enhance_vega_lite_spec(artifact.body.clone(), &title);
    }
    validate_artifact(&artifact)?;
    Ok(artifact)
}

fn validate_artifact(a: &ChatArtifact) -> Result<(), String> {
    let t = a.artifact_type.trim().to_ascii_lowercase();
    match t.as_str() {
        "html" => {
            let s = a
                .body
                .as_str()
                .ok_or_else(|| "html artifact body must be a string".to_string())?;
            if s.len() > MAX_HTML_BODY_CHARS {
                return Err("html artifact body too large".into());
            }
            if s.to_ascii_lowercase().contains("<script") {
                return Err("html artifacts must not contain script tags".into());
            }
        }
        "markdown" => {
            let s = a
                .body
                .as_str()
                .ok_or_else(|| "markdown artifact body must be a string".to_string())?;
            if s.len() > MAX_MARKDOWN_BODY_CHARS {
                return Err("markdown artifact body too large".into());
            }
        }
        "vegalite" => {
            if !a.body.is_object() {
                return Err("vegaLite artifact body must be a JSON object".to_string());
            }
            let serialized = serde_json::to_string(&a.body).map_err(|e| e.to_string())?;
            if serialized.len() > MAX_ARTIFACT_JSON_BYTES {
                return Err("vegaLite spec too large".into());
            }
            if vega_spec_has_remote_data(&a.body) {
                return Err("vegaLite spec must use inline data.values only (no URLs)".into());
            }
        }
        "form" => {
            if !a.body.is_object() {
                return Err("form artifact body must be a JSON object".to_string());
            }
            crate::projects::validate_form_body(&a.body)?;
        }
        _ => return Err(format!("unsupported artifact type: {}", a.artifact_type)),
    }
    if a.title.trim().is_empty() {
        return Err("artifact title is required".into());
    }
    Ok(())
}

fn vega_spec_has_remote_data(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if k == "data" {
                    if v.get("url").is_some() {
                        return true;
                    }
                    if let Some(arr) = v.as_array() {
                        if arr.iter().any(|x| x.get("url").is_some()) {
                            return true;
                        }
                    }
                }
                if k == "url" {
                    return true;
                }
                if vega_spec_has_remote_data(v) {
                    return true;
                }
            }
            false
        }
        Value::Array(arr) => arr.iter().any(vega_spec_has_remote_data),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_artifact_fence() {
        let json = r#"{"type":"markdown","title":"Demo","body":"Hello world"}"#;
        let input = format!("Here is a chart.\n\n```artifact\n{json}\n```\n\nHope that helps.");
        let (display, stored) = split_assistant_reply(&input);
        assert!(stored.is_some());
        assert!(display.contains("Here is a chart"));
        assert!(display.contains("Hope that helps"));
    }

    #[test]
    fn splits_html_fence_as_artifact() {
        let html = "<!DOCTYPE html><html><body><h1>Weekly Exercise Plan</h1><table><tr><td>Mon</td></tr></table></body></html>";
        let input = format!("Here is your plan.\n\n```html\n{html}\n```\n\nEnjoy.");
        let (display, stored) = split_assistant_reply(&input);
        assert!(stored.is_some());
        let parsed = parse_stored_artifact(stored.as_ref().unwrap()).unwrap();
        assert_eq!(parsed.artifact_type, "html");
        assert!(display.contains("plan"));
    }

    #[test]
    fn splits_html_fence_case_insensitive() {
        let html = "<html><body><h1>Plan</h1><table></table></body></html>";
        let input = format!("Plan below.\n\n```HTML\n{html}\n```");
        let (_, stored) = split_assistant_reply(&input);
        assert!(stored.is_some());
    }

    #[test]
    fn detects_visual_user_request() {
        assert!(user_requests_visual_deliverable(
            "send me a mockup weekly exercise plan in HTML with a graph"
        ));
        assert!(!user_requests_visual_deliverable(
            "write python code to parse csv"
        ));
    }
}
