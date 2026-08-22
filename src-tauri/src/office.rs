//! Office document tools for the chat agent: create and read Word, Excel, and PowerPoint
//! files (.docx, .xlsx, .pptx) in the workspace.
//!
//! Google Workspace native formats (.gdoc, .gsheet, .gslides) are cloud shortcuts, not
//! local files — agents create standard Office Open XML files that open in Microsoft Office,
//! Google Docs (upload), and LibreOffice.

use std::io::Write;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use docx_rs::{Docx, Paragraph, Run};
use rust_xlsxwriter::{Workbook, Worksheet};
use serde_json::{json, Value};
use zip::write::FileOptions;
use zip::ZipWriter;

use crate::agent_tools::{assert_path_in_workspace, resolve_workspace_subpath, tool_err};
use crate::provider::{ProviderError, ToolDefinition};

const OFFICE_READ_MAX_BYTES: u64 = 25 * 1024 * 1024;
const OFFICE_TEXT_OUTPUT_MAX_CHARS: usize = 48_000;
const OFFICE_WRITE_MAX_CONTENT_BYTES: usize = 2_000_000;

pub fn is_office_tool_name(name: &str) -> bool {
    matches!(name, "workspace_read_office" | "workspace_write_office")
}

pub fn office_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "workspace_read_office".into(),
            description: Some(
                "Extract plain text from an Office file in the workspace: .docx (Word), .xlsx \
                 (Excel), or .pptx (PowerPoint). Path is relative to the workspace root. Returns \
                 document text without layout/images."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to a .docx, .xlsx, or .pptx file under the workspace"
                    }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "workspace_write_office".into(),
            description: Some(
                "Create or overwrite an Office file in the workspace. Supported formats: docx \
                 (Word document from text — paragraphs separated by blank lines), xlsx (spreadsheet \
                 from a JSON array of rows, each row an array of cell values), pptx (presentation \
                 from a JSON array of slides with title and body). Parent directories are created \
                 as needed; extension is added if missing."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative output path under the workspace (.docx, .xlsx, or .pptx)"
                    },
                    "format": {
                        "type": "string",
                        "enum": ["docx", "xlsx", "pptx"],
                        "description": "File format (inferred from path extension when omitted)"
                    },
                    "content": {
                        "type": "string",
                        "description": "For docx: document text; paragraphs separated by blank lines"
                    },
                    "rows": {
                        "type": "array",
                        "description": "For xlsx: array of rows, each row an array of strings/numbers/booleans",
                        "items": {
                            "type": "array",
                            "items": {}
                        }
                    },
                    "slides": {
                        "type": "array",
                        "description": "For pptx: array of {title, body} slide objects",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "body": { "type": "string" }
                            }
                        }
                    },
                    "title": {
                        "type": "string",
                        "description": "Optional document title (docx/pptx metadata)"
                    }
                },
                "required": ["path"]
            }),
        },
    ]
}

fn infer_format(path: &str, explicit: Option<&str>) -> Result<&'static str, ProviderError> {
    if let Some(f) = explicit {
        let f = f.trim().to_ascii_lowercase();
        return match f.as_str() {
            "docx" | "word" | "document" => Ok("docx"),
            "xlsx" | "excel" | "spreadsheet" | "sheet" => Ok("xlsx"),
            "pptx" | "powerpoint" | "presentation" | "slides" | "slide" => Ok("pptx"),
            other => Err(tool_err(format!(
                "unsupported office format `{other}` — use docx, xlsx, or pptx"
            ))),
        };
    }
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".docx") {
        Ok("docx")
    } else if lower.ends_with(".xlsx") {
        Ok("xlsx")
    } else if lower.ends_with(".pptx") {
        Ok("pptx")
    } else {
        Err(tool_err(
            "could not infer format from path — add .docx/.xlsx/.pptx extension or pass `format`",
        ))
    }
}

fn ensure_extension(path: &str, format: &str) -> String {
    let lower = path.to_ascii_lowercase();
    let has_ext = lower.ends_with(".docx") || lower.ends_with(".xlsx") || lower.ends_with(".pptx");
    if has_ext {
        path.to_string()
    } else {
        format!("{path}.{format}")
    }
}

