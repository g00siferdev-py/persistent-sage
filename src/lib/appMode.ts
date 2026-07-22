/** Top-level product mode: companion chat vs coding workspace (Persistent Sage v2).
 *  A future "productivity" mode is planned between companion and coding. */
export type AppMode = "companion" | "coding";

/** Reserved for the upcoming Productivity Mode layout (not selectable yet). */
export type FutureAppMode = AppMode | "productivity";

const MODE_KEY = "persistent-sage.appMode";
const CONV_KEY = "persistent-sage.activeConversationId";
const REPO_KEY = "persistent-sage.activeRepoId";

export function loadAppMode(): AppMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (raw === "coding") return "coding";
  } catch {
    /* private mode */
  }
  return "companion";
}

export function saveAppMode(mode: AppMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function loadActiveConversationId(): string | null {
  try {
    const raw = localStorage.getItem(CONV_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

export function saveActiveConversationId(id: string | null): void {
  try {
    if (id?.trim()) localStorage.setItem(CONV_KEY, id.trim());
    else localStorage.removeItem(CONV_KEY);
  } catch {
    /* ignore */
  }
}

export function loadActiveRepoId(): string | null {
  try {
    const raw = localStorage.getItem(REPO_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

export function saveActiveRepoId(id: string | null): void {
  try {
    if (id?.trim()) localStorage.setItem(REPO_KEY, id.trim());
    else localStorage.removeItem(REPO_KEY);
  } catch {
    /* ignore */
  }
}

export function appModeLabel(mode: FutureAppMode): string {
  if (mode === "coding") return "Coding";
  if (mode === "productivity") return "Productivity";
  return "Companion";
}

export function appModeDescription(mode: FutureAppMode): string {
  if (mode === "coding") {
    return "Work on git repos under workspace/repos with shell and git tools.";
  }
  if (mode === "productivity") {
    return "Focused work sessions — coming in a future update.";
  }
  return "Chat, memory, personality, and collaborative projects.";
}
