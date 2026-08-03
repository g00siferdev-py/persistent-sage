import type { SettingsPatch } from "./settingsTypes";

/** Shallow-merge settings patches; later keys win. Used to coalesce debounced edits. */
export function mergeSettingsPatches(...patches: SettingsPatch[]): SettingsPatch {
  return Object.assign({}, ...patches);
}

export function settingsPatchHasKeys(patch: SettingsPatch): boolean {
  return Object.keys(patch).length > 0;
}
