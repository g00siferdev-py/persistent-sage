export type Theme = "light" | "dark";

const STORAGE_KEY = "nova-theme";

/** Read persisted theme; defaults to dark to match Nova's original look. */
export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* private mode / blocked storage */
  }
  return "dark";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Call once at startup (and from index.html inline script before paint). */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
}

export function setDarkMode(enabled: boolean): void {
  setTheme(enabled ? "dark" : "light");
}

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}
