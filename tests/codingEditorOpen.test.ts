import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOpenedFileFromDisk,
  editorTabIsDirty,
  shouldFetchEditorFile,
} from "../src/lib/codingEditorOpen.ts";

describe("shouldFetchEditorFile", () => {
  it("fetches a path that is not open yet", () => {
    assert.equal(shouldFetchEditorFile([], "README.md"), true);
  });

  it("does not re-fetch a loaded tab (dirty or clean)", () => {
    const dirty = [
      {
        pathRel: "README.md",
        content: "edited",
        savedContent: "on disk",
        language: "markdown",
      },
    ];
    const clean = [
      {
        pathRel: "README.md",
        content: "on disk",
        savedContent: "on disk",
        language: "markdown",
      },
    ];
    assert.equal(shouldFetchEditorFile(dirty, "README.md"), false);
    assert.equal(shouldFetchEditorFile(clean, "README.md"), false);
  });

  it("retries a tab that failed to load", () => {
    const tabs = [
      {
        pathRel: "src/main.rs",
        content: "",
        savedContent: "",
        language: "plaintext",
        error: "read failed",
      },
    ];
    assert.equal(shouldFetchEditorFile(tabs, "src/main.rs"), true);
  });
});

describe("applyOpenedFileFromDisk", () => {
  it("does not replace unsaved edits with a later disk read", () => {
    const tabs = [
      {
        pathRel: "README.md",
        content: "local edits the user has not saved",
        savedContent: "# README\n",
        language: "markdown",
        loading: false,
      },
    ];

    const next = applyOpenedFileFromDisk(tabs, "README.md", {
      content: "# README\n",
      language: "markdown",
    });

    assert.equal(next[0]!.content, "local edits the user has not saved");
    assert.equal(next[0]!.savedContent, "# README\n");
    assert.equal(editorTabIsDirty(next[0]!), true);
    assert.equal(next[0]!.loading, false);
  });

  it("fills a loading placeholder from disk", () => {
    const tabs = [
      {
        pathRel: "src/main.rs",
        content: "",
        savedContent: "",
        language: "plaintext",
        loading: true,
      },
    ];

    const next = applyOpenedFileFromDisk(tabs, "src/main.rs", {
      pathRel: "src/main.rs",
      content: "fn main() {}\n",
      language: "rust",
    });

    assert.equal(next[0]!.content, "fn main() {}\n");
    assert.equal(next[0]!.savedContent, "fn main() {}\n");
    assert.equal(next[0]!.language, "rust");
    assert.equal(next[0]!.loading, false);
    assert.equal(editorTabIsDirty(next[0]!), false);
  });

  it("does not touch other open tabs", () => {
    const tabs = [
      { pathRel: "a.ts", content: "a2", savedContent: "a1", language: "typescript" },
      {
        pathRel: "b.ts",
        content: "",
        savedContent: "",
        language: "plaintext",
        loading: true,
      },
    ];

    const next = applyOpenedFileFromDisk(tabs, "b.ts", {
      content: "export {}\n",
      language: "typescript",
    });

    assert.equal(next[0]!.content, "a2");
    assert.equal(next[0]!.savedContent, "a1");
    assert.equal(next[1]!.content, "export {}\n");
  });
});
