import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/global.css";
import { SplashScreen } from "@/components/SplashScreen";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <SplashScreen />
  </StrictMode>,
);
