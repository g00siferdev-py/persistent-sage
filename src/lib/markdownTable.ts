/** A markdown table span promoted out of an assistant reply. */
export type MarkdownTableSpan = {
  before: string;
  after: string;
  rows: string[][];
  title: string;
};

/** Opening CommonMark fence: at least three ` or ~, plus an info string without that character. */
function openingFence(line: string): { ch: string; len: number } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const ch = trimmed[0]!;
  if (ch !== "`" && ch !== "~") return null;
  let len = 0;
  while (len < trimmed.length && trimmed[len] === ch) len += 1;
  if (len < 3 || trimmed.slice(len).includes(ch)) return null;
  return { ch, len };
}

function isClosingFence(line: string, ch: string, minLen: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length < minLen) return false;
  for (const c of trimmed) {
    if (c !== ch) return false;
  }
  return true;
}

/**
 * First markdown table that is not inside a code fence.
 * Tables in fenced samples stay in the reply so the source the user asked to copy is not rewritten.
 */
export function extractMarkdownTable(text: string): MarkdownTableSpan | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = -1;
  let fence: { ch: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (fence) {
      if (isClosingFence(line, fence.ch, fence.len)) fence = null;
      if (start >= 0) break;
      continue;
    }
    const opened = openingFence(line);
    if (opened) {
      if (start >= 0) break;
      fence = opened;
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line)) {
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
