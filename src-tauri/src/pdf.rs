//! PDF tools for the chat/coding agent.
//!
//! - `workspace_read_pdf` extracts the text layer from a PDF in the workspace (pure Rust,
//!   via `pdf-extract`). Scanned/image-only PDFs have no text layer and return a note.
//! - `workspace_write_pdf` creates (or overwrites) a PDF in the workspace from Markdown,
//!   HTML, or plain text — rendered through the same headless Chrome/Chromium/Edge engine
//!   used by `fetch_browser`, so the HTML/Markdown the agent produces prints with real
//!   layout, fonts, and styling. It can also convert an existing workspace `.md`/`.html`/
//!   `.txt` file to PDF via `source_path`.
//!
//! "Editing" a PDF is a read → modify → rewrite loop: read the text with
//! `workspace_read_pdf`, change it, then rewrite the PDF with `workspace_write_pdf`.
//!
//! All paths are jailed to the workspace root (same sanitizer as the other workspace tools).

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use pulldown_cmark::{html as md_html, Options as MdOptions, Parser as MdParser};
use serde_json::{json, Value};
use url::Url;

use crate::agent_tools::{assert_path_in_workspace, resolve_workspace_subpath, tool_err};
use crate::provider::{ProviderError, ToolDefinition};

/// Source PDF size cap for text extraction.
const PDF_READ_MAX_BYTES: u64 = 25 * 1024 * 1024;
/// Cap on extracted text returned to the model.
const PDF_TEXT_OUTPUT_MAX_CHARS: usize = 48_000;
/// Cap on inline markup/text accepted for PDF creation.
const PDF_CREATE_MAX_CONTENT_BYTES: usize = 2_000_000;
/// Source file size cap when converting an existing workspace file to PDF.
const PDF_SOURCE_MAX_BYTES: u64 = 4 * 1024 * 1024;
const PDF_RENDER_TIMEOUT_SECS: u64 = 60;

pub fn is_pdf_tool_name(name: &str) -> bool {
    matches!(name, "workspace_read_pdf" | "workspace_write_pdf")
}

/// Tool schemas exposed to the model (added alongside the other workspace tools).
pub fn pdf_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "workspace_read_pdf".into(),
            description: Some(
                "Extract the text of a PDF file inside the Persistent Sage workspace. Returns the \
                 document text (no layout/images). Path is relative to the workspace root (forward \
                 slashes, no ..). Note: scanned/image-only PDFs have no text layer and return an \
                 explanatory message rather than text."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path to a .pdf file under the workspace" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "workspace_write_pdf".into(),
            description: Some(
                "Create or overwrite a PDF file in the workspace, rendered with a headless \
                 Chromium browser for real fonts and layout. Provide the source either inline via \
                 `content` (with `format`: markdown, html, or text) or by pointing `source_path` \
                 at an existing workspace .md/.html/.txt file. To EDIT a PDF, read it with \
                 workspace_read_pdf, change the text, then call this to rewrite it. Parent \
                 directories are created as needed; the output path gets a .pdf extension if \
                 missing. Requires a Chrome/Chromium/Edge browser on the system."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative output path for the PDF under the workspace" },
                    "content": { "type": "string", "description": "Inline source to render (Markdown, HTML, or plain text). Omit if using source_path." },
                    "format": {
                        "type": "string",
                        "enum": ["markdown", "html", "text"],
                        "description": "How to interpret `content` (or an explicit override for source_path). Defaults to markdown for inline content, or inferred from source_path's extension."
                    },
                    "source_path": { "type": "string", "description": "Optional: relative path to an existing workspace .md/.html/.txt file to convert to PDF instead of inline content." },
                    "title": { "type": "string", "description": "Optional document title used in the rendered page." }
                },
                "required": ["path"]
            }),
        },
    ]
}

