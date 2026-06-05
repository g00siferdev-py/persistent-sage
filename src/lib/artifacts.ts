import { compile, type TopLevelSpec } from "vega-lite";
import { buildChartHtmlDocument } from "@/lib/chartArtifact";

export { buildChartHtmlDocument } from "@/lib/chartArtifact";

/** Chat artifact types (mirrors Rust `ChatArtifact`). */

export type ArtifactCitation = {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  label?: string;
};

export type ChatArtifact = {
  type: "html" | "vegaLite" | "markdown" | "form" | string;
  title: string;
  body: string | Record<string, unknown>;
  caption?: string;
  citations?: ArtifactCitation[];
  projectId?: string;
};

export type PreparedAssistantMessage = {
  content: string;
  artifactJson?: string;
};

export function parseArtifactJson(json: string | undefined | null): ChatArtifact | null {
  if (!json?.trim()) return null;
  try {
    const raw = JSON.parse(json) as ChatArtifact & { artifactType?: string };
    const type = (raw.type ?? raw.artifactType ?? "").toString();
    if (!type || !raw.title) return null;
    const projectId =
      typeof raw.projectId === "string" && raw.projectId.trim()
        ? raw.projectId.trim()
        : undefined;
    return { ...raw, type, projectId };
  } catch {
    return null;
  }
}

export function artifactBodyString(body: ChatArtifact["body"]): string {
  if (typeof body === "string") return body;
  return JSON.stringify(body, null, 2);
}

const VEGA_LITE_SCHEMA = "https://vega.github.io/schema/vega-lite/v6.json";

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const match = cleaned.match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

/** Build chart iframe HTML synchronously (primary chart renderer for vegaLite artifacts). */
export function buildChartHtmlFromArtifactBody(
  body: unknown,
  title: string,
): string | null {
  const spec = coerceVegaLiteBody(body);
  if (!spec) return null;
  const prepared = prepareVegaLiteForEmbed(spec, title);
  return buildChartHtmlDocument(prepared, title) ?? buildChartHtmlDocument(spec, title);
}

/** Vega `body` may arrive as object, JSON string, raw rows array, or nested spec. */
export function coerceVegaLiteBody(body: unknown): Record<string, unknown> | null {
  if (Array.isArray(body)) {
    const rows = normalizeVegaRows(body);
    return rows.length ? { data: { values: rows } } : null;
  }

  let raw: Record<string, unknown> | null = null;
  if (body && typeof body === "object") {
    raw = body as Record<string, unknown>;
  } else if (typeof body === "string" && body.trim()) {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (Array.isArray(parsed)) {
        return coerceVegaLiteBody(parsed);
      }
      if (parsed && typeof parsed === "object") {
        raw = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  if (!raw) return null;

  if (vegaSpecHasRenderableData(raw)) {
    return raw;
  }

  if (Array.isArray(raw.values)) {
    const rows = normalizeVegaRows(raw.values);
    if (rows.length) return { data: { values: rows } };
  }

  for (const key of ["spec", "vegaLite", "vega-lite", "chart", "visualization", "view"]) {
    if (raw[key] != null) {
      const inner = coerceVegaLiteBody(raw[key]);
      if (inner && vegaSpecHasRenderableData(inner)) return inner;
    }
  }

  return raw;
}

export function extractVegaLiteValues(
  spec: Record<string, unknown>,
): Record<string, unknown>[] | null {
  const data = spec.data;
  if (data && typeof data === "object") {
    const values = (data as { values?: unknown }).values;
    if (Array.isArray(values) && values.length > 0) {
      return normalizeVegaRows(values);
    }
  }
  const layers = spec.layer;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (layer && typeof layer === "object") {
        const nested = extractVegaLiteValues(layer as Record<string, unknown>);
        if (nested?.length) return nested;
      }
    }
  }
  return null;
}

export function vegaSpecHasRenderableData(spec: Record<string, unknown>): boolean {
  return (extractVegaLiteValues(spec)?.length ?? 0) > 0;
}

