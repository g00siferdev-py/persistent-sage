import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cpu, Heart, KeyRound, Moon, SlidersHorizontal } from "lucide-react";
import { CompanionPersonalitySection } from "@/components/settings/CompanionPersonalitySection";

type Props = {
  open: boolean;
};

type SettingsView = {
  selectedProvider: string;
  openaiModel: string;
  openaiBaseUrl: string;
  ollamaModel: string;
  ollamaBaseUrl: string;
  anthropicModel: string;
  temperature: number;
  maxTokens: number | null;
  hasOpenaiApiKey: boolean;
  hasAnthropicApiKey: boolean;
};

type SettingsPatch = {
  selectedProvider?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  anthropicModel?: string;
  temperature?: number;
  /** Omit = unchanged; null = clear cap */
  maxTokens?: number | null;
};

type ProviderDescriptor = {
  id: string;
  label: string;
  localFirst: boolean;
  requiresApiKey: boolean;
};

const DEBOUNCE_MS = 400;

type SettingsTab = "general" | "companion";

export function SettingsPanel({ open }: Props) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [backend, setBackend] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadVersion = useCallback(async () => {
    try {
      const v = await invoke<string>("app_version");
      setBackend(v);
    } catch {
      setBackend("Unavailable (open via Tauri)");
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      setError(null);
      const s = await invoke<SettingsView>("settings_get");
      setSettings(s);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const list = await invoke<ProviderDescriptor[]>("provider_list_available");
      setProviders(list);
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshSettings();
    void loadProviders();
  }, [open, refreshSettings, loadProviders]);

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
            const next = await invoke<SettingsView>("settings_update", { patch });
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

  const saveOpenaiKey = async () => {
    try {
      setError(null);
      await invoke("settings_save_api_key", { provider: "openai", apiKey: openaiKeyInput });
      setOpenaiKeyInput("");
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  const saveAnthropicKey = async () => {
    try {
      setError(null);
      await invoke("settings_save_api_key", { provider: "anthropic", apiKey: anthropicKeyInput });
      setAnthropicKeyInput("");
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  const onProviderChange = async (id: string) => {
    try {
      setError(null);
      await invoke("provider_switch", { providerId: id });
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <aside
      id="nova-settings-panel"
      aria-hidden={!open}
      className={
        open
          ? "w-80 shrink-0 border-l border-slate-800/80 bg-slate-900/35 shadow-[-12px_0_40px_rgba(0,0,0,0.35)] transition-[width,opacity] duration-200 ease-out"
          : "w-0 shrink-0 overflow-hidden border-l border-transparent opacity-0 transition-[width,opacity] duration-200 ease-out"
      }
    >
      <div className="flex h-full w-80 flex-col" inert={!open}>
        <div className="flex flex-col gap-2 border-b border-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-slate-400" aria-hidden />
            <h2 className="text-sm font-semibold text-white">Settings</h2>
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-950/60 p-1">
            <button
              type="button"
              onClick={() => setSettingsTab("general")}
              className={
                settingsTab === "general"
                  ? "flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-white shadow-sm"
                  : "flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-200"
              }
            >
              General
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab("companion")}
              className={
                settingsTab === "companion"
                  ? "flex-1 rounded-md bg-indigo-900/50 px-2 py-1.5 text-xs font-medium text-white shadow-sm ring-1 ring-indigo-500/30"
                  : "flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-200"
              }
            >
              <span className="inline-flex items-center justify-center gap-1">
                <Heart className="size-3" aria-hidden />
                Companion
              </span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {error ? (
            <p className="rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
              {error}
            </p>
          ) : null}

          {settingsTab === "companion" ? (
            <CompanionPersonalitySection visible={open} />
          ) : null}

          {settingsTab === "general" ? (
            <>
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Appearance
            </h3>
            <div className="flex items-center gap-3 rounded-lg border border-slate-800/80 bg-slate-950/50 px-3 py-2.5">
              <Moon className="size-4 text-indigo-300" aria-hidden />
              <div>
                <p className="text-sm font-medium text-white">Dark mode</p>
                <p className="text-xs text-slate-500">Default for Nova</p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Provider
            </h3>
            <label className="block text-xs font-medium text-slate-400" htmlFor="provider-select">
              Active backend
            </label>
            <div className="relative">
              <Cpu
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
                aria-hidden
              />
              <select
                id="provider-select"
                value={settings?.selectedProvider ?? "placeholder"}
                disabled={!settings}
                onChange={(e) => void onProviderChange(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-800/90 bg-slate-950/60 py-2.5 pl-10 pr-9 text-sm text-slate-200 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-50"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.requiresApiKey ? " · API key" : ""}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              OpenAI
            </h3>
            <label className="block text-xs font-medium text-slate-400" htmlFor="openai-base">
              Base URL
            </label>
            <input
              id="openai-base"
              type="url"
              value={settings?.openaiBaseUrl ?? ""}
              disabled={!settings}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((s) => (s ? { ...s, openaiBaseUrl: v } : s));
                schedulePatch({ openaiBaseUrl: v });
              }}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <label className="block text-xs font-medium text-slate-400" htmlFor="openai-model">
              Model
            </label>
            <input
              id="openai-model"
              type="text"
              value={settings?.openaiModel ?? ""}
              disabled={!settings}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((s) => (s ? { ...s, openaiModel: v } : s));
                schedulePatch({ openaiModel: v });
              }}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <KeyRound className="size-3.5 shrink-0" aria-hidden />
              <span>
                API key:{" "}
                {settings?.hasOpenaiApiKey ? (
                  <span className="text-emerald-400/90">saved (encrypted)</span>
                ) : (
                  <span className="text-amber-400/90">not set</span>
                )}
              </span>
            </div>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={openaiKeyInput}
              onChange={(e) => setOpenaiKeyInput(e.target.value)}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <button
              type="button"
              onClick={() => void saveOpenaiKey()}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Save OpenAI API key
            </button>
          </section>

          <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Ollama
            </h3>
            <label className="block text-xs font-medium text-slate-400" htmlFor="ollama-base">
              Base URL
            </label>
            <input
              id="ollama-base"
              type="url"
              value={settings?.ollamaBaseUrl ?? ""}
              disabled={!settings}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((s) => (s ? { ...s, ollamaBaseUrl: v } : s));
                schedulePatch({ ollamaBaseUrl: v });
              }}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <label className="block text-xs font-medium text-slate-400" htmlFor="ollama-model">
              Model
            </label>
            <input
              id="ollama-model"
              type="text"
              value={settings?.ollamaModel ?? ""}
              disabled={!settings}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((s) => (s ? { ...s, ollamaModel: v } : s));
                schedulePatch({ ollamaModel: v });
              }}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </section>

          <section className="space-y-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Anthropic (planned)
            </h3>
            <label className="block text-xs font-medium text-slate-400" htmlFor="anthropic-model">
              Model id
            </label>
            <input
              id="anthropic-model"
              type="text"
              value={settings?.anthropicModel ?? ""}
              disabled={!settings}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((s) => (s ? { ...s, anthropicModel: v } : s));
                schedulePatch({ anthropicModel: v });
              }}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <KeyRound className="size-3.5 shrink-0" aria-hidden />
              <span>
                API key:{" "}
                {settings?.hasAnthropicApiKey ? (
                  <span className="text-emerald-400/90">saved (encrypted)</span>
                ) : (
                  <span className="text-amber-400/90">not set</span>
                )}
              </span>
            </div>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={anthropicKeyInput}
              onChange={(e) => setAnthropicKeyInput(e.target.value)}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <button
              type="button"
              onClick={() => void saveAnthropicKey()}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              Save Anthropic API key
            </button>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Generation
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Temperature</span>
                <span className="font-mono text-slate-300">
                  {settings?.temperature?.toFixed(2) ?? "—"}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={settings?.temperature ?? 0.7}
                disabled={!settings}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  setSettings((s) => (s ? { ...s, temperature: t } : s));
                  schedulePatch({ temperature: t });
                }}
                className="h-2 w-full cursor-pointer accent-indigo-500 disabled:opacity-50"
              />
            </div>
            <label className="block text-xs font-medium text-slate-400" htmlFor="max-tokens">
              Max tokens (optional)
            </label>
            <input
              id="max-tokens"
              type="number"
              min={1}
              placeholder="Default from model"
              value={settings?.maxTokens ?? ""}
              disabled={!settings}
              onChange={(e) => {
                const raw = e.target.value;
                const n = raw === "" ? null : Number.parseInt(raw, 10);
                const maxTokens = raw === "" || Number.isNaN(n) ? null : n;
                setSettings((s) => (s ? { ...s, maxTokens } : s));
                schedulePatch({ maxTokens });
              }}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </section>

          <section className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              About
            </h3>
            <p className="text-xs leading-relaxed text-slate-500">
              Settings and API keys are stored under your Nova data directory; keys are encrypted
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
              <p className="font-mono text-[11px] text-slate-400">{backend}</p>
            ) : null}
          </section>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
