import { useCallback, useSyncExternalStore } from "react";
import {
  applyTheme,
  getStoredTheme,
  type Theme,
} from "@/lib/theme";

function subscribe(onStoreChange: () => void): () => void {
  const onClassChange = () => onStoreChange();
  const observer = new MutationObserver(onClassChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getThemeSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, () => getStoredTheme());

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
  }, []);

  const setDarkMode = useCallback((enabled: boolean) => {
    applyTheme(enabled ? "dark" : "light");
  }, []);

  return {
    theme,
    isDark: theme === "dark",
    setTheme,
    setDarkMode,
  };
}
