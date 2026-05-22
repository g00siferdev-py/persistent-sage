/** Settings panel width / visibility beside the chat area. */
export type SettingsLayoutMode = "hidden" | "compact" | "full";

const STORAGE_KEY = "nova.settingsLayoutMode";
const LAST_OPEN_KEY = "nova.settingsLayoutLastOpen";

export function loadSettingsLayoutMode(): SettingsLayoutMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "hidden" || v === "compact" || v === "full") return v;
  } catch {
    /* private mode */
  }
  return "hidden";
}

export function saveSettingsLayoutMode(mode: SettingsLayoutMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    if (mode !== "hidden") {
      localStorage.setItem(LAST_OPEN_KEY, mode);
    }
  } catch {
    /* ignore */
  }
}

export function loadLastOpenSettingsLayoutMode(): SettingsLayoutMode {
  try {
    const v = localStorage.getItem(LAST_OPEN_KEY);
    if (v === "compact" || v === "full") return v;
  } catch {
    /* ignore */
  }
  return "compact";
}

export function settingsLayoutLabel(mode: SettingsLayoutMode): string {
  switch (mode) {
    case "hidden":
      return "Hidden";
    case "compact":
      return "Compact";
    case "full":
      return "Full";
  }
}

export function cycleSettingsLayoutMode(current: SettingsLayoutMode): SettingsLayoutMode {
  if (current === "hidden") return loadLastOpenSettingsLayoutMode();
  if (current === "compact") return "full";
  return "hidden";
}
