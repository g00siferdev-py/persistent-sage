//! Chat artifacts: structured HTML / Vega-Lite / Markdown blocks embedded in assistant replies.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const ARTIFACT_FENCE: &str = "artifact";
const MAX_ARTIFACT_JSON_BYTES: usize = 512_000;
const MAX_HTML_BODY_CHARS: usize = 200_000;
const MAX_MARKDOWN_BODY_CHARS: usize = 100_000;

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
}

/// Instructions appended to the system prompt when artifacts are enabled.
pub const ARTIFACT_SYSTEM_APPENDIX: &str = r#"

## Chat artifacts (OpenSage)

When a visual report, chart, or formatted layout would help the user, append exactly one fenced block after your normal explanation:

```artifact
{
  "type": "html" | "vegaLite" | "markdown",
  "title": "Short title",
  "body": "<for html: sanitized HTML string; for vegaLite: Vega-Lite spec object with inline data.values only; for markdown: markdown string>",
  "caption": "optional one-line note",
  "citations": [{"path": "workspace/relative/path", "lineStart": 1, "lineEnd": 10, "label": "optional"}]
}
```

Rules:
- Keep conversational text outside the fence; the fence holds only valid JSON.
- For vegaLite: use only inline `"data": {"values": [...]}` — no URLs or remote datasets.
- For html: no `<script>`, no inline event handlers, no external resources.
- Do not include secrets or API keys in artifacts.
"#;

/// Split assistant text into display content + optional serialized artifact JSON for storage.
pub fn split_assistant_reply(text: &str) -> (String, Option<String>) {
    let Some((before, json_str, after)) = extract_artifact_fence(text) else {
        return (text.to_string(), None);
    };

    let artifact = match parse_artifact_json(json_str) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("persistent-sage: artifact parse failed: {e}");
            return (text.to_string(), None);
        }
    };

    let stored = match serde_json::to_string(&artifact) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("persistent-sage: artifact serialize failed: {e}");
            return (text.to_string(), None);
        }
    };

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
        display = artifact.title.clone();
    }

    (display, Some(stored))
}

/// Parse stored artifact JSON for the frontend.
pub fn parse_stored_artifact(json: &str) -> Option<ChatArtifact> {
    parse_artifact_json(json).ok()
}

fn extract_artifact_fence(text: &str) -> Option<(&str, &str, &str)> {
    let marker = format!("```{ARTIFACT_FENCE}");
    let start = text.find(&marker)?;
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
    let artifact: ChatArtifact =
        serde_json::from_str(json_str).map_err(|e| format!("invalid artifact JSON: {e}"))?;
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
                if k == "url" || k == "data" && v.get("url").is_some() {
                    return true;
                }
                if vega_spec_has_remote_data(v) {
                    return true;
                }
            }
            false
        }
        Value::Array(arr) => arr.iter().any(vega_spec_has_remote_data),
        Value::String(s) if s.starts_with("http://") || s.starts_with("https://") => true,
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
}
