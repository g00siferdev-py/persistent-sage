import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRepoFileRefresh,
  canSaveEditorFile,
  dirtyBuffersToStash,
  shouldApplyAsyncEditorResult,
  type RepoGuardedEditorFile,
} from "../src/lib/codingEditorRepoGuard.ts";

function tab(partial: Partial<RepoGuardedEditorFile> & Pick<RepoGuardedEditorFile, "pathRel" | "repoId">): RepoGuardedEditorFile {
  return {
    content: "old\n",
    savedContent: "old\n",
    language: "markdown",
    ...partial,
  };
}

describe("shouldApplyAsyncEditorResult", () => {
  it("applies when seq and repo still match the in-flight read", () => {
    assert.equal(
      shouldApplyAsyncEditorResult({
        startedSeq: 4,
        currentSeq: 4,
        startedRepoId: "repo-a",
        currentRepoId: "repo-a",
      }),
      true,
    );
  });

  it("rejects a read started before a repo switch (seq bump)", () => {
    assert.equal(
      shouldApplyAsyncEditorResult({
        startedSeq: 4,
        currentSeq: 5,
        startedRepoId: "repo-a",
        currentRepoId: "repo-b",
      }),
      false,
    );
  });

  it("rejects when the visible repo changed even if seq were reused", () => {
    assert.equal(
      shouldApplyAsyncEditorResult({
        startedSeq: 4,
        currentSeq: 4,
        startedRepoId: "repo-a",
        currentRepoId: "repo-b",
      }),
      false,
    );
  });

  it("rejects when no repo is selected", () => {
    assert.equal(
      shouldApplyAsyncEditorResult({
        startedSeq: 1,
        currentSeq: 1,
        startedRepoId: "repo-a",
        currentRepoId: null,
      }),
      false,
    );
  });
});

describe("canSaveEditorFile", () => {
  it("allows save only for the repo the tab was opened from", () => {
    const file = tab({ pathRel: "README.md", repoId: "repo-a" });
    assert.equal(canSaveEditorFile(file, "repo-a"), true);
    assert.equal(canSaveEditorFile(file, "repo-b"), false);
    assert.equal(canSaveEditorFile(file, null), false);
  });

  it("refuses save while the tab is still loading or in error", () => {
    assert.equal(
      canSaveEditorFile(tab({ pathRel: "README.md", repoId: "repo-a", loading: true }), "repo-a"),
      false,
    );
    assert.equal(
      canSaveEditorFile(tab({ pathRel: "README.md", repoId: "repo-a", error: "too large" }), "repo-a"),
      false,
    );
  });
});

describe("applyRepoFileRefresh", () => {
  it("updates a still-clean tab from the same repo after an agent turn", () => {
    const tabs = [tab({ pathRel: "README.md", repoId: "repo-a" })];
    const next = applyRepoFileRefresh(tabs, {
      pathRel: "README.md",
      content: "from disk A\n",
      language: "markdown",
      repoId: "repo-a",
    });
    assert.equal(next[0].content, "from disk A\n");
    assert.equal(next[0].savedContent, "from disk A\n");
  });

  it("does not copy repo A's disk contents into repo B's same-path tab", () => {
    const tabs = [
      tab({
        pathRel: "README.md",
        repoId: "repo-b",
        content: "repo B readme\n",
        savedContent: "repo B readme\n",
      }),
    ];
    const next = applyRepoFileRefresh(tabs, {
      pathRel: "README.md",
      content: "repo A readme\n",
      language: "markdown",
      repoId: "repo-a",
    });
    assert.equal(next[0].content, "repo B readme\n");
    assert.equal(next[0], tabs[0]);
  });

  it("does not clobber keystrokes typed while the disk read was in flight", () => {
    const tabs = [
      tab({
        pathRel: "src/main.rs",
        repoId: "repo-a",
        content: "fn main() { /* typing */ }\n",
        savedContent: "fn main() {}\n",
        language: "rust",
      }),
    ];
    const next = applyRepoFileRefresh(tabs, {
      pathRel: "src/main.rs",
      content: "fn main() { /* agent */ }\n",
      language: "rust",
      repoId: "repo-a",
    });
    assert.equal(next[0].content, "fn main() { /* typing */ }\n");
    assert.equal(next[0].savedContent, "fn main() {}\n");
  });
});

describe("dirtyBuffersToStash", () => {
  it("keeps unsaved tabs and drops clean ones so they reload from disk later", () => {
    const files = [
      tab({ pathRel: "clean.md", repoId: "repo-a" }),
      tab({
        pathRel: "dirty.md",
        repoId: "repo-a",
        content: "edits\n",
        savedContent: "original\n",
      }),
    ];
    const stash = dirtyBuffersToStash(files, "clean.md");
    assert.ok(stash);
    assert.deepEqual(
      stash.files.map((f) => f.pathRel),
      ["dirty.md"],
    );
    assert.equal(stash.activePath, "dirty.md");
  });

  it("returns null when every tab is clean", () => {
    const files = [tab({ pathRel: "README.md", repoId: "repo-a" })];
    assert.equal(dirtyBuffersToStash(files, "README.md"), null);
  });
});