fn truncate_output(text: String) -> String {
    if text.chars().count() > OFFICE_TEXT_OUTPUT_MAX_CHARS {
        text.chars()
            .take(OFFICE_TEXT_OUTPUT_MAX_CHARS)
            .collect::<String>()
            + "\n… [truncated]"
    } else {
        text
    }
}

fn read_xlsx_text(abs: &Path) -> Result<String, ProviderError> {
    let mut workbook =
        open_workbook_auto(abs).map_err(|e| tool_err(format!("read xlsx: {e}")))?;
    let mut out = String::new();
    let sheet_names = workbook.sheet_names().to_vec();
    for name in sheet_names {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&format!("## Sheet: {name}\n"));
        if let Ok(range) = workbook.worksheet_range(&name) {
            for (r_idx, row) in range.rows().enumerate() {
                let cells: Vec<String> = row.iter().map(data_to_string).collect();
                if cells.iter().any(|c| !c.is_empty()) {
                    out.push_str(&format!("Row {}: {}\n", r_idx + 1, cells.join(" | ")));
                }
            }
        }
    }
    Ok(truncate_output(out.trim().to_string()))
}

fn data_to_string(d: &Data) -> String {
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => f.to_string(),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => format!("{dt:?}"),
        Data::DateTimeIso(s) => s.clone(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{e:?}"),
    }
}

fn read_ooxml_text(abs: &Path, tag: &str) -> Result<String, ProviderError> {
    let file = std::fs::File::open(abs).map_err(|e| tool_err(format!("open: {e}")))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| tool_err(format!("zip: {e}")))?;
    let pattern = format!(r"<{tag}[^>]*>([^<]*)</{tag}>");
    let re = regex::Regex::new(&pattern).map_err(|e| tool_err(format!("regex: {e}")))?;
    let mut parts = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| tool_err(format!("zip entry: {e}")))?;
        if !entry.name().ends_with(".xml") {
            continue;
        }
        let mut xml = String::new();
        std::io::Read::read_to_string(&mut entry, &mut xml)
            .map_err(|e| tool_err(format!("read xml: {e}")))?;
        for cap in re.captures_iter(&xml) {
            if let Some(m) = cap.get(1) {
                let t = m.as_str().trim();
                if !t.is_empty() {
                    parts.push(t.to_string());
                }
            }
        }
    }
    Ok(parts.join("\n"))
}

fn read_office_file(abs: &Path) -> Result<String, ProviderError> {
    let meta = std::fs::metadata(abs).map_err(|e| tool_err(format!("read metadata: {e}")))?;
    if meta.len() > OFFICE_READ_MAX_BYTES {
        return Err(tool_err(format!(
            "file too large ({} bytes; max {})",
            meta.len(),
            OFFICE_READ_MAX_BYTES
        )));
    }
    let lower = abs.to_string_lossy().to_ascii_lowercase();
    let text = if lower.ends_with(".xlsx") || lower.ends_with(".xls") || lower.ends_with(".xlsm") {
        read_xlsx_text(abs)?
    } else if lower.ends_with(".docx") {
        read_ooxml_text(abs, "w:t")?
    } else if lower.ends_with(".pptx") {
        read_ooxml_text(abs, "a:t")?
    } else {
        return Err(tool_err(
            "unsupported office format — use .docx, .xlsx, or .pptx",
        ));
    };
    Ok(truncate_output(text))
}

fn write_docx(abs: &Path, content: &str, title: Option<&str>) -> Result<(), ProviderError> {
    if content.len() > OFFICE_WRITE_MAX_CONTENT_BYTES {
        return Err(tool_err("content too large"));
    }
    let mut docx = Docx::new();
    let _title = title;
    let mut wrote = false;
    for block in content.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        for line in block.lines() {
            let line = line.trim();
            if !line.is_empty() {
                docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(line)));
                wrote = true;
            }
        }
    }
    if !wrote {
        docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text("")));
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| tool_err(format!("create dirs: {e}")))?;
    }
    let file = std::fs::File::create(abs).map_err(|e| tool_err(format!("create file: {e}")))?;
    docx.build()
        .pack(file)
        .map_err(|e| tool_err(format!("write docx: {e}")))
}

