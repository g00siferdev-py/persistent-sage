import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, FolderOpen, HardDrive, Usb } from "lucide-react";

type ProviderDescriptor = {
  id: string;
  label: string;
  requiresApiKey: boolean;
};

type SettingsView = {
  selectedProvider: string;
  hasOpenaiApiKey: boolean;
  hasAnthropicApiKey: boolean;
  hasOllamaApiKey: boolean;
  hasGeminiApiKey: boolean;
  hasXaiApiKey: boolean;
  onboardingCompleted: boolean;
};

type StorageChoice = "desktop" | "portable" | "unsure";

type Props = {
  onComplete: () => void;
};

const STEPS = ["welcome", "storage", "provider", "apikey", "done"] as const;
type Step = (typeof STEPS)[number];

function providerNeedsApiKey(id: string, providers: ProviderDescriptor[]): boolean {
  if (id === "placeholder" || id === "ollama") return false;
  return providers.find((p) => p.id === id)?.requiresApiKey ?? false;
}

function hasKeyForProvider(settings: SettingsView | null, providerId: string): boolean {
  if (!settings) return false;
  if (providerId === "openai") return settings.hasOpenaiApiKey;
  if (providerId === "anthropic") return settings.hasAnthropicApiKey;
  if (providerId === "ollama_cloud") return settings.hasOllamaApiKey;
  if (providerId === "gemini") return settings.hasGeminiApiKey;
  if (providerId === "xai") return settings.hasXaiApiKey;
  return true;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [storageChoice, setStorageChoice] = useState<StorageChoice>("desktop");
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [providerId, setProviderId] = useState("placeholder");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataDirHint, setDataDirHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [plist, s, paths] = await Promise.all([
        invoke<ProviderDescriptor[]>("provider_list_available"),
        invoke<SettingsView>("settings_get"),
        invoke<{ dataDirectory: string }>("app_data_paths"),
      ]);
      setProviders(plist);
      setSettings(s);
      setProviderId(s.selectedProvider || "placeholder");
      setDataDirHint(paths.dataDirectory);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const needsApiStep = useMemo(
    () => providerNeedsApiKey(providerId, providers) && !hasKeyForProvider(settings, providerId),
    [providerId, providers, settings],
  );
  const selectedProviderRequiresKey = useMemo(
    () => providerNeedsApiKey(providerId, providers),
    [providerId, providers],
  );
  const selectedProviderHasKey = hasKeyForProvider(settings, providerId);

  const stepIndex = STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const goNext = () => {
    setError(null);
    if (step === "welcome") setStep("storage");
    else if (step === "storage") setStep("provider");
    else if (step === "provider") {
      if (needsApiStep) {
        setError("Save an API key for this provider, or choose Offline placeholder / Local Ollama.");
        return;
      }
      setStep("done");
    }
    else if (step === "apikey") setStep("done");
  };

  const goBack = () => {
    setError(null);
    if (step === "done") setStep(needsApiStep ? "apikey" : "provider");
    else if (step === "apikey") setStep("provider");
    else if (step === "provider") setStep("storage");
    else if (step === "storage") setStep("welcome");
  };

  const applyProvider = async (id: string) => {
    setBusy(true);
    setError(null);
    setApiKeyInput("");
    setProviderId(id);
    try {
      const s = await invoke<SettingsView>("settings_update", {
        patch: { selectedProvider: id },
      });
      setSettings(s);
      setProviderId(id);
    } catch (e) {
      setProviderId(settings?.selectedProvider || "placeholder");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveApiKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setError("Paste an API key or choose Offline placeholder / Local Ollama.");
      return;
    }
    const provider =
      providerId === "openai"
        ? "openai"
        : providerId === "anthropic"
          ? "anthropic"
          : providerId === "ollama_cloud"
            ? "ollama"
            : providerId === "gemini"
              ? "gemini"
              : providerId === "xai"
                ? "xai"
                : null;
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("settings_save_api_key", { provider, apiKey: key });
      const s = await invoke<SettingsView>("settings_get");
      setSettings(s);
      setApiKeyInput("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("settings_update", { patch: { onboardingCompleted: true } });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revealDataFolder = async () => {
    try {
      await invoke("reveal_data_directory");
    } catch {
      /* browser preview */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="flex max-h-[min(32rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-100 shadow-2xl dark:bg-slate-900">
        <div className="h-1 shrink-0 bg-slate-200 dark:bg-slate-800">
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <img
            src="/persistent-sage-splash.png"
            alt="Persistent Sage"
            className="mx-auto mb-4 h-24 w-auto object-contain"
          />

          {step === "welcome" ? (
            <>
              <h2 id="onboarding-title" className="text-center text-xl font-semibold text-slate-900 dark:text-white">
                Welcome to Persistent Sage
              </h2>
              <p className="mt-2 text-center text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Local-first AI companion. Chats and memory stay on your machine. This short setup
                helps you choose where data lives and connect your AI provider.
              </p>
            </>
          ) : null}

          {step === "storage" ? (
            <>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Where should data live?</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Pick the option that matches how you installed Persistent Sage.
              </p>
              <ul className="mt-4 space-y-2">
                {(
                  [
                    {
                      id: "desktop" as const,
                      icon: HardDrive,
                      title: "This PC (installer / Start Menu)",
                      body: "Use the normal Start Menu shortcut. Data goes to your Windows profile (AppData).",
                    },
                    {
                      id: "portable" as const,
                      icon: Usb,
                      title: "USB or portable folder",
                      body: "Always launch with Start Persistent Sage (Portable).bat so data stays beside the app.",
                    },
                    {
                      id: "unsure" as const,
                      icon: FolderOpen,
                      title: "Not sure",
                      body: "Reveal your data folder after setup to confirm.",
                    },
                  ] as const
                ).map(({ id, icon: Icon, title, body }) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setStorageChoice(id)}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                        storageChoice === id
                          ? "border-indigo-500/60 bg-indigo-500/10 ring-1 ring-indigo-500/40"
                          : "border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600"
                      }`}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-indigo-400" aria-hidden />
                      <span>
                        <span className="block text-sm font-medium text-slate-900 dark:text-white">{title}</span>
                        <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{body}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {dataDirHint ? (
                <p className="mt-3 font-mono text-[10px] text-slate-500" title={dataDirHint}>
                  Current data path: {dataDirHint.length > 48 ? `…${dataDirHint.slice(-44)}` : dataDirHint}
                </p>
              ) : null}
            </>
          ) : null}

          {step === "provider" ? (
            <>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Choose your AI provider</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                You can change this anytime in Settings → Provider.
              </p>
              <label className="mt-4 block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="onb-provider">
                Active backend
              </label>
              <select
                id="onb-provider"
                value={providerId}
                disabled={busy}
                onChange={(e) => void applyProvider(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-indigo-500"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.requiresApiKey ? " · API key" : ""}
                  </option>
                ))}
              </select>
              {providerId === "placeholder" ? (
                <p className="mt-2 text-xs text-slate-500">
                  Offline placeholder — explore the UI without calling a live API.
                </p>
              ) : null}
              {providerId === "ollama" ? (
                <p className="mt-2 text-xs text-slate-500">
                  Requires Ollama running locally (default http://127.0.0.1:11434).
                </p>
              ) : null}
              {selectedProviderRequiresKey ? (
                <div className="mt-4 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {selectedProviderHasKey
                      ? "An API key is already saved for this provider on this device."
                      : "This provider needs an API key before chat can work. Keys are encrypted and stored only on this device."}
                  </p>
                  {!selectedProviderHasKey ? (
                    <>
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder={
                          providerId === "openai"
                            ? "sk-…"
                            : providerId === "anthropic"
                              ? "sk-ant-…"
                              : providerId === "gemini"
                                ? "Google AI Studio API key"
                                : providerId === "xai"
                                  ? "xAI API key"
                                  : "Ollama Cloud API key"
                        }
                        value={apiKeyInput}
                        disabled={busy}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        className="mt-3 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveApiKey()}
                        className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        Save API key
                      </button>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Key saved.</p>
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          {step === "apikey" ? (
            <>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">API key</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Keys are encrypted and stored only on this device.
              </p>
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  providerId === "openai"
                    ? "sk-…"
                    : providerId === "anthropic"
                      ? "sk-ant-…"
                      : providerId === "gemini"
                        ? "Google AI Studio API key"
                        : providerId === "xai"
                          ? "xAI API key"
                          : "Ollama Cloud API key"
                }
                value={apiKeyInput}
                disabled={busy}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="mt-4 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveApiKey()}
                className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Save API key
              </button>
              {hasKeyForProvider(settings, providerId) ? (
                <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Key saved.</p>
              ) : null}
            </>
          ) : null}

          {step === "done" ? (
            <>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">You&apos;re ready</h2>
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-600 dark:text-slate-400">
                <li>Click <strong className="text-slate-800 dark:text-slate-200">New chat</strong> in the sidebar.</li>
                <li>Open <strong className="text-slate-800 dark:text-slate-200">Settings</strong> for tools, memory, and Pulse.</li>
                {storageChoice === "portable" ? (
                  <li>Use <strong className="text-slate-800 dark:text-slate-200">Start Persistent Sage (Portable).bat</strong> on USB installs.</li>
                ) : null}
              </ul>
              <button
                type="button"
                onClick={() => void revealDataFolder()}
                className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
              >
                <FolderOpen className="size-3.5" aria-hidden />
                Reveal data folder
              </button>
            </>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-md border border-red-800/50 bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 px-4 py-3">
          <button
            type="button"
            disabled={step === "welcome" || busy}
            onClick={goBack}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden />
            Back
          </button>
          {step !== "done" ? (
            <button
              type="button"
              disabled={busy}
              onClick={goNext}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Continue
              <ChevronRight className="size-4" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Open Persistent Sage
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
