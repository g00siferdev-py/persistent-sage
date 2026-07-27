import assert from "node:assert/strict";
import test from "node:test";

import { highlightCode } from "../src/lib/highlight.ts";

test("highlights normal C-family snippets", () => {
  const highlighted = highlightCode("int main(void) { return 0; }", "c");

  assert.match(highlighted, /hljs-/);
});

test("renders large C-family inputs as plaintext", () => {
  const code = "int value = 0;\n".repeat(600);

  assert.equal(highlightCode(code, "c"), code);
  assert.equal(highlightCode(code, "c++"), code);
});
