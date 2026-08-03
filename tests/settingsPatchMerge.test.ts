import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeSettingsPatches,
  settingsPatchHasKeys,
} from "../src/components/settings/settingsPatchMerge.ts";

test("mergeSettingsPatches keeps earlier fields when a later patch only has other keys", () => {
  const merged = mergeSettingsPatches(
    { pulseInstructions: "check inbox" },
    { pulseEnabled: true },
  );

  assert.deepEqual(merged, {
    pulseInstructions: "check inbox",
    pulseEnabled: true,
  });
});

test("mergeSettingsPatches lets later values win for the same key", () => {
  const merged = mergeSettingsPatches(
    { moltbookAgentPrompt: "draft A", moltbookInteractIntervalMinutes: 30 },
    { moltbookAgentPrompt: "draft B" },
  );

  assert.deepEqual(merged, {
    moltbookAgentPrompt: "draft B",
    moltbookInteractIntervalMinutes: 30,
  });
});

test("settingsPatchHasKeys distinguishes empty pending state", () => {
  assert.equal(settingsPatchHasKeys({}), false);
  assert.equal(settingsPatchHasKeys({ temperature: 0.8 }), true);
});
