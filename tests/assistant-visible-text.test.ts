import assert from "node:assert/strict";
import test from "node:test";
import {
  keepUnpromotedAssistantText,
  stripPromotedArtifactFences,
} from "../src/lib/assistantVisibleText.ts";

const htmlSnippet = [
  "Use this button:",
  "",
  "```html",
  '<button type="button">Save</button>',
  "```",
  "",
  "Wire it to the form handler.",
].join("\n");

const xmlSnippet = [
  "Add this dependency:",
  "",
  "```xml",
  "<dependency>",
  "  <groupId>com.example</groupId>",
  "</dependency>",
  "```",
].join("\n");

test("unpromoted HTML and XML snippets stay in the chat bubble", () => {
  assert.equal(keepUnpromotedAssistantText(htmlSnippet), htmlSnippet);
  assert.equal(keepUnpromotedAssistantText(xmlSnippet), xmlSnippet);
  assert.match(keepUnpromotedAssistantText(htmlSnippet), /<button type="button">Save<\/button>/);
  assert.match(keepUnpromotedAssistantText(xmlSnippet), /<groupId>com\.example<\/groupId>/);
});

test("other code fences are left intact", () => {
  const bash = "Run this:\n\n```bash\nnpm test\n```";
  assert.equal(keepUnpromotedAssistantText(bash), bash);
  assert.equal(stripPromotedArtifactFences(bash), bash);
});

test("promoted fences are removed so the artifact is not duplicated", () => {
  const cleaned = stripPromotedArtifactFences(htmlSnippet);
  assert.equal(cleaned, "Use this button:\n\nWire it to the form handler.");
  assert.doesNotMatch(cleaned, /<button/);
});