fn write_xlsx(abs: &Path, rows: &[Value]) -> Result<(), ProviderError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Sheet1")
        .map_err(|e| tool_err(format!("xlsx sheet name: {e}")))?;
    for (r_idx, row_val) in rows.iter().enumerate() {
        let row = row_val
            .as_array()
            .ok_or_else(|| tool_err(format!("rows[{}] must be an array", r_idx)))?;
        for (c_idx, cell_val) in row.iter().enumerate() {
            write_xlsx_cell(worksheet, r_idx as u32, c_idx as u16, cell_val)?;
        }
    }
    if rows.is_empty() {
        worksheet
            .write_string(0, 0, "")
            .map_err(|e| tool_err(format!("xlsx write cell: {e}")))?;
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| tool_err(format!("create dirs: {e}")))?;
    }
    workbook
        .save(abs)
        .map_err(|e| tool_err(format!("write xlsx: {e}")))
}

fn write_xlsx_cell(
    worksheet: &mut Worksheet,
    row: u32,
    col: u16,
    value: &Value,
) -> Result<(), ProviderError> {
    match value {
        Value::Null => worksheet
            .write_string(row, col, "")
            .map_err(|e| tool_err(format!("xlsx write cell: {e}"))),
        Value::Bool(b) => worksheet
            .write_boolean(row, col, *b)
            .map_err(|e| tool_err(format!("xlsx write cell: {e}"))),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                worksheet
                    .write_number(row, col, i as f64)
                    .map_err(|e| tool_err(format!("xlsx write cell: {e}")))
            } else if let Some(f) = n.as_f64() {
                worksheet
                    .write_number(row, col, f)
                    .map_err(|e| tool_err(format!("xlsx write cell: {e}")))
            } else {
                worksheet
                    .write_string(row, col, &n.to_string())
                    .map_err(|e| tool_err(format!("xlsx write cell: {e}")))
            }
        }
        Value::String(s) => worksheet
            .write_string(row, col, s)
            .map_err(|e| tool_err(format!("xlsx write cell: {e}"))),
        other => worksheet
            .write_string(row, col, &other.to_string())
            .map_err(|e| tool_err(format!("xlsx write cell: {e}"))),
    }
}

fn write_pptx(
    abs: &Path,
    slides: &[Value],
    title: Option<&str>,
) -> Result<(), ProviderError> {
    let deck_title = title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Presentation");
    let mut slide_xmls: Vec<String> = Vec::new();
    if slides.is_empty() {
        slide_xmls.push(slide_xml("", "(empty slide)"));
    }
    for slide_val in slides {
        let obj = slide_val
            .as_object()
            .ok_or_else(|| tool_err("each slide must be an object with title and/or body"))?;
        let slide_title = obj
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let body = obj
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        slide_xmls.push(slide_xml(slide_title, body));
    }
    write_minimal_pptx(abs, deck_title, &slide_xmls)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn slide_xml(title: &str, body: &str) -> String {
    let title = if title.is_empty() { "Slide" } else { title };
    let body = if body.is_empty() { "" } else { body };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/>
        <a:p><a:r><a:rPr sz="3200" b="1"/><a:t>{title}</a:t></a:r></a:p>
        <a:p><a:r><a:rPr sz="2000"/><a:t>{body}</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#,
        title = xml_escape(title),
        body = xml_escape(body),
    )
}

