import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/global.css";
import { initTheme } from "@/lib/theme";
import App from "@/App";

initTheme();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