function normalizeVegaRows(rows: unknown[]): Record<string, unknown>[] {
  return rows
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map((row) => {
      const out: Record<string, unknown> = { ...row };
      for (const [k, v] of Object.entries(out)) {
        const n = toNumber(v);
        if (n !== null) out[k] = n;
      }
      return out;
    });
}

export function canCompileVegaLite(spec: Record<string, unknown>): boolean {
  try {
    compile(spec as unknown as TopLevelSpec);
    return true;
  } catch {
    return false;
  }
}

/** True for a single-view bar/line spec (not layer/concat/facet). */
export function isSimpleVegaLiteSpec(spec: Record<string, unknown>): boolean {
  if (
    spec.layer ||
    spec.concat ||
    spec.facet ||
    spec.repeat ||
    spec.vconcat ||
    spec.hconcat
  ) {
    return false;
  }
  return Boolean(spec.mark);
}

/** Clone, schema, and safe defaults before vega-embed. */
export function prepareVegaLiteForEmbed(
  spec: Record<string, unknown>,
  artifactTitle: string,
): Record<string, unknown> {
  const base = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
  if (!base.$schema) base.$schema = VEGA_LITE_SCHEMA;
  if (base.width == null) base.width = 440;
  if (base.height == null) base.height = 300;
  if (base.title == null && artifactTitle.trim()) {
    base.title = artifactTitle.trim();
  }
  const values = extractVegaLiteValues(base);
  if (values) {
    base.data = { values };
  }
  if (isSimpleVegaLiteSpec(base)) {
    return enhanceVegaLiteSpec(base, artifactTitle);
  }
  return base;
}

/** Vega-Lite defaults when the model omits titles, axis labels, or sizing (simple specs only). */
export function enhanceVegaLiteSpec(
  spec: Record<string, unknown>,
  artifactTitle: string,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
  if (out.width == null) out.width = 440;
  if (out.height == null) out.height = 300;
  if (out.title == null && artifactTitle.trim()) {
    out.title = artifactTitle.trim();
  }
  const encoding = (out.encoding ?? {}) as Record<string, Record<string, unknown>>;
  // Only x/y get axis titles — axis on color/xOffset breaks grouped charts in Vega.
  for (const channel of ["x", "y"] as const) {
    const ch = encoding[channel];
    if (!ch || typeof ch !== "object") continue;
    const field = typeof ch.field === "string" ? ch.field : "";
    if (!ch.axis && field) {
      ch.axis = { title: humanizeFieldName(field) };
    }
    if (!ch.type && field) {
      const guessed = guessFieldType(out, field);
      if (guessed) ch.type = guessed;
    }
    encoding[channel] = ch;
  }
  out.encoding = encoding;
  delete out.config;
  return out;
}