fn write_minimal_pptx(
    abs: &Path,
    title: &str,
    slides: &[String],
) -> Result<(), ProviderError> {
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| tool_err(format!("create dirs: {e}")))?;
    }
    let file = std::fs::File::create(abs).map_err(|e| tool_err(format!("create file: {e}")))?;
    let mut zip = ZipWriter::new(file);
    let opts = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("[Content_Types].xml", opts)
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
    let mut slide_overrides = String::new();
    for i in 0..slides.len() {
        slide_overrides.push_str(&format!(
            r#"<Override PartName="/ppt/slides/slide{}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#,
            i + 1
        ));
    }
    zip.write_all(format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  {slide_overrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"#).as_bytes())
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;

    zip.start_file("_rels/.rels", opts)
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>"#)
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;

    zip.start_file("docProps/core.xml", opts)
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
    zip.write_all(format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>{}</dc:title>
</cp:coreProperties>"#, xml_escape(title)).as_bytes())
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;

    zip.start_file("ppt/presentation.xml", opts)
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
    let mut sld_ids = String::new();
    let mut sld_rels = String::new();
    for i in 0..slides.len() {
        let id = 256 + i as u32;
        sld_ids.push_str(&format!(r#"<p:sldId id="{id}" r:id="rId{}"/>"#, i + 1));
        sld_rels.push_str(&format!(
            r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{}.xml"/>"#,
            i + 1,
            i + 1
        ));
    }
    zip.write_all(format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>{sld_ids}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>"#).as_bytes())
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;

    zip.start_file("ppt/_rels/presentation.xml.rels", opts)
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
    zip.write_all(format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{sld_rels}</Relationships>"#).as_bytes())
        .map_err(|e| tool_err(format!("pptx zip: {e}")))?;

    for (i, slide) in slides.iter().enumerate() {
        let path = format!("ppt/slides/slide{}.xml", i + 1);
        zip.start_file(&path, opts)
            .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
        zip.write_all(slide.as_bytes())
            .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
        let rel_path = format!("ppt/slides/_rels/slide{}.xml.rels", i + 1);
        zip.start_file(&rel_path, opts)
            .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#)
            .map_err(|e| tool_err(format!("pptx zip: {e}")))?;
    }

    zip.finish().map_err(|e| tool_err(format!("pptx zip finish: {e}")))?;
    Ok(())
}

pub async fn run_office_tool(
    workspace_root: &Path,
    name: &str,
    v: &Value,
) -> Result<String, ProviderError> {
    match name {
        "workspace_read_office" => {
            let rel = v["path"].as_str().unwrap_or("").trim();
            let abs = resolve_workspace_subpath(workspace_root, rel)?;
            assert_path_in_workspace(workspace_root, &abs)?;
            if !abs.is_file() {
                return Err(tool_err(format!("not a file: {rel}")));
            }
            read_office_file(&abs)
        }
        "workspace_write_office" => {
            let rel_raw = v["path"].as_str().unwrap_or("").trim();
            let format = infer_format(rel_raw, v.get("format").and_then(|x| x.as_str()))?;
            let rel = ensure_extension(rel_raw, format);
            let abs = resolve_workspace_subpath(workspace_root, &rel)?;
            assert_path_in_workspace(workspace_root, &abs)?;
            let doc_title = v["title"].as_str();
            match format {
                "docx" => {
                    let content = v["content"].as_str().unwrap_or("").to_string();
                    if content.is_empty() {
                        return Err(tool_err(
                            "docx requires `content` (text with paragraphs separated by blank lines)",
                        ));
                    }
                    write_docx(&abs, &content, doc_title)?;
                }
                "xlsx" => {
                    let rows = v["rows"]
                        .as_array()
                        .ok_or_else(|| tool_err("xlsx requires `rows` (array of row arrays)"))?;
                    write_xlsx(&abs, rows)?;
                }
                "pptx" => {
                    let slides = v["slides"]
                        .as_array()
                        .ok_or_else(|| tool_err("pptx requires `slides` (array of {title, body})"))?;
                    write_pptx(&abs, slides, doc_title)?;
                }
                _ => unreachable!(),
            }
            Ok(format!("Wrote {rel} ({format})"))
        }
        other => Err(tool_err(format!("unknown office tool: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn round_trip_docx() {
        let dir = std::env::temp_dir().join(format!("ps_office_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.docx");
        write_docx(&path, "Hello\n\nWorld", Some("Test")).unwrap();
        let text = read_office_file(&path).unwrap();
        assert!(text.contains("Hello"));
        assert!(text.contains("World"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
