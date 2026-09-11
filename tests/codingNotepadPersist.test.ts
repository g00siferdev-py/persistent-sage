import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  codingNoteNeedsFlush,
  shouldClearDirtyAfterWrite,
  shouldReloadCodingNoteFromDisk,
} from "../src/lib/codingNotepadPersist.ts";

describe("codingNoteNeedsFlush", () => {
  it("flushes a dirty buffer on collapse, switch, create, and unmount", () => {
    for (const kind of ["collapse", "switch-note", "create-note", "unmount"] as const) {
      assert.equal(codingNoteNeedsFlush(true, kind), true);
      assert.equal(codingNoteNeedsFlush(false, kind), false);
    }
  });
});

describe("shouldReloadCodingNoteFromDisk", () => {
  it("does not reload when expanding the same note already in memory", () => {
    assert.equal(
      shouldReloadCodingNoteFromDisk({
        open: true,
        activeName: "Notes.txt",
        loadedName: "Notes.txt",
      }),
      false,
    );
  });

  it("loads from disk when switching to a note that is not in memory", () => {
    assert.equal(
      shouldReloadCodingNoteFromDisk({
        open: true,
        activeName: "Todo.txt",
        loadedName: "Notes.txt",
      }),
      true,
    );
  });

  it("loads on first open when nothing is in memory", () => {
    assert.equal(
      shouldReloadCodingNoteFromDisk({
        open: true,
        activeName: "Notes.txt",
        loadedName: null,
      }),
      true,
    );
  });

  it("does not load while collapsed", () => {
    assert.equal(
      shouldReloadCodingNoteFromDisk({
        open: false,
        activeName: "Notes.txt",
        loadedName: null,
      }),
      false,
    );
  });
});

describe("shouldClearDirtyAfterWrite", () => {
  it("keeps dirty when more was typed during the write", () => {
    assert.equal(
      shouldClearDirtyAfterWrite({
        writtenName: "Notes.txt",
        writtenContent: "hello",
        currentName: "Notes.txt",
        currentContent: "hello world",
      }),
      false,
    );
  });

  it("does not clear dirty for a write that targeted a previous note", () => {
    assert.equal(
      shouldClearDirtyAfterWrite({
        writtenName: "Notes.txt",
        writtenContent: "hello",
        currentName: "Todo.txt",
        currentContent: "hello",
      }),
      false,
    );
  });

  it("clears dirty when the live buffer still matches the write", () => {
    assert.equal(
      shouldClearDirtyAfterWrite({
        writtenName: "Notes.txt",
        writtenContent: "hello",
        currentName: "Notes.txt",
        currentContent: "hello",
      }),
      true,
    );
  });
});