/// Dispatch a PDF tool call. `workspace_root` must be the enabled workspace root.
pub async fn run_pdf_tool(
    workspace_root: &Path,
    data_directory: &Path,
    name: &str,
    v: &Value,
) -> Result<String, ProviderError> {
    match name {
        "workspace_read_pdf" => {
            let rel = v["path"].as_str().unwrap_or("").trim().to_string();
            let root = workspace_root.to_path_buf();
            let text = tokio::task::spawn_blocking(move || read_pdf_text(&root, &rel))
                .await
                .map_err(|e| tool_err(format!("read_pdf join error: {e}")))??;
            if text.chars().count() > PDF_TEXT_OUTPUT_MAX_CHARS {
                Ok(text
                    .chars()
                    .take(PDF_TEXT_OUTPUT_MAX_CHARS)
                    .collect::<String>()
                    + "\n… [truncated]")
            } else {
                Ok(text)
            }
        }
        "workspace_write_pdf" => {
            let out_rel = v["path"].as_str().unwrap_or("").trim();
            let format = v.get("format").and_then(|x| x.as_str());
            let content = v.get("content").and_then(|x| x.as_str());
            let source = v.get("source_path").and_then(|x| x.as_str());
            let title = v.get("title").and_then(|x| x.as_str());
            write_pdf(
                workspace_root,
                data_directory,
                out_rel,
                format,
                content,
                source,
                title,
            )
            .await
        }
        other => Err(tool_err(format!("unknown pdf tool: {other}"))),
    }
}

/// Extract the text layer from a workspace PDF (blocking; call via spawn_blocking).
fn read_pdf_text(workspace_root: &Path, rel: &str) -> Result<String, ProviderError> {
    let path = resolve_workspace_subpath(workspace_root, rel)?;
    assert_path_in_workspace(workspace_root, &path)?;
    let meta = std::fs::metadata(&path).map_err(|e| tool_err(format!("read_pdf: {e}")))?;
    if !meta.is_file() {
        return Err(tool_err("path is not a regular file"));
    }
    if meta.len() > PDF_READ_MAX_BYTES {
        return Err(tool_err(format!(
            "PDF is {} bytes (max {} for text extraction)",
            meta.len(),
            PDF_READ_MAX_BYTES
        )));
    }
    let text = pdf_extract::extract_text(&path)
        .map_err(|e| tool_err(format!("failed to extract PDF text: {e}")))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(
            "(no extractable text — this PDF appears to be scanned images or has no text layer; \
             OCR would be required)"
                .into(),
        );
    }
    Ok(trimmed.to_string())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PdfSourceFormat {
    Markdown,
    Html,
    Text,
}

fn parse_format(s: &str) -> Option<PdfSourceFormat> {
    match s.trim().to_ascii_lowercase().as_str() {
        "markdown" | "md" => Some(PdfSourceFormat::Markdown),
        "html" | "htm" => Some(PdfSourceFormat::Html),
        "text" | "txt" | "plain" => Some(PdfSourceFormat::Text),
        _ => None,
    }
}

fn format_from_extension(path: &str) -> Option<PdfSourceFormat> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    parse_format(ext)
}