/** @deprecated Use buildChartHtmlDocument */
export function vegaLiteFallbackHtml(
  spec: Record<string, unknown>,
  title: string,
): string | null {
  return buildChartHtmlDocument(spec, title);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function guessFieldType(
  spec: Record<string, unknown>,
  field: string,
): string | undefined {
  const data = spec.data as { values?: Record<string, unknown>[] } | undefined;
  const row = data?.values?.[0];
  if (!row) return undefined;
  const v = row[field];
  if (typeof v === "number") return "quantitative";
  if (typeof v === "string") return "ordinal";
  return undefined;
}

function humanizeFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Promote ```html / tables in chat text into renderable artifacts (mirrors Rust split). */
export function prepareAssistantMessage(
  content: string,
  existingArtifactJson?: string | null,
): PreparedAssistantMessage {
  if (existingArtifactJson?.trim()) {
    const parsed = parseArtifactJson(existingArtifactJson);
    if (parsed) {
      const cleaned = cleanAssistantDisplayText(content);
      return {
        content: cleaned || parsed.title,
        artifactJson: existingArtifactJson,
      };
    }
  }

  const split = splitAssistantContent(content);
  if (split.artifactJson) {
    return split;
  }

  return { content: cleanAssistantDisplayText(content) || content, artifactJson: undefined };
}

function splitAssistantContent(content: string): PreparedAssistantMessage {
  const artifactMatch = extractCaseInsensitiveFence(content, "artifact");
  if (artifactMatch) {
    const parsed = parseArtifactJson(artifactMatch.body.trim());
    if (parsed) {
      return finalizeSplit(content, artifactMatch, serializeArtifact(parsed));
    }
    try {
      const raw = JSON.parse(artifactMatch.body.trim()) as ChatArtifact & { type?: string };
      if (raw.type && raw.title) {
        return finalizeSplit(content, artifactMatch, JSON.stringify(raw));
      }
    } catch {
      /* fall through */
    }
  }

  for (const lang of ["html", "htm", "xml"]) {
    const fence = extractCaseInsensitiveFence(content, lang);
    if (fence && looksLikeHtml(fence.body)) {
      const artifact = buildHtmlArtifact(inferHtmlTitle(fence.body), fence.body);
      return finalizeSplit(content, fence, serializeArtifact(artifact));
    }
  }

  const unlabeled = extractUnlabeledHtmlFence(content);
  if (unlabeled) {
    const artifact = buildHtmlArtifact(inferHtmlTitle(unlabeled.body), unlabeled.body);
    return finalizeSplit(content, unlabeled, serializeArtifact(artifact));
  }

  for (const lang of ["json", "vega-lite", "vegalite"]) {
    const fence = extractCaseInsensitiveFence(content, lang);
    if (fence) {
      const vega = tryVegaArtifact(fence.body);
      if (vega) {
        return finalizeSplit(content, fence, serializeArtifact(vega));
      }
    }
  }

  const bareHtml = extractBareHtmlDocument(content);
  if (bareHtml) {
    const artifact = buildHtmlArtifact(inferHtmlTitle(bareHtml.html), bareHtml.html);
    return finalizeDisplay(bareHtml.before, bareHtml.after, serializeArtifact(artifact));
  }

  const table = extractMarkdownTable(content);
  if (table) {
    const html = markdownTableToHtmlDocument(table.rows, table.title);
    const artifact = buildHtmlArtifact(table.title, html);
    return finalizeDisplay(table.before, table.after, serializeArtifact(artifact));
  }

  return { content, artifactJson: undefined };
}

type FenceParts = { before: string; body: string; after: string };

function extractCaseInsensitiveFence(text: string, lang: string): FenceParts | null {
  const lower = text.toLowerCase();
  const marker = `\`\`\`${lang.toLowerCase()}`;
  const start = lower.indexOf(marker);
  if (start < 0) return null;
  const afterMarker = text.slice(start + marker.length).replace(/^[\r\n]+/, "");
  const end = afterMarker.indexOf("```");
  if (end < 0) return null;
  const body = afterMarker.slice(0, end).trim();
  if (!body) return null;
  return {
    before: text.slice(0, start).trimEnd(),
    body,
    after: afterMarker.slice(end + 3).trimStart(),
  };
}

function extractUnlabeledHtmlFence(text: string): FenceParts | null {
  const lower = text.toLowerCase();
  let searchFrom = 0;
  while (true) {
    const rel = lower.indexOf("```", searchFrom);
    if (rel < 0) return null;
    const start = rel;
    let i = start + 3;
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    if (i < text.length && /[a-zA-Z]/.test(text[i]!)) {
      searchFrom = start + 3;
      continue;
    }
    const bodyStart = text.slice(i);
    if (!looksLikeHtml(bodyStart)) {
      searchFrom = start + 3;
      continue;
    }
    const end = bodyStart.indexOf("```");
    if (end < 0) return null;
    const body = bodyStart.slice(0, end).trim();
    if (!body) {
      searchFrom = start + 3;
      continue;
    }
    return {
      before: text.slice(0, start).trimEnd(),
      body,
      after: bodyStart.slice(end + 3).trimStart(),
    };
  }
}

function extractBareHtmlDocument(text: string): { before: string; html: string; after: string } | null {
  const lower = text.toLowerCase();
  const idx = Math.min(
    ...["<!doctype", "<html"].map((needle) => {
      const i = lower.indexOf(needle);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    }),
  );
  if (idx === Number.MAX_SAFE_INTEGER) return null;
  const htmlPart = text.slice(idx);
  const endMatch = htmlPart.match(/<\/html>/i);
  const html = endMatch
    ? htmlPart.slice(0, endMatch.index! + endMatch[0].length)
    : htmlPart.trim();
  if (!looksLikeHtml(html)) return null;
  return {
    before: text.slice(0, idx).trimEnd(),
    html: html.trim(),
    after: endMatch ? htmlPart.slice(endMatch.index! + endMatch[0].length).trimStart() : "",
  };
}

