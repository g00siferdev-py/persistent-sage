import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  editorTabIsDirty,
  markWrittenContentSaved,
} from "../src/lib/codingEditorSave.ts";

describe("markWrittenContentSaved", () => {
  it("keeps later keystrokes dirty after a save of an earlier snapshot", () => {
    const written = "fn main() {}\n";
    const duringSave = "fn main() {\n    println!(\"hi\");\n}\n";
    const files = [
      {
        pathRel: "src/main.rs",
        content: duringSave,
        savedContent: "old",
      },
    ];

    const next = markWrittenContentSaved(files, "src/main.rs", written);

    assert.equal(next[0].savedContent, written);
    assert.equal(next[0].content, duringSave);
    assert.equal(editorTabIsDirty(next[0]!), true);
  });

  it("clears dirty when the live buffer still matches the written snapshot", () => {
    const written = "hello\n";
    const files = [
      {
        pathRel: "README.md",
        content: written,
        savedContent: "stale",
      },
    ];

    const next = markWrittenContentSaved(files, "README.md", written);

    assert.equal(next[0].savedContent, written);
    assert.equal(editorTabIsDirty(next[0]!), false);
  });

  it("does not touch other open tabs", () => {
    const files = [
      { pathRel: "a.ts", content: "a2", savedContent: "a1" },
      { pathRel: "b.ts", content: "b2", savedContent: "b1" },
    ];

    const next = markWrittenContentSaved(files, "a.ts", "a2");

    assert.equal(next[0].savedContent, "a2");
    assert.equal(next[1].savedContent, "b1");
    assert.equal(next[1].content, "b2");
  });
});