#[allow(clippy::too_many_arguments)]
async fn write_pdf(
    workspace_root: &Path,
    data_directory: &Path,
    out_rel: &str,
    format: Option<&str>,
    content: Option<&str>,
    source_rel: Option<&str>,
    title: Option<&str>,
) -> Result<String, ProviderError> {
    if out_rel.is_empty() {
        return Err(tool_err("workspace_write_pdf: `path` is required"));
    }

    // Normalize the output path so it ends in .pdf.
    let out_rel_pdf = if out_rel.to_ascii_lowercase().ends_with(".pdf") {
        out_rel.to_string()
    } else {
        format!("{out_rel}.pdf")
    };
    let out_path = resolve_workspace_subpath(workspace_root, &out_rel_pdf)?;

    // Resolve the source markup/text and its format.
    let (raw, fmt) = if let Some(src_rel) = source_rel.filter(|s| !s.trim().is_empty()) {
        let src_path = resolve_workspace_subpath(workspace_root, src_rel.trim())?;
        assert_path_in_workspace(workspace_root, &src_path)?;
        let meta =
            std::fs::metadata(&src_path).map_err(|e| tool_err(format!("source_path: {e}")))?;
        if !meta.is_file() {
            return Err(tool_err("source_path is not a regular file"));
        }
        if meta.len() > PDF_SOURCE_MAX_BYTES {
            return Err(tool_err(format!(
                "source file is {} bytes (max {})",
                meta.len(),
                PDF_SOURCE_MAX_BYTES
            )));
        }
        let bytes = std::fs::read(&src_path).map_err(|e| tool_err(format!("source_path: {e}")))?;
        let text = String::from_utf8(bytes)
            .map_err(|_| tool_err("source file is not valid UTF-8 text"))?;
        let fmt = format
            .and_then(parse_format)
            .or_else(|| format_from_extension(src_rel.trim()))
            .unwrap_or(PdfSourceFormat::Text);
        (text, fmt)
    } else if let Some(c) = content {
        if c.as_bytes().len() > PDF_CREATE_MAX_CONTENT_BYTES {
            return Err(tool_err(format!(
                "content exceeds {PDF_CREATE_MAX_CONTENT_BYTES} bytes"
            )));
        }
        let fmt = format.and_then(parse_format).unwrap_or(PdfSourceFormat::Markdown);
        (c.to_string(), fmt)
    } else {
        return Err(tool_err(
            "workspace_write_pdf: provide either `content` or `source_path`",
        ));
    };

    let html_doc = build_html_document(&raw, fmt, title);

    // Ensure the output directory exists and stays within the workspace.
    if let Some(parent) = out_path.parent() {
        assert_path_in_workspace(workspace_root, parent)?;
        std::fs::create_dir_all(parent).map_err(|e| tool_err(format!("create_dir_all: {e}")))?;
    }
    assert_path_in_workspace(workspace_root, &out_path)?;

    render_html_to_pdf(data_directory, &html_doc, &out_path).await?;

    let size = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Err(tool_err(
            "PDF rendering produced an empty file (the browser may have failed to render the content)",
        ));
    }
    Ok(format!("Created PDF ({size} bytes) at {out_rel_pdf}"))
}

fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Wrap the source in a full, print-friendly HTML document.
fn build_html_document(raw: &str, fmt: PdfSourceFormat, title: Option<&str>) -> String {
    // Full HTML documents are rendered as-is (the author controls the whole page).
    if fmt == PdfSourceFormat::Html {
        let lower = raw.trim_start().to_ascii_lowercase();
        if lower.starts_with("<!doctype") || lower.starts_with("<html") {
            return raw.to_string();
        }
    }

    let body = match fmt {
        PdfSourceFormat::Markdown => {
            let mut opts = MdOptions::empty();
            opts.insert(MdOptions::ENABLE_TABLES);
            opts.insert(MdOptions::ENABLE_STRIKETHROUGH);
            opts.insert(MdOptions::ENABLE_FOOTNOTES);
            opts.insert(MdOptions::ENABLE_TASKLISTS);
            let parser = MdParser::new_ext(raw, opts);
            let mut html_out = String::new();
            md_html::push_html(&mut html_out, parser);
            html_out
        }
        PdfSourceFormat::Html => raw.to_string(),
        PdfSourceFormat::Text => format!("<pre>{}</pre>", escape_html(raw)),
    };

    let doc_title = escape_html(title.unwrap_or("Document"));

    format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <title>{doc_title}</title>\n<style>\n{css}\n</style>\n</head>\n<body>\n{body}\n</body>\n</html>",
        css = PRINT_CSS,
    )
}

const PRINT_CSS: &str = r#"
@page { margin: 2cm; }
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.55;
  color: #1a1a1a;
  margin: 0;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; font-weight: 600; }
