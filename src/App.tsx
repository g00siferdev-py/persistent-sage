import { useCallback, useState } from "react";
import { CompanionLayout, CodingLayout } from "@/components/layout";
import { ProductivityLayout } from "@/components/layout/ProductivityLayout";
import {
  loadActiveConversationId,
  loadActiveRepoId,
  loadAppMode,
  saveActiveConversationId,
  saveActiveRepoId,
  saveAppMode,
  type AppMode,
} from "@/lib/appMode";

function App() {
  const [mode, setModeState] = useState<AppMode>(() => loadAppMode());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    () => loadActiveConversationId(),
  );
  const [activeRepoId, setActiveRepoId] = useState<string | null>(() => loadActiveRepoId());

  const setMode = useCallback((next: AppMode) => {
    saveAppMode(next);
    setModeState(next);
  }, []);

  const setConversationId = useCallback((id: string | null) => {
    saveActiveConversationId(id);
    setActiveConversationId(id);
  }, []);

  const setRepoId = useCallback((id: string | null) => {
    saveActiveRepoId(id);
    setActiveRepoId(id);
  }, []);

  if (mode === "coding") {
    return (
      <CodingLayout
        activeConversationId={activeConversationId}
        activeRepoId={activeRepoId}
        onActiveConversationIdChange={setConversationId}
        onActiveRepoIdChange={setRepoId}
        onModeChange={setMode}
      />
    );
  }

  if (mode === "productivity") {
    return (
      <ProductivityLayout
        activeConversationId={activeConversationId}
        onModeChange={setMode}
      />
    );
  }

  return (
    <CompanionLayout
      activeConversationId={activeConversationId}
      onActiveConversationIdChange={setConversationId}
      onActiveRepoIdChange={setRepoId}
      onModeChange={setMode}
    />
  );
}

export default App;
