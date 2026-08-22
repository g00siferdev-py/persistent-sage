import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveBoundConversationId } from "../src/lib/liveBoundConversationId.ts";

describe("liveBoundConversationId", () => {
  it("prefers the live sidebar selection over a stale Settings snapshot", () => {
    assert.equal(
      liveBoundConversationId("live-thread", "stale-from-panel-open"),
      "live-thread",
    );
  });

  it("ignores blank live ids so a snapshot can still seed first-run", () => {
    assert.equal(liveBoundConversationId("  ", "pulse-thread"), "pulse-thread");
    assert.equal(liveBoundConversationId(null, "pulse-thread"), "pulse-thread");
    assert.equal(liveBoundConversationId(undefined, "pulse-thread"), "pulse-thread");
  });

  it("returns null when neither source has a conversation", () => {
    assert.equal(liveBoundConversationId(null, null), null);
    assert.equal(liveBoundConversationId("  ", "  "), null);
    assert.equal(liveBoundConversationId(undefined, undefined), null);
  });
});