h1 { font-size: 1.9em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
h3 { font-size: 1.25em; }
p { margin: 0.6em 0; }
a { color: #0b5cad; text-decoration: none; }
code, pre, kbd { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
code { background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
pre {
  background: #f6f8fa;
  padding: 1em;
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 0.9em;
  line-height: 1.4;
}
pre code { background: none; padding: 0; }
blockquote {
  margin: 0.8em 0;
  padding: 0.2em 1em;
  border-left: 4px solid #d0d7de;
  color: #57606a;
}
ul, ol { padding-left: 1.6em; margin: 0.6em 0; }
li { margin: 0.2em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
th, td { border: 1px solid #d0d7de; padding: 0.4em 0.7em; text-align: left; }
th { background: #f3f4f6; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
"#;

/// Render a full HTML document to `out_pdf` using headless Chrome/Chromium/Edge.
async fn render_html_to_pdf(
    data_directory: &Path,
    html_doc: &str,
    out_pdf: &Path,
) -> Result<(), ProviderError> {
    let chrome = crate::browser_fetch::find_chrome_executable().ok_or_else(|| {
        tool_err(
            "no Chrome/Chromium/Edge browser found for PDF rendering. Install a Chromium-based \
             browser (Chrome, Chromium, or Microsoft Edge) or set PERSISTENT_SAGE_CHROME_PATH to \
             the browser binary.",
        )
    })?;

    let render_dir = data_directory.join("pdf_render");
    std::fs::create_dir_all(&render_dir)
        .map_err(|e| tool_err(format!("could not create PDF render dir: {e}")))?;
    let profile_dir = render_dir.join("profile");
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| tool_err(format!("could not create PDF render profile: {e}")))?;

    let stamp = uuid::Uuid::new_v4();
    let html_path = render_dir.join(format!("render-{stamp}.html"));
    std::fs::write(&html_path, html_doc)
        .map_err(|e| tool_err(format!("could not write temp HTML for PDF: {e}")))?;

    let file_url = Url::from_file_path(&html_path)
        .map_err(|_| tool_err("could not build file:// URL for the temp HTML"))?;

    let mut args: Vec<String> = vec![
        "--headless=new".into(),
        "--disable-gpu".into(),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--disable-dev-shm-usage".into(),
        format!("--user-data-dir={}", profile_dir.display()),
        "--no-pdf-header-footer".into(),
        "--run-all-compositor-stages-before-draw".into(),
        "--virtual-time-budget=8000".into(),
        format!("--print-to-pdf={}", out_pdf.display()),
    ];
    args.extend(crate::browser_fetch::chrome_extra_launch_args());
    args.push(file_url.as_str().to_string());

    let mut cmd = tokio::process::Command::new(&chrome);
    cmd.args(&args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::browser_fetch::apply_chrome_launch_env(&mut cmd);

    let output = tokio::time::timeout(Duration::from_secs(PDF_RENDER_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| tool_err("PDF rendering timed out"))
        .and_then(|r| r.map_err(|e| tool_err(format!("failed to start browser for PDF: {e}"))));

    // Best-effort cleanup of the temp HTML regardless of outcome.
    let _ = std::fs::remove_file(&html_path);

    let output = output?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let hint = crate::browser_fetch::chrome_stderr_hint(&stderr);
        return Err(tool_err(format!(
            "browser exited with {} while rendering PDF: {}{}",
            output.status,
            stderr.trim(),
            hint
        )));
    }

    if !out_pdf.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(tool_err(format!(
            "browser finished but no PDF was written. {}",
            stderr.trim()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_becomes_html_body() {
        let doc = build_html_document("# Title\n\nHello **world**.", PdfSourceFormat::Markdown, None);
        assert!(doc.contains("<h1>Title</h1>"), "{doc}");
        assert!(doc.contains("<strong>world</strong>"), "{doc}");
        assert!(doc.contains("<!DOCTYPE html>"));
    }

    #[test]
    fn text_is_escaped_in_pre() {
        let doc = build_html_document("a < b & c", PdfSourceFormat::Text, None);
        assert!(doc.contains("<pre>a &lt; b &amp; c</pre>"), "{doc}");
    }

    #[test]
    fn full_html_document_passthrough() {
        let src = "<!DOCTYPE html><html><body><p>hi</p></body></html>";
        let doc = build_html_document(src, PdfSourceFormat::Html, None);
        assert_eq!(doc, src);
    }

    #[test]
    fn format_parsing() {
        assert!(matches!(parse_format("md"), Some(PdfSourceFormat::Markdown)));
        assert!(matches!(parse_format("HTML"), Some(PdfSourceFormat::Html)));
        assert!(matches!(parse_format("txt"), Some(PdfSourceFormat::Text)));
        assert!(parse_format("docx").is_none());
        assert!(matches!(
            format_from_extension("notes/report.md"),
            Some(PdfSourceFormat::Markdown)
        ));
    }
}
