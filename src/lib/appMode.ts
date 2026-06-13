/** Top-level product mode: companion chat vs coding workspace (Persistent Sage v2). */
export type AppMode = "companion" | "coding";

const STORAGE_KEY = "persistent-sage.appMode";

export function loadAppMode(): AppMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "companion" || v === "coding") return v;
  } catch {
    /* private mode */
  }
  return "companion";
}

export function saveAppMode(mode: AppMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function appModeLabel(mode: AppMode): string {
  return mode === "coding" ? "Coding" : "Companion";
}

export function appModeDescription(mode: AppMode): string {
  return mode === "coding"
    ? "Work on git repos under workspace/repos with shell and git tools."
    : "Chat, memory, personality, and collaborative projects.";
}
