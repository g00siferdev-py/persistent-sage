import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cpu, Heart, Maximize2, Minimize2, SlidersHorizontal, Wrench, X } from "lucide-react";
import { CompanionPersonalitySection } from "@/components/settings/CompanionPersonalitySection";
import { GeneralSettingsTab } from "@/components/settings/GeneralSettingsTab";
import { ProviderSettingsTab } from "@/components/settings/ProviderSettingsTab";
import { ToolsSettingsTab } from "@/components/settings/ToolsSettingsTab";
import { applySettingsPatch, settingsPanelWidth } from "@/components/settings/settingsHelpers";
import type {
  AppDataPaths,
  SettingsPanelProps,
  SettingsPatch,
  SettingsTab,
  SettingsView,
} from "@/components/settings/settingsTypes";

const DEBOUNCE_MS = 400;

export type { SettingsPanelProps };

export function SettingsPanel({
  layoutMode,
  onLayoutModeChange,
  onCompanionActiveProfileChange,
  chatActiveProfileId,
  onRequestOnboarding,
}: SettingsPanelProps) {
  const open = layoutMode !== "hidden";
  const panelDense = layoutMode === "full";
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [dataPaths, setDataPaths] = useState<AppDataPaths | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSettings = useCallback(async () => {
    try {
      setError(null);
      const s = await invoke<SettingsView>("settings_get");
      setSettings(s);
    } catch (e) {
      setError(String(e));
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

  useEffect(() => {
    if (!open) return;
    void refreshSettings();
    void refreshDataPaths();
  }, [open, refreshSettings, refreshDataPaths]);

  const flushDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const schedulePatch = useCallback(
    (patch: SettingsPatch) => {
      flushDebounce();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void (async () => {
          try {
            setError(null);
            const next = await applySettingsPatch(patch);
            setSettings(next);
          } catch (e) {
            setError(String(e));
          }
        })();
      }, DEBOUNCE_MS);
    },
    [flushDebounce],
  );

  useEffect(() => () => flushDebounce(), [flushDebounce]);

  const panelWidthClass = settingsPanelWidth(layoutMode);

  return (
    <aside
      id="nova-settings-panel"
      aria-hidden={!open}
      className={`h-full min-h-0 shrink-0 overflow-hidden border-l transition-[width,opacity] duration-200 ease-out ${
        open
          ? "border-slate-200 dark:border-slate-800/80 bg-slate-100 dark:bg-slate-900/35 shadow-[-8px_0_24px_rgba(15,23,42,0.08)] dark:shadow-[-16px_0_48px_rgba(0,0,0,0.4)] opacity-100"
          : "border-transparent opacity-0"
      } ${panelWidthClass}`}
    >
      <div className={`flex h-full flex-col ${panelWidthClass}`} inert={!open ? true : undefined}>
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 dark:border-slate-800/80 px-3 py-2.5">
          <SlidersHorizontal className="size-4 shrink-0 text-slate-600 dark:text-slate-400" aria-hidden />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">Settings</h2>
          <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Panel size">
            <button
              type="button"
              title="Compact panel"
              aria-pressed={layoutMode === "compact"}
              onClick={() => onLayoutModeChange("compact")}
              className={`inline-flex size-7 items-center justify-center rounded-md border transition ${
                layoutMode === "compact"
                  ? "border-indigo-500/50 bg-indigo-100/80 dark:bg-indigo-950/50 text-indigo-200"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800/80 hover:text-slate-800 dark:text-slate-200"
              }`}
            >
              <Minimize2 className="size-3.5" aria-hidden />
              <span className="sr-only">Compact</span>
            </button>
            <button
              type="button"
              title="Full panel — wider settings view (content scrolls)"
              aria-pressed={layoutMode === "full"}
              onClick={() => onLayoutModeChange("full")}
              className={`inline-flex size-7 items-center justify-center rounded-md border transition ${
                layoutMode === "full"
                  ? "border-indigo-500/50 bg-indigo-100/80 dark:bg-indigo-950/50 text-indigo-200"
                  : "border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:bg-slate-800/80 hover:text-slate-800 dark:text-slate-200"
              }`}
            >
              <Maximize2 className="size-3.5" aria-hidden />
              <span className="sr-only">Full</span>
            </button>
            <button
              type="button"
              title="Hide settings"
              onClick={() => onLayoutModeChange("hidden")}
              className="inline-flex size-7 items-center justify-center rounded-md border border-transparent text-slate-600 dark:text-slate-400 transition hover:bg-slate-200 dark:bg-slate-800/80 hover:text-slate-800 dark:text-slate-200"
            >
              <X className="size-3.5" aria-hidden />
              <span className="sr-only">Hide</span>
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            className={`flex shrink-0 flex-col gap-0.5 border-r border-slate-200 dark:border-slate-800/80 p-2 ${
              panelDense ? "w-[5.5rem]" : "w-[6.75rem]"
            }`}
            aria-label="Settings sections"
          >
            {(
              [
                ["companion", "Companion", Heart],
                ["provider", "Provider", Cpu],
                ["tools", "Tools", Wrench],
                ["general", "General", SlidersHorizontal],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSettingsTab(id)}
                className={
                  settingsTab === id
                    ? "flex flex-col items-center gap-1 rounded-lg bg-slate-200 dark:bg-slate-800/90 px-2 py-2.5 text-[10px] font-medium text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-600/50"
                    : "flex flex-col items-center gap-1 rounded-lg px-2 py-2.5 text-[10px] font-medium text-slate-600 dark:text-slate-400 transition hover:bg-slate-200 dark:bg-slate-800/40 hover:text-slate-800 dark:text-slate-200"
                }
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </button>
            ))}
          </nav>

          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
              panelDense ? "px-3 py-2" : "px-4 py-4"
            }`}
          >
            {error ? (
              <p className="mb-2 shrink-0 rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
                {error}
              </p>
            ) : null}

            {settingsTab === "companion" ? (
              <CompanionPersonalitySection
                visible={open}
                chatActiveProfileId={chatActiveProfileId ?? "default"}
                onActiveProfileMemorySync={onCompanionActiveProfileChange}
              />
            ) : (
              <div
                className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${
                  panelDense ? "space-y-3" : "space-y-6"
                }`}
              >
                {settingsTab === "provider" ? (
                  <ProviderSettingsTab
                    settings={settings}
                    setSettings={setSettings}
                    schedulePatch={schedulePatch}
                    flushDebounce={flushDebounce}
                    setError={setError}
                    refreshSettings={refreshSettings}
                  />
                ) : null}

                {settingsTab === "tools" ? (
                  <ToolsSettingsTab
                    settings={settings}
                    setSettings={setSettings}
                    dataPaths={dataPaths}
                    panelDense={panelDense}
                    flushDebounce={flushDebounce}
                    schedulePatch={schedulePatch}
                    setError={setError}
                    refreshSettings={refreshSettings}
                  />
                ) : null}

                {settingsTab === "general" ? (
                  <GeneralSettingsTab
                    settings={settings}
                    setSettings={setSettings}
                    schedulePatch={schedulePatch}
                    flushDebounce={flushDebounce}
                    setError={setError}
                    refreshSettings={refreshSettings}
                    onRequestOnboarding={onRequestOnboarding}
                    panelOpen={open}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
