import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Moon,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { SettingsSection, SettingsToggleCard } from "@/components/settings/settingsUi";
import {
  applySettingsPatch,
  feedbackIssueUrl,
  normalizeCacheInfo,
} from "@/components/settings/settingsHelpers";
import type {
  AppDataPaths,
  CacheInfo,
  DestructiveModal,
  DistributionInfo,
  FeedbackKind,
  PendingUpdate,
  PulseTickPayload,
  SettingsPatch,
  SettingsView,
  StoreUpdateCheckResult,
} from "@/components/settings/settingsTypes";
import { useTheme } from "@/hooks/useTheme";
import { toolDisplayName } from "@/lib/toolDisplayNames";

const MEMORY_LLM_INFO = (
  <>
    After each user message, Persistent Sage asks your chat provider to extract durable facts (health, preferences,
    accessibility) as curated anchors. Uses a small JSON completion — not the full reply. Off falls back to keyword
    heuristics only.
  </>
);

const MEMORY_SEMANTIC_INFO = (
  <>
    Embeds anchor text in the background (small batches). During chat, your companion can use{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("memory_search")}</strong> for
    semantic lookup — not a blocking network call on every message. Requires OpenAI, <strong>local</strong> Ollama (
    <code className="font-mono text-[10px]">ollama pull nomic-embed-text</code>), or local Ollama when chat uses
    Anthropic or Ollama Cloud.
  </>
);

const MEMORY_WIPE_COPY = `This will permanently delete ALL conversations, messages, anchors, and memories across every personality.
Persistent Sage will forget everything it has learned about you.
Your API keys, settings, and personality profiles will be preserved.This action cannot be undone.
To proceed, type CONFIRM and click Wipe.`;

const FACTORY_RESET_COPY = `This will permanently delete ALL conversations, memories, anchors, and settings.
Persistent Sage will forget everything it has ever learned about you.
This action cannot be undone.To proceed, type CONFIRM in the box below and click Reset.`;

export type GeneralSettingsTabProps = {
  settings: SettingsView | null;
  setSettings: Dispatch<SetStateAction<SettingsView | null>>;
  schedulePatch: (patch: SettingsPatch) => void;
  flushDebounce: () => Promise<void>;
  setError: (error: string | null) => void;
  refreshSettings: () => Promise<void>;
  onRequestOnboarding?: () => void;
  /** When false, clears destructive modal state (panel closed). */
  panelOpen: boolean;
};

