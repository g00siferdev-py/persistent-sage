import assert from "node:assert/strict";
import test from "node:test";
import { extractBareHtmlDocument } from "../src/lib/bareHtmlDocument.ts";

const page = ["<!DOCTYPE html>", "<html><body><h1>Plan</h1></body></html>"].join("\n");

test("a raw HTML document at the start of a line is promoted", () => {
  const input = `Here is the page.\n\n${page}\n\nDone.`;
  const span = extractBareHtmlDocument(input);
  assert.ok(span);
  assert.match(span.html, /<h1>Plan<\/h1>/);
  assert.match(span.before, /Here is the page/);
  assert.equal(span.after, "Done.");
});

test("a CRLF HTML document is promoted without eating the following sentence", () => {
  const input = "Here is the page.\r\n\r\n<!DOCTYPE html>\r\n<html><body><p>Hi</p></body></html>\r\n\r\nDone.";
  const span = extractBareHtmlDocument(input);
  assert.ok(span);
  assert.match(span.html, /<p>Hi<\/p>/);
  assert.match(span.before, /Here is the page/);
  assert.equal(span.after, "Done.");
});

test("mentioning the html tags does not promote the sentence", () => {
  const input =
    "The <html> element is the root, and you close it with </html>. Then add a body.";
  assert.equal(extractBareHtmlDocument(input), null);
});

test("an HTML page inside a code fence stays in the sample", () => {
  const input = [
    "```python",
    "from pathlib import Path",
    'Path("page.html").write_text("""<!DOCTYPE html>',
    "<html>",
    "<body><h1>Hello</h1></body>",
    "</html>",
    '""")',
    'print("done")',
    "```",
    "",
  ].join("\n");
  assert.equal(extractBareHtmlDocument(input), null);
});

test("an unclosed html tag does not swallow the rest of the reply", () => {
  const input = "The <html> element is the root of an HTML document. It wraps head and body.";
  assert.equal(extractBareHtmlDocument(input), null);
});
