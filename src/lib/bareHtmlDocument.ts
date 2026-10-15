/** A raw HTML document lifted out of an assistant reply. */
export type BareHtmlSpan = {
  before: string;
  html: string;
  after: string;
};

/**
 * Find a raw HTML document that should become an artifact.
 *
 * The opener must sit at the start of a line, outside a markdown fence, and
 * the span must close with `</html>` before the next fence. A sentence that
 * mentions the tags, or a page embedded in a code sample, is left alone —
 * promoting that span removes it from the stored chat text.
 */
export function extractBareHtmlDocument(text: string): BareHtmlSpan | null {
  let inFence = false;
  let docStart = -1;
  let offset = 0;

  for (const line of text.split(/(?<=\n)/)) {
    const body = line.endsWith("\n") ? line.slice(0, -1).replace(/\r$/, "") : line.replace(/\r$/, "");
    const trimmed = body.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence && docStart < 0 && lineOpensHtmlDocument(body)) {
      const rel = body.indexOf("<");
      docStart = offset + (rel < 0 ? 0 : rel);
    }
    offset += line.length;
  }

  if (docStart < 0) return null;
  const htmlPart = text.slice(docStart);
  const endMatch = /<\/html>/i.exec(htmlPart);
  if (!endMatch || endMatch.index == null) return null;
  const raw = htmlPart.slice(0, endMatch.index + endMatch[0].length);
  if (raw.split(/\r?\n/).some((line) => line.trim().startsWith("```"))) return null;
  const html = raw.trim();
  if (!html) return null;
  return {
    before: text.slice(0, docStart).trimEnd(),
    html,
    after: htmlPart.slice(endMatch.index + endMatch[0].length).trimStart(),
  };
}

function lineOpensHtmlDocument(line: string): boolean {
  const lower = line.trim().toLowerCase();
  return lower.startsWith("<!doctype") || lower.startsWith("<html");
}
