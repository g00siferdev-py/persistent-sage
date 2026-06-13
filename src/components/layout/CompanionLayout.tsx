import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChat } from "@/hooks/useChat";
import { ChatMain } from "@/components/chat/ChatMain";
import { ConversationSidebar } from "@/components/sidebar/ConversationSidebar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { AppModeSwitcher } from "@/components/layout/AppModeSwitcher";
import {
  cycleSettingsLayoutMode,
  loadSettingsLayoutMode,
  saveSettingsLayoutMode,
  type SettingsLayoutMode,
} from "@/lib/settingsLayout";
import type { AppMode } from "@/lib/appMode";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { buildWhatsNewContent, WhatsNewModal } from "@/components/WhatsNewModal";

/** Subset of `settings_get` for the main-window provider hint (no secrets). */
type SettingsForHint = {
  selectedProvider: string;
  hasOpenaiApiKey: boolean;
  hasAnthropicApiKey: boolean;
  hasOllamaApiKey: boolean;
  hasGeminiApiKey: boolean;
  hasXaiApiKey: boolean;
  thinkingEffort: "low" | "medium" | "high";
  onboardingCompleted: boolean;
  whatsNewSeenVersion?: string;
};

type Props = {
  onModeChange: (mode: AppMode) => void;
};

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Companion mode shell — chat, memory, personality, and collaborative projects. */
export function CompanionLayout({ onModeChange }: Props) {
  const [settingsLayoutMode, setSettingsLayoutMode] = useState<SettingsLayoutMode>(() =>
    loadSettingsLayoutMode(),
  );
  const [backendHint, setBackendHint] = useState<string | null>(null);
  const [thinkingEffort, setThinkingEffort] = useState<"low" | "medium" | "high">("medium");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const prevSettingsLayoutMode = useRef<SettingsLayoutMode>(settingsLayoutMode);

  const maybeShowWhatsNew = useCallback(async () => {
    try {
      const [version, settings] = await Promise.all([
        invoke<string>("app_version"),
        invoke<SettingsForHint>("settings_get"),
      ]);
      if (!settings.onboardingCompleted) return;
      const seen = (settings.whatsNewSeenVersion ?? "").trim();
      const current = version.trim();
      if (seen === current) return;
      setWhatsNewVersion(current);
      setShowWhatsNew(true);
    } catch {
      /* ignore */
    }
  }, []);

  const dismissWhatsNew = useCallback(async () => {
    const version = whatsNewVersion;
    if (version) {
      try {
        await invoke("settings_update", { patch: { whatsNewSeenVersion: version } });
      } catch {
        /* ignore */
      }
    }
    setShowWhatsNew(false);
    setWhatsNewVersion(null);
  }, [whatsNewVersion]);

  const setSettingsLayout = useCallback((mode: SettingsLayoutMode) => {
    setSettingsLayoutMode(mode);
    saveSettingsLayoutMode(mode);
  }, []);

  const cycleSettingsLayout = useCallback(() => {
    setSettingsLayout(cycleSettingsLayoutMode(settingsLayoutMode));
  }, [settingsLayoutMode, setSettingsLayout]);

  const loadBackendHint = useCallback(async () => {
    try {
      const s = await invoke<SettingsForHint>("settings_get");
      setThinkingEffort(s.thinkingEffort ?? "medium");
      const p = (s.selectedProvider ?? "placeholder").trim().toLowerCase();
      if (p === "placeholder") {
        setBackendHint(
          "This install is using the offline placeholder model — nothing is sent to OpenAI, Anthropic, Google, xAI, or Ollama. Open Settings → Provider and pick a live backend (and API key if required). Settings live in your Persistent Sage data folder, not the git repo, so each computer starts with its own copy.",
        );
        return;
      }
      if (p === "openai" && !s.hasOpenaiApiKey) {
        setBackendHint(
          "OpenAI is selected but no API key is stored on this machine. Add a key under Settings → OpenAI.",
        );
        return;
      }
      if (p === "anthropic" && !s.hasAnthropicApiKey) {
        setBackendHint(
          "Anthropic is selected but no API key is stored on this machine. Add a key under Settings → Anthropic.",
        );
        return;
      }
      if (p === "ollama_cloud" && !s.hasOllamaApiKey) {
        setBackendHint(
          "Ollama Cloud is selected but no API key is stored. Add a key under Settings, or switch to local Ollama.",
        );
        return;
      }
      if (p === "gemini" && !s.hasGeminiApiKey) {
        setBackendHint(
          "Google Gemini is selected but no API key is stored on this machine. Add a key under Settings → Provider → Google Gemini.",
        );
        return;
      }
      if (p === "xai" && !s.hasXaiApiKey) {
        setBackendHint(
          "xAI Grok is selected but no API key is stored on this machine. Add a key under Settings → Provider → xAI.",
        );
        return;
      }
      setBackendHint(null);
    } catch {
      setBackendHint(null);
    }
  }, []);

  useEffect(() => {
    void loadBackendHint();
  }, [loadBackendHint]);

  useEffect(() => {
    void (async () => {
      try {
        const s = await invoke<SettingsForHint>("settings_get");
        setThinkingEffort(s.thinkingEffort ?? "medium");
        setShowOnboarding(!s.onboardingCompleted);
      } catch {
        setShowOnboarding(false);
      } finally {
        setOnboardingChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!onboardingChecked || showOnboarding) return;
    void maybeShowWhatsNew();
  }, [onboardingChecked, showOnboarding, maybeShowWhatsNew]);

  const {
    conversations,
    conversationsForTitle,
    threadListHiddenFromSidebar,
    clearConversationSidebarView,
    restoreConversationSidebarView,
    activeConversationId,
    messages,
    briefing,
    anchors,
    listLoading,
    threadLoading,
    sending,
    streamAssistant,
    error,
    selectConversation,
    startNewConversation,
    renameConversation,
    deleteConversation,
    extractAnchorsFromChat,
    extractingAnchors,
    sendMessage,
    visionSupported,
    refreshVisionSupported,
    recipes,
    runRecipe,
    submitArtifactForm,
    projectList,
    activeProjectId,
    continueProject,
    openProjectWorkspace,
    applyActivePersonality,
    activePersonalityId,
    activeCompanionLabel,
    companionOptions,
  } = useChat();

  useEffect(() => {
    if (prevSettingsLayoutMode.current !== "hidden" && settingsLayoutMode === "hidden") {
      void loadBackendHint();
      void refreshVisionSupported();
    }
    prevSettingsLayoutMode.current = settingsLayoutMode;
  }, [settingsLayoutMode, loadBackendHint, refreshVisionSupported]);

  const title = useMemo(() => {
    if (!activeConversationId) return "Sage";
    return (
      conversationsForTitle.find((c) => c.id === activeConversationId)?.title ?? "Chat"
    );
  }, [activeConversationId, conversationsForTitle]);

  const subtitle = threadLoading
    ? "Loading context from MemoryAnchor…"
    : truncate(briefing, 120) || "Local SQLite · private by default";

  const updateThinkingEffort = useCallback(async (effort: "low" | "medium" | "high") => {
    setThinkingEffort(effort);
    try {
      await invoke<SettingsForHint>("settings_update", {
        patch: { thinkingEffort: effort },
      });
    } catch {
      void loadBackendHint();
    }
  }, [loadBackendHint]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {onboardingChecked && showOnboarding ? (
        <OnboardingWizard
          onComplete={() => {
            setShowOnboarding(false);
            void loadBackendHint();
            void maybeShowWhatsNew();
          }}
        />
      ) : null}
      {onboardingChecked && !showOnboarding && showWhatsNew && whatsNewVersion ? (
        <WhatsNewModal
          content={buildWhatsNewContent(whatsNewVersion)}
          onDismiss={() => void dismissWhatsNew()}
        />
      ) : null}
      <div className="flex shrink-0 items-center border-b border-slate-800/80 bg-slate-900/50 px-3 py-1.5">
        <AppModeSwitcher mode="companion" onModeChange={onModeChange} />
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ConversationSidebar
          conversations={conversations}
          hasThreadsInDatabase={conversationsForTitle.length > 0}
          threadListHiddenFromSidebar={threadListHiddenFromSidebar}
          onClearThreadListFromView={clearConversationSidebarView}
          onRestoreThreadListFromView={() => void restoreConversationSidebarView()}
          activeId={activeConversationId}
          onSelect={selectConversation}
          onNewChat={() => void startNewConversation()}
          onRename={(id, title) => void renameConversation(id, title)}
          onDelete={(id) => void deleteConversation(id)}
          listLoading={listLoading}
          briefing={briefing}
          briefingLoading={threadLoading && !!activeConversationId}
          anchors={anchors}
          extractingAnchors={extractingAnchors}
          onExtractAnchors={() => void extractAnchorsFromChat()}
          companionName={activeCompanionLabel}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {backendHint ? (
            <div
              role="status"
              className="shrink-0 border-b border-sky-800/50 bg-sky-950/50 px-4 py-2 text-xs leading-relaxed text-sky-100/95"
            >
              {backendHint}
            </div>
          ) : null}
          <ChatMain
            title={title}
            subtitle={subtitle}
            hasActiveConversation={activeConversationId != null}
            messages={messages}
            threadLoading={threadLoading}
            sending={sending}
            streamAssistant={streamAssistant}
            error={error}
            recipes={recipes}
            onRunRecipe={(id) => void runRecipe(id)}
            onSubmitArtifactForm={(title, projectId, values) =>
              void submitArtifactForm(title, projectId, values)
            }
            projectList={projectList}
            activeProjectId={activeProjectId}
            onContinueProject={(id, title) => continueProject(id, title)}
            onOpenProjectWorkspace={() => void openProjectWorkspace()}
            settingsLayoutMode={settingsLayoutMode}
            onCycleSettingsLayout={() => cycleSettingsLayout()}
            onSendMessage={(text, image) =>
              void sendMessage(text, image
                ? { base64: image.base64, mime: image.mime, previewUrl: image.previewUrl }
                : null)
            }
            visionSupported={visionSupported}
            activeCompanionProfileId={activePersonalityId}
            activeCompanionLabel={activeCompanionLabel}
            companionOptions={companionOptions}
            thinkingEffort={thinkingEffort}
            onThinkingEffortChange={updateThinkingEffort}
            onCompanionChange={async (profileId) => {
              await applyActivePersonality(profileId);
            }}
          />
        </div>
        <SettingsPanel
          layoutMode={settingsLayoutMode}
          onLayoutModeChange={setSettingsLayout}
          chatActiveProfileId={activePersonalityId}
          onCompanionActiveProfileChange={(profileId) =>
            void applyActivePersonality(profileId)
          }
          onRequestOnboarding={() => setShowOnboarding(true)}
        />
      </div>
    </div>
  );
}

/** @deprecated Use `CompanionLayout` — kept for transitional imports. */
export const ChatLayout = CompanionLayout;
