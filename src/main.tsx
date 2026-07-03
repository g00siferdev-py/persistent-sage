import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/global.css";
import { initTheme } from "@/lib/theme";
import App from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";

initTheme();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