export function GeneralSettingsTab({
  settings,
  setSettings,
  schedulePatch,
  flushDebounce,
  setError,
  refreshSettings,
  onRequestOnboarding,
  panelOpen,
}: GeneralSettingsTabProps) {
  const { isDark, setDarkMode } = useTheme();
  const [backend, setBackend] = useState<string | null>(null);
  const [destructiveModal, setDestructiveModal] = useState<DestructiveModal | null>(null);
  const [wipeConfirmInput, setWipeConfirmInput] = useState("");
  const [memoryReindexing, setMemoryReindexing] = useState(false);
  const [memoryReindexResult, setMemoryReindexResult] = useState<string | null>(null);
  const [wiping, setWiping] = useState(false);
  const [dataPaths, setDataPaths] = useState<AppDataPaths | null>(null);
  const [revealPathError, setRevealPathError] = useState<string | null>(null);
  const [lastPulse, setLastPulse] = useState<PulseTickPayload | null>(null);
  const [pulseNowLoading, setPulseNowLoading] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null);
  const [updateProgress, setUpdateProgress] = useState<string | null>(null);
  const [distributionInfo, setDistributionInfo] = useState<DistributionInfo | null>(null);
  const [storeUpdateAvailable, setStoreUpdateAvailable] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const loadVersion = useCallback(async () => {
    try {
      const v = await invoke<string>("app_version");
      setBackend(v);
    } catch {
      setBackend("Unavailable (open via Tauri)");
    }
  }, []);

  const refreshDataPaths = useCallback(async () => {
    try {
      const p = await invoke<AppDataPaths>("app_data_paths");
      setDataPaths(p);
    } catch {
      setDataPaths(null);
    }
  }, []);

  const refreshDistributionInfo = useCallback(async () => {
    try {
      const info = await invoke<DistributionInfo>("app_distribution_info");
      setDistributionInfo(info);
    } catch {
      setDistributionInfo(null);
    }
  }, []);

  const loadCacheInfo = useCallback(async () => {
    try {
      setCacheError(null);
      const info = normalizeCacheInfo(await invoke<CacheInfo>("cache_info"));
      setCacheInfo(info);
    } catch (e) {
      setCacheInfo(null);
      setCacheError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const clearCache = useCallback(async () => {
    try {
      setCacheLoading(true);
      setCacheError(null);
      await invoke("clear_cache");
      await loadCacheInfo();
    } catch (e) {
      setCacheError(e instanceof Error ? e.message : String(e));
    } finally {
      setCacheLoading(false);
    }
  }, [loadCacheInfo]);

  const revealCacheDirectory = useCallback(async () => {
    try {
      setCacheError(null);
      await invoke("reveal_cache_directory");
    } catch (e) {
      setCacheError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    void refreshDataPaths();
    void refreshDistributionInfo();
    void loadCacheInfo();
  }, [panelOpen, refreshDataPaths, refreshDistributionInfo, loadCacheInfo]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<PulseTickPayload>("pulse:tick", (e) => {
      setLastPulse(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!panelOpen) {
      setDestructiveModal(null);
      setWipeConfirmInput("");
    }
  }, [panelOpen]);

  const checkForUpdates = useCallback(async () => {
    try {
      setUpdateBusy(true);
      setUpdateStatus(null);
      setUpdateProgress(null);
      setPendingUpdate(null);
      setStoreUpdateAvailable(false);

      if (distributionInfo?.updatesViaMicrosoftStore) {
        const result = await invoke<StoreUpdateCheckResult>("check_store_updates");
        setUpdateStatus(result.message);
        setStoreUpdateAvailable(result.updateAvailable);
        return;
      }

      const { check } = await import("@tauri-apps/plugin-updater");
      const update = (await check({ timeout: 30_000 })) as PendingUpdate | null;
      if (!update) {
        setUpdateStatus("Persistent Sage is up to date.");
        return;
      }
      setPendingUpdate(update);
      setUpdateStatus(`Update ${update.version} is available.`);
    } catch (e) {
      setUpdateStatus(`Could not check for updates: ${String(e)}`);
    } finally {
      setUpdateBusy(false);
    }
  }, [distributionInfo?.updatesViaMicrosoftStore]);

  const installPendingUpdate = useCallback(async () => {
    if (distributionInfo?.updatesViaMicrosoftStore) {
      if (!storeUpdateAvailable) return;
      try {
        setUpdateBusy(true);
        setUpdateStatus("Starting Microsoft Store update…");
        setUpdateProgress(null);
        const result = await invoke<{ message: string; restartRequired: boolean }>("install_store_updates");
        setUpdateStatus(result.message);
        if (result.restartRequired) {
          setUpdateProgress(
            "If Windows does not restart the app automatically, close and reopen Persistent Sage after the Store finishes.",
          );
        }
      } catch (e) {
        setUpdateStatus(`Could not install update: ${String(e)}`);
      } finally {
        setUpdateBusy(false);
      }
      return;
    }

    if (!pendingUpdate) return;
    try {
      setUpdateBusy(true);
      setUpdateStatus(`Downloading Persistent Sage ${pendingUpdate.version}…`);
      setUpdateProgress(null);
      await pendingUpdate.downloadAndInstall((event) => {
        const payload = event as
          | { event: "Started"; data: { contentLength?: number } }
          | { event: "Progress"; data: { chunkLength: number } }
          | { event: "Finished" };
        if (payload.event === "Started") {
          const bytes = payload.data.contentLength;
          setUpdateProgress(bytes ? `Download started (${bytes.toLocaleString()} bytes).` : "Download started.");
        } else if (payload.event === "Progress") {
          setUpdateProgress(`Downloaded another ${payload.data.chunkLength.toLocaleString()} bytes…`);
        } else if (payload.event === "Finished") {
          setUpdateProgress("Download finished. Installing update…");
        }
      });
      setUpdateStatus("Update installed. Restarting Persistent Sage…");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setUpdateStatus(`Could not install update: ${String(e)}`);
      setUpdateBusy(false);
    }
  }, [distributionInfo?.updatesViaMicrosoftStore, pendingUpdate, storeUpdateAvailable]);

  const openFeedback = useCallback(
    async (kind: FeedbackKind) => {
      try {
        setError(null);
        await invoke("open_feedback_issue", {
          issueUrl: feedbackIssueUrl(kind, settings, backend, dataPaths),
        });
      } catch (e) {
        setError(String(e));
      }
    },
    [backend, dataPaths, settings, setError],
  );

  return (
    <>
      <SettingsSection title="Setup" description="First-run wizard and install type.">
        <button
          type="button"
          onClick={() => onRequestOnboarding?.()}
          className="w-full rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2.5 text-sm font-medium text-indigo-800 transition hover:bg-indigo-500/20 dark:text-indigo-200"
        >
          Run setup wizard again
        </button>
        <p className="text-[11px] text-slate-500">
          Provider, API keys, and desktop vs USB storage tips. Windows installer guide:{" "}
          <span className="font-mono text-slate-600 dark:text-slate-400">docs/INSTALL-WINDOWS.md</span>
        </p>
      </SettingsSection>

      <SettingsSection
        title="Updates"
        description={
          distributionInfo?.updatesViaMicrosoftStore
            ? "Checks the Microsoft Store for package updates (same button as GitHub installs—different source)."
            : "Checks GitHub Releases for signed update packages (NSIS installer, portable, or build from source)."
        }
      >
        <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-950/35 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={updateBusy}
              onClick={() => void checkForUpdates()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateBusy &&
              !pendingUpdate &&
              !storeUpdateAvailable ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              Check for updates
            </button>
            <button
              type="button"
              disabled={
                updateBusy ||
                (distributionInfo?.updatesViaMicrosoftStore
                  ? !storeUpdateAvailable
                  : !pendingUpdate)
              }
              onClick={() => void installPendingUpdate()}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateBusy &&
              (pendingUpdate || storeUpdateAvailable) ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              Download & install
            </button>
          </div>
          {updateStatus ? (
            <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">{updateStatus}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-500">
              {distributionInfo?.updatesViaMicrosoftStore
                ? "Microsoft Store installs never download updates from GitHub."
                : "GitHub installs are verified with Persistent Sage&apos;s Tauri updater key before installation."}
            </p>
          )}
          {pendingUpdate?.body ? (
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 dark:border-slate-800/60 bg-white/70 dark:bg-slate-950/50 p-2 text-[10px] leading-relaxed text-slate-500">
              {pendingUpdate.body}
            </p>
          ) : null}
          {updateProgress ? (
            <p className="text-[10px] text-slate-500">{updateProgress}</p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Send feedback"
        description="Send public bug reports and ideas to the Persistent Sage GitHub issue tracker."
      >
        <div className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-950/35 p-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            These buttons open your browser with a prefilled GitHub Issue. Persistent Sage does not attach chats,
            Memory Anchors, logs, or API keys automatically.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void openFeedback("bug")}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-300/70 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/25 px-3 py-2 text-xs font-semibold text-rose-800 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-950/40"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Report a bug
            </button>
            <button
              type="button"
              onClick={() => void openFeedback("idea")}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-300/70 dark:border-indigo-800/70 bg-indigo-50 dark:bg-indigo-950/25 px-3 py-2 text-xs font-semibold text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-950/40"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Suggest an idea
            </button>
            <button
              type="button"
              onClick={() => void openFeedback("feedback")}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300/70 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/25 px-3 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950/40"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              General feedback
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Appearance">
        <SettingsToggleCard
          id="dark-mode"
          title={
            <span className="inline-flex items-center gap-2">
              <Moon className="size-4 text-indigo-400 dark:text-indigo-300" aria-hidden />
              Dark mode
            </span>
          }
          description="Use dark colors across Persistent Sage. Saved on this device."
          checked={isDark}
          onChange={setDarkMode}
        />
      </SettingsSection>

      <section className="space-y-3 rounded-lg border border-violet-900/35 bg-violet-950/12 p-3 ring-1 ring-violet-800/25">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-violet-300" aria-hidden />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-violet-200/90">Pulse</h3>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          On a timer, Persistent Sage runs a <strong className="font-medium text-slate-700 dark:text-slate-300">background check-in</strong> using
          the chat thread you have open for context. Your Pulse instructions are <strong className="font-medium text-slate-700 dark:text-slate-300">not</strong> shown
          in chat; the assistant reply appears there as <span className="font-mono text-slate-600 dark:text-slate-400">Pulse Response : [time] - …</span>.
          A copy also appears below under <strong className="font-medium text-slate-700 dark:text-slate-300">Last result</strong>.
          Keep that thread selected in the sidebar while Pulse is on. Enable tools under the <strong className="font-medium text-slate-700 dark:text-slate-300">Tools</strong> tab
          (for example workspace writes to <span className="font-mono text-slate-600 dark:text-slate-400">Journal.md</span> or web fetch) if your Pulse instructions need them.
        </p>
        {settings?.pulseConversationId ? (
          <p className="font-mono text-[10px] text-slate-500" title={settings.pulseConversationId}>
            Bound thread:{" "}
            {settings.pulseConversationId.length > 14
              ? `${settings.pulseConversationId.slice(0, 12)}…`
              : settings.pulseConversationId}
          </p>
        ) : (
          <p className="text-[10px] text-amber-400/90">No thread bound — select a conversation in the sidebar.</p>
        )}
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-950/35 px-3 py-2.5">
          <input
            id="pulse-enabled"
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-slate-300 dark:border-slate-600 accent-violet-500"
            checked={settings?.pulseEnabled ?? false}
            disabled={!settings}
            onChange={(e) => {
              const pulseEnabled = e.target.checked;
              setSettings((s) => (s ? { ...s, pulseEnabled } : s));
              void (async () => {
                try {
                  setError(null);
                  await flushDebounce();
                  const next = await applySettingsPatch({ pulseEnabled });
                  setSettings(next);
                } catch (err) {
                  setError(String(err));
                  await refreshSettings();
                }
              })();
            }}
          />
          <div className="min-w-0 space-y-1">
            <label htmlFor="pulse-enabled" className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300">
              Enable Pulse
            </label>
            <p className="text-[11px] text-slate-500">
              Requires a real provider (not Placeholder). The first tick runs after one full interval from app
              startup.
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="pulse-interval">
            Interval (minutes)
          </label>
          <input
            id="pulse-interval"
            type="number"
            min={1}
            max={1440}
            disabled={!settings}
            value={settings?.pulseIntervalMinutes ?? 15}
            onChange={(e) => {
              const raw = Number.parseInt(e.target.value, 10);
              const pulseIntervalMinutes = Number.isNaN(raw) ? 15 : Math.min(1440, Math.max(1, raw));
              setSettings((s) => (s ? { ...s, pulseIntervalMinutes } : s));
              schedulePatch({ pulseIntervalMinutes });
            }}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-violet-500/50 disabled:opacity-50"
          />
          <p className="text-[10px] text-slate-600">1–1440. The background loop picks up changes on the next wait.</p>
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="pulse-instructions">
            Instructions for each tick
          </label>
          <textarea
            id="pulse-instructions"
            rows={5}
            disabled={!settings}
            value={settings?.pulseInstructions ?? ""}
            onChange={(e) => {
              const pulseInstructions = e.target.value;
              setSettings((s) => (s ? { ...s, pulseInstructions } : s));
              schedulePatch({ pulseInstructions });
            }}
            className="w-full resize-y rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-violet-500/50 disabled:opacity-50"
            placeholder="What should the model focus on when Pulse fires?"
          />
        </div>
        <button
          type="button"
          disabled={
            !settings ||
            pulseNowLoading ||
            settings.selectedProvider === "placeholder" ||
            !settings.pulseConversationId?.trim()
          }
          onClick={() => {
            void (async () => {
              try {
                setPulseNowLoading(true);
                setError(null);
                await invoke("pulse_run_now");
              } catch (err) {
                setError(String(err));
              } finally {
                setPulseNowLoading(false);
              }
            })();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-700/50 bg-violet-900/30 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-900/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pulseNowLoading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Send Pulse now
        </button>
        <p className="text-[10px] text-slate-600">
          Runs one check-in immediately using the bound thread. Pulse does not need to be enabled. Result appears
          below.
        </p>
        <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800/70 pt-3">
          <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Last result (this session)</p>
          {lastPulse ? (
            <div className="rounded-md border border-slate-200 dark:border-slate-800/80 bg-slate-100/90 dark:bg-slate-950/50 p-2">
              {lastPulse.conversationId ? (
                <p className="mb-1 font-mono text-[10px] text-slate-500" title={lastPulse.conversationId}>
                  Thread:{" "}
                  {lastPulse.conversationId.length > 14
                    ? `${lastPulse.conversationId.slice(0, 12)}…`
                    : lastPulse.conversationId}
                </p>
              ) : null}
              <p className="font-mono text-[10px] text-slate-500">{lastPulse.at}</p>
              {lastPulse.summary ? (
                <p className="mt-2 whitespace-pre-wrap text-[11px] text-slate-800 dark:text-slate-200">{lastPulse.summary}</p>
              ) : null}
              {lastPulse.error ? (
                <p className="mt-2 text-[11px] text-amber-200/90">{lastPulse.error}</p>
              ) : null}
              {!lastPulse.ok && !lastPulse.error && !lastPulse.summary ? (
                <p className="mt-1 text-[11px] text-slate-500">Empty response.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] text-slate-600">No tick yet — use Send Pulse now or enable the timer.</p>
          )}
        </div>
      </section>

      <SettingsSection
        title="Memory"
        className="rounded-lg border border-indigo-900/35 bg-indigo-950/12 p-3 ring-1 ring-indigo-800/25"
        info={
          <>
            Long-term Memory Anchor recall: LLM extraction stores facts after each message; semantic search
            ranks by embedding similarity. Use Re-index after changing provider or embedding model.
          </>
        }
      >
        <SettingsToggleCard
          id="memory-llm-extraction"
          title="LLM memory extraction"
          info={MEMORY_LLM_INFO}
          checked={settings?.memoryLlmExtractionEnabled ?? true}
          disabled={!settings}
          onChange={(memoryLlmExtractionEnabled) => {
            setSettings((s) => (s ? { ...s, memoryLlmExtractionEnabled } : s));
            void (async () => {
              try {
                setError(null);
                await flushDebounce();
                const next = await applySettingsPatch({ memoryLlmExtractionEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        <SettingsToggleCard
          id="memory-semantic"
          title="Semantic recall (embeddings)"
          info={MEMORY_SEMANTIC_INFO}
          checked={settings?.memorySemanticEnabled ?? true}
          disabled={!settings}
          onChange={(memorySemanticEnabled) => {
            setSettings((s) => (s ? { ...s, memorySemanticEnabled } : s));
            void (async () => {
              try {
                setError(null);
                await flushDebounce();
                const next = await applySettingsPatch({ memorySemanticEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        {settings?.selectedProvider === "ollama_cloud" ? (
          <p className="text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-200/80">
            Ollama Cloud has no embedding API. Re-index uses your <strong>local</strong> Ollama URL (
            {settings.ollamaBaseUrl || "http://127.0.0.1:11434"}) — run Ollama locally and{" "}
            <span className="font-mono">ollama pull nomic-embed-text</span>, or switch chat provider to OpenAI for embeddings.
          </p>
        ) : null}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="embedding-model">
            Embedding model (optional)
          </label>
          <input
            id="embedding-model"
            type="text"
            disabled={!settings}
            placeholder="Default for provider (e.g. text-embedding-3-small)"
            value={settings?.embeddingModel ?? ""}
            onChange={(e) => {
              const embeddingModel = e.target.value;
              setSettings((s) => (s ? { ...s, embeddingModel } : s));
              schedulePatch({ embeddingModel });
            }}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          disabled={!settings || memoryReindexing || settings.selectedProvider === "placeholder"}
          onClick={() => {
            setMemoryReindexResult(null);
            setMemoryReindexing(true);
            void (async () => {
              try {
                setError(null);
                const n = await invoke<number>("memory_reindex_embeddings");
                setMemoryReindexResult(`Re-indexed ${n} anchor(s) with embeddings.`);
              } catch (err) {
                setMemoryReindexResult(String(err));
              } finally {
                setMemoryReindexing(false);
              }
            })();
          }}
          className="w-full rounded-lg border border-indigo-800/60 bg-indigo-950/30 px-3 py-2 text-sm font-medium text-indigo-100 hover:bg-indigo-900/40 disabled:opacity-50"
        >
          {memoryReindexing ? "Re-indexing…" : "Re-index memory embeddings"}
        </button>
        {memoryReindexResult ? (
          <p className="text-[11px] text-slate-500">{memoryReindexResult}</p>
        ) : null}
      </SettingsSection>

      <section className="space-y-3 rounded-lg border border-red-900/40 bg-red-950/12 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-red-300/90">
          Data
        </h3>
        <p className="text-[11px] leading-relaxed text-red-200/70">
          Wipe chat history and Memory Anchor data, or perform a full factory reset (includes settings
          and companions).
        </p>
        <button
          type="button"
          onClick={() => {
            setWipeConfirmInput("");
            setDestructiveModal("memory");
          }}
          className="w-full rounded-lg border border-red-600/90 bg-red-900/55 px-3 py-2.5 text-sm font-semibold text-red-50 shadow-sm hover:bg-red-800/70"
        >
          Wipe All Memories
        </button>
        <button
          type="button"
          onClick={() => {
            setWipeConfirmInput("");
            setDestructiveModal("factory");
          }}
          className="w-full rounded-md border border-red-950/80 bg-red-950/40 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-200/90 hover:bg-red-950/70"
        >
          Factory Reset
        </button>
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Cache
        </h3>
        <p className="text-xs leading-relaxed text-slate-500">
          Temporary files from tools and runtime features are stored in the app data directory,
          not in the git repo. Clear this folder anytime to reclaim disk space.
        </p>
        {cacheInfo ? (
          <ul className="space-y-1.5 font-mono text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 break-all">
            <li>
              <span className="text-slate-600">Directory · </span>
              {cacheInfo.path}
            </li>
            <li>
              <span className="text-slate-600">Files · </span>
              {cacheInfo.itemCount.toLocaleString()}
            </li>
            <li>
              <span className="text-slate-600">Size · </span>
              {cacheInfo.sizeBytes > 1024 * 1024
                ? `${(cacheInfo.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
                : `${(cacheInfo.sizeBytes / 1024).toFixed(2)} KB`}
            </li>
          </ul>
        ) : (
          <p className="text-[11px] text-slate-600">Loading cache info…</p>
        )}
        {cacheError ? (
          <p className="text-[11px] text-amber-200/90">{cacheError}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!cacheInfo || cacheLoading}
            onClick={() => void revealCacheDirectory()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700/90 bg-slate-100 dark:bg-slate-900/70 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 transition hover:border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:bg-slate-800/80 disabled:pointer-events-none disabled:opacity-40"
          >
            <FolderOpen className="size-3.5 text-slate-600 dark:text-slate-400" aria-hidden />
            Open cache folder
          </button>
          <button
            type="button"
            disabled={!cacheInfo || cacheLoading || cacheInfo.itemCount === 0}
            onClick={() => {
              if (window.confirm(`Clear ${cacheInfo?.itemCount ?? 0} cached file(s)? This cannot be undone.`)) {
                void clearCache();
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-red-700/50 bg-red-900/40 px-3 py-2 text-xs font-medium text-red-100 transition hover:bg-red-900/60 disabled:pointer-events-none disabled:opacity-40"
          >
            {cacheLoading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-3.5" aria-hidden />
            )}
            Clear cache
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Local data paths
        </h3>
        <p className="text-xs leading-relaxed text-slate-500">
          Chats, settings, and <code className="text-slate-600 dark:text-slate-400">personality.json</code> live here — not in your git
          checkout. On Linux the default is under{" "}
          <code className="text-slate-600 dark:text-slate-400">~/.local/share/</code> (XDG data home). Set{" "}
          <code className="text-slate-600 dark:text-slate-400">PERSISTENT_SAGE_DATA_DIR</code> to pin a visible folder (e.g. inside your project or a
          synced drive) so every machine uses the same files.
        </p>
        {dataPaths ? (
          <ul className="space-y-1.5 font-mono text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 break-all">
            <li>
              <span className="text-slate-600">Data directory · </span>
              {dataPaths.dataDirectory}
            </li>
            <li>
              <span className="text-slate-600">SQLite file · </span>
              {dataPaths.databaseFile}
            </li>
            <li className="text-slate-500">
              Profile: {dataPaths.sqliteProfile}
              {dataPaths.novaDataDirEnv ? " · custom data dir set" : ""}
              {dataPaths.novaPortableEnv ? " · portable mode set" : ""}
            </li>
          </ul>
        ) : (
          <p className="text-[11px] text-slate-600">Unavailable outside the Tauri desktop shell.</p>
        )}
        {revealPathError ? (
          <p className="text-[11px] text-amber-200/90">{revealPathError}</p>
        ) : null}
        <button
          type="button"
          disabled={!dataPaths}
          onClick={() => {
            setRevealPathError(null);
            void (async () => {
              try {
                await invoke("reveal_data_directory");
              } catch (e) {
                setRevealPathError(e instanceof Error ? e.message : String(e));
              }
            })();
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700/90 bg-slate-100 dark:bg-slate-900/70 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 transition hover:border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:bg-slate-800/80 disabled:pointer-events-none disabled:opacity-40"
        >
          <FolderOpen className="size-3.5 text-slate-600 dark:text-slate-400" aria-hidden />
          Open data folder in file manager
        </button>
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          About
        </h3>
        <p className="text-xs leading-relaxed text-slate-500">
          Settings and API keys are stored under your Persistent Sage data directory; keys are encrypted
          (AES-GCM) with material from the OS keychain when available.
        </p>
        <button
          type="button"
          onClick={() => void loadVersion()}
          className="mt-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
        >
          Read backend version
        </button>
        {backend ? (
          <p className="font-mono text-[11px] text-slate-600 dark:text-slate-400">{backend}</p>
        ) : null}
      </section>
      {destructiveModal ? (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="destructive-modal-warning"
      >
        <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-red-900/60 bg-slate-50 dark:bg-slate-950 p-4 shadow-2xl">
          <p
            id="destructive-modal-warning"
            className="whitespace-pre-line text-xs leading-relaxed text-slate-800 dark:text-slate-200"
          >
            {destructiveModal === "memory" ? MEMORY_WIPE_COPY : FACTORY_RESET_COPY}
          </p>
          <input
            id="destructive-confirm-input"
            type="text"
            autoComplete="off"
            value={wipeConfirmInput}
            onChange={(e) => setWipeConfirmInput(e.target.value)}
            placeholder="Type CONFIRM"
            aria-label="Confirmation: type CONFIRM"
            className="mt-4 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 font-mono text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-red-500/60"
          />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDestructiveModal(null);
                setWipeConfirmInput("");
              }}
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={wiping || wipeConfirmInput !== "CONFIRM"}
              onClick={() => {
                if (wipeConfirmInput !== "CONFIRM") return;
                void (async () => {
                  try {
                    setWiping(true);
                    setError(null);
                    if (destructiveModal === "memory") {
                      await invoke("database_wipe_memories");
                    } else {
                      await invoke("database_wipe_all");
                    }
                    setDestructiveModal(null);
                    setWipeConfirmInput("");
                    window.location.reload();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setWiping(false);
                  }
                })();
              }}
              className="flex-1 rounded-lg border border-red-700 bg-red-900/70 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {wiping
                ? destructiveModal === "memory"
                  ? "Wiping…"
                  : "Resetting…"
                : destructiveModal === "memory"
                  ? "Wipe"
                  : "Reset"}
            </button>
          </div>
        </div>
      </div>
      ) : null}
    </>
  );
}
