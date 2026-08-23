import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCleanFileRefresh } from "../src/lib/codingEditorRefresh.ts";

describe("applyCleanFileRefresh", () => {
  it("updates a still-clean tab from disk after an agent turn", () => {
    const current = {
      pathRel: "src/main.rs",
      content: "fn main() {}\n",
      savedContent: "fn main() {}\n",
      language: "rust",
    };
    const next = applyCleanFileRefresh(current, {
      content: "fn main() { println!(\"hi\"); }\n",
      language: "rust",
    });
    assert.equal(next.content, "fn main() { println!(\"hi\"); }\n");
    assert.equal(next.savedContent, "fn main() { println!(\"hi\"); }\n");
  });

  it("does not clobber keystrokes typed while the disk read was in flight", () => {
    const current = {
      pathRel: "src/main.rs",
      content: "fn main() {\n    // user typing\n}\n",
      savedContent: "fn main() {}\n",
      language: "rust",
    };
    const next = applyCleanFileRefresh(current, {
      content: "fn main() { /* agent edit */ }\n",
      language: "rust",
    });
    assert.equal(next.content, "fn main() {\n    // user typing\n}\n");
    assert.equal(next.savedContent, "fn main() {}\n");
    assert.equal(next, current);
  });
});
