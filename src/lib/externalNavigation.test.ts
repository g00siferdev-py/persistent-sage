import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyAnchorHref } from "./externalNavigation.ts";

const PAGE = "http://localhost:1420/index.html";

describe("classifyAnchorHref", () => {
  it("allows same-document hash links", () => {
    assert.deepEqual(classifyAnchorHref("#section", PAGE), { type: "allow" });
    assert.deepEqual(classifyAnchorHref("index.html#section", PAGE), {
      type: "allow",
    });
  });

  it("opens absolute http(s) links externally", () => {
    assert.deepEqual(classifyAnchorHref("https://example.com", PAGE), {
      type: "open-external",
      url: "https://example.com/",
    });
    assert.deepEqual(classifyAnchorHref("http://example.com/path", PAGE), {
      type: "open-external",
      url: "http://example.com/path",
    });
  });

  it("opens rooted paths that would leave the SPA document externally when resolved to http", () => {
    // Relative paths resolve against the page origin; leaving the document must
    // not navigate the Tauri webview.
    assert.deepEqual(classifyAnchorHref("/other", PAGE), {
      type: "open-external",
      url: "http://localhost:1420/other",
    });
  });

  it("blocks javascript and credentialed URLs", () => {
    assert.deepEqual(classifyAnchorHref("javascript:alert(1)", PAGE), {
      type: "block",
    });
    assert.deepEqual(
      classifyAnchorHref("https://user:pass@example.com/secret", PAGE),
      { type: "block" },
    );
  });
});
