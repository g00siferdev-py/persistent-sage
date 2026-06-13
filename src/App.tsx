import { useCallback, useState } from "react";
import { CompanionLayout, CodingLayout } from "@/components/layout";
import { loadAppMode, saveAppMode, type AppMode } from "@/lib/appMode";

function App() {
  const [mode, setModeState] = useState<AppMode>(() => loadAppMode());

  const setMode = useCallback((next: AppMode) => {
    saveAppMode(next);
    setModeState(next);
  }, []);

  if (mode === "coding") {
    return <CodingLayout onModeChange={setMode} />;
  }

  return <CompanionLayout onModeChange={setMode} />;
}

export default App;