function extractMarkdownTable(
  text: string,
): { before: string; after: string; rows: string[][]; title: string } | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\|.+\|\s*$/.test(lines[i]!)) {
      if (start < 0) start = i;
      end = i;
    } else if (start >= 0) {
      break;
    }
  }
  if (start < 0 || end - start < 1) return null;
  const tableLines = lines.slice(start, end + 1);
  if (tableLines.length < 2) return null;
  if (!/^\s*\|[\s\-:|]+\|\s*$/.test(tableLines[1]!)) return null;

  const parseRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const rows = tableLines
    .filter((_, i) => i !== 1)
    .map(parseRow)
    .filter((r) => r.some((c) => c.length > 0));
  if (rows.length < 1) return null;

  const before = lines.slice(0, start).join("\n").trimEnd();
  const after = lines.slice(end + 1).join("\n").trimStart();
  const titleLine = before.split(/\r?\n/).pop()?.trim() ?? "Report";
  const title = titleLine.length > 120 ? "Report" : titleLine.replace(/[:#*]+$/, "").trim() || "Report";

  return { before, after, rows, title };
}

function markdownTableToHtmlDocument(rows: string[][], title: string): string {
  const [header, ...body] = rows;
  const headCells = (header ?? []).map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const bodyRows = body
    .map(
      (row) =>
        `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 1rem; color: #1e293b; }
  h1 { font-size: 1.25rem; margin-bottom: 0.75rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 0.5rem 0.65rem; text-align: left; }
  th { background: #f1f5f9; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<table>
<thead><tr>${headCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;
}

function tryVegaArtifact(body: string): ChatArtifact | null {
  try {
    const value = JSON.parse(body.trim()) as Record<string, unknown>;
    if (
      value.mark ||
      value.layer ||
      value.encoding ||
      (typeof value.$schema === "string" && value.$schema.toLowerCase().includes("vega"))
    ) {
      const title =
        typeof value.title === "string" && value.title.trim() ? value.title : "Chart";
      return { type: "vegaLite", title, body: value };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function buildHtmlArtifact(title: string, html: string): ChatArtifact {
  return { type: "html", title: title.trim() || "Report", body: html };
}

function serializeArtifact(artifact: ChatArtifact): string {
  return JSON.stringify(artifact);
}

function finalizeSplit(_original: string, parts: FenceParts, artifactJson: string): PreparedAssistantMessage {
  return finalizeDisplay(parts.before, parts.after, artifactJson);
}

function finalizeDisplay(before: string, after: string, artifactJson: string): PreparedAssistantMessage {
  const parsed = parseArtifactJson(artifactJson);
  const title = parsed?.title ?? "Report";
  const chunks = [before.trim(), after.trim()].filter(Boolean);
  return {
    content: chunks.length ? chunks.join("\n\n") : title,
    artifactJson,
  };
}

function looksLikeHtml(s: string): boolean {
  const t = s.trimStart();
  if (!t.startsWith("<")) return false;
  const lower = t.toLowerCase();
  return (
    lower.includes("<html") ||
    lower.includes("<!doctype") ||
    lower.includes("<table") ||
    lower.includes("<body") ||
    lower.includes("<svg")
  );
}

function inferHtmlTitle(html: string): string {
  const lower = html.toLowerCase();
  for (const tag of ["<h1", "<h2", "<title"]) {
    const idx = lower.indexOf(tag);
    if (idx < 0) continue;
    const rest = html.slice(idx);
    const start = rest.indexOf(">");
    if (start < 0) continue;
    const inner = rest.slice(start + 1);
    const end = inner.indexOf("<");
    if (end < 0) continue;
    const title = inner.slice(0, end).trim();
    if (title && title.length <= 120) return title;
  }
  return "Report";
}

function cleanAssistantDisplayText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
