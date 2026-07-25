import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/global.css";
import { initTheme } from "@/lib/theme";
import { installExternalNavigationGuard } from "@/lib/externalNavigation";
import App from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";

initTheme();
// Prevent raw <a href="https://…"> clicks (e.g. Markdown playground preview)
// from navigating the main Tauri webview and wiping in-memory app state.
installExternalNavigationGuard();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
