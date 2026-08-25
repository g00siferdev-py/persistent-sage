import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldApplyCodingTranscriptLoad } from "../src/lib/codingTranscriptLoad.ts";

describe("shouldApplyCodingTranscriptLoad", () => {
  it("applies a reload when the visible coding thread and repo are unchanged", () => {
    assert.equal(
      shouldApplyCodingTranscriptLoad({
        loadedConversationId: "conv-a",
        loadedRepoId: "repo-a",
        activeConversationId: "conv-a",
        activeRepoId: "repo-a",
      }),
      true,
    );
  });

  it("rejects a post-send reload after the user switched repositories", () => {
    assert.equal(
      shouldApplyCodingTranscriptLoad({
        loadedConversationId: "conv-a",
        loadedRepoId: "repo-a",
        activeConversationId: "conv-b",
        activeRepoId: "repo-b",
      }),
      false,
    );
  });

  it("rejects a reload that matches the old conversation while a new repo is selected", () => {
    // Conversation ref can lag the repo click until get-or-create returns.
    assert.equal(
      shouldApplyCodingTranscriptLoad({
        loadedConversationId: "conv-a",
        loadedRepoId: "repo-a",
        activeConversationId: "conv-a",
        activeRepoId: "repo-b",
      }),
      false,
    );
  });

  it("rejects a reload when the visible thread was cleared during repo switch", () => {
    assert.equal(
      shouldApplyCodingTranscriptLoad({
        loadedConversationId: "conv-a",
        loadedRepoId: "repo-a",
        activeConversationId: null,
        activeRepoId: "repo-b",
      }),
      false,
    );
  });
});
