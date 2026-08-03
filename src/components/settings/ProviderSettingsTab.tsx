import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Cpu, KeyRound, Loader2, XCircle } from "lucide-react";
import {
  applySettingsPatch,
  MAX_TOKEN_SELECT_OPTIONS,
  maxTokensSelectValue,
  mergeModelCatalog,
  modelOptionSuffix,
  type ModelOption,
} from "@/components/settings/settingsHelpers";
import type {
  ModelCatalogEntry,
  ProviderDescriptor,
  SettingsPatch,
  SettingsView,
} from "@/components/settings/settingsTypes";

const TEMPERATURE_INFO =
  "Temperature controls creativity. Lower = more focused/predictable. Higher = more creative/random (0.0–2.0).";

const OLLAMA_CLOUD_KEYS_URL = "https://ollama.com/settings/keys";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

const OLLAMA_CLOUD_MODEL_PLACEHOLDER = "kimi-k2.6";

const DEFAULT_OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "o1",
  "o1-mini",
  "o3-mini",
] as const;

const DEFAULT_OLLAMA_LOCAL_MODELS = ["llama3.2", "mistral", "phi3", "codellama", "llama3.1"] as const;

/**
 * Ollama retires cloud models often, so keep a single current fallback and let
 * `Refresh Models` supply the real list rather than shipping stale presets.
 */
const DEFAULT_OLLAMA_CLOUD_MODELS = ["kimi-k2.6"] as const;

const DEFAULT_OPENROUTER_MODELS = [
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-sonnet",
  "google/gemini-2.5-flash",
] as const;

const DEFAULT_ANTHROPIC_MODELS = [
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
] as const;

const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
] as const;

const DEFAULT_XAI_MODELS = [
  "grok-4-fast-reasoning",
  "grok-4-fast-non-reasoning",
  "grok-3",
  "grok-3-mini",
  "grok-2-vision-1212",
] as const;

/** Result of `provider_test_active_model`: one real round trip to the selected model. */
type ModelProbe = {
  ok: boolean;
  providerId: string;
  modelId: string;
  detail: string;
};

type ModelPickRowProps = {
  htmlFor: string;
  label: string;
  value: string;
  options: ModelOption[];
  disabled?: boolean;
  loading: boolean;
  onChangeModel: (v: string) => void;
  onRefresh: () => void | Promise<void>;
  refreshLabel: string;
  /** Present a "Test model" button for the provider currently selected for chat. */
  onTestModel?: () => void | Promise<void>;
  testing?: boolean;
  testResult?: ModelProbe | null;
};

function ModelPickRow({
  htmlFor,
  label,
  value,
  options,
  disabled,
  loading,
  onChangeModel,
  onRefresh,
  refreshLabel,
  onTestModel,
  testing,
  testResult,
}: ModelPickRowProps) {
  const safeValue = options.some((o) => o.id === value) ? value : options[0]?.id ?? "";
  const refreshed = options.some((o) => o.known);
  return (
    <>
      <label className="block text-xs font-medium text-ps-muted" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={htmlFor}
          title="Select model…"
          className="ps-select min-w-0 flex-1 py-2 pl-3 pr-2 text-sm"
          value={safeValue}
          disabled={disabled || options.length === 0}
          onChange={(e) => onChangeModel(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id} className="bg-ps-elevated dark:bg-ps-elevated">
              {o.label}
              {modelOptionSuffix(o)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void onRefresh()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-2.5 py-2 text-[11px] font-semibold text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-ps-muted" aria-hidden />
          ) : null}
          <span className="whitespace-nowrap">{refreshLabel}</span>
        </button>
      </div>
      {refreshed ? (
        <p className="text-[11px] leading-relaxed text-ps-faint">
          Showing only models this provider reports as usable for chat in Persistent Sage.
        </p>
      ) : null}
      {onTestModel ? (
        <div className="space-y-1.5">
          <button
            type="button"
            disabled={disabled || testing || !safeValue}
            onClick={() => void onTestModel()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-2.5 py-1.5 text-[11px] font-semibold text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-ps-muted" aria-hidden />
            ) : null}
            <span className="whitespace-nowrap">Test model</span>
          </button>
          {testResult ? (
            <p
              className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
                testResult.ok ? "text-emerald-400/90" : "text-amber-400/90"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
              ) : (
                <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 break-words">
                {testResult.ok
                  ? `${testResult.modelId} replied: ${testResult.detail}`
                  : `${testResult.modelId} failed: ${testResult.detail}`}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export type ProviderSettingsTabProps = {
  settings: SettingsView | null;
  setSettings: Dispatch<SetStateAction<SettingsView | null>>;
  schedulePatch: (patch: SettingsPatch) => void;
  flushDebounce: () => void;
  setError: (error: string | null) => void;
  refreshSettings: () => Promise<void>;
};

export function ProviderSettingsTab({
  settings,
  setSettings,
  schedulePatch,
  flushDebounce,
  setError,
  refreshSettings,
}: ProviderSettingsTabProps) {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [ollamaKeyInput, setOllamaKeyInput] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [xaiKeyInput, setXaiKeyInput] = useState("");
  const [openrouterKeyInput, setOpenrouterKeyInput] = useState("");
  const [cloudModelTags, setCloudModelTags] = useState<ModelCatalogEntry[] | null>(null);
  const [cloudTagsLoading, setCloudTagsLoading] = useState(false);
  const [openaiFetchedModels, setOpenaiFetchedModels] = useState<ModelCatalogEntry[] | null>(null);
  const [openaiModelsLoading, setOpenaiModelsLoading] = useState(false);
  const [localOllamaTags, setLocalOllamaTags] = useState<ModelCatalogEntry[] | null>(null);
  const [localOllamaTagsLoading, setLocalOllamaTagsLoading] = useState(false);
  const [anthropicFetchedModels, setAnthropicFetchedModels] = useState<ModelCatalogEntry[] | null>(
    null,
  );
  const [anthropicModelsLoading, setAnthropicModelsLoading] = useState(false);
  const [geminiFetchedModels, setGeminiFetchedModels] = useState<ModelCatalogEntry[] | null>(null);
  const [geminiModelsLoading, setGeminiModelsLoading] = useState(false);
  const [xaiFetchedModels, setXaiFetchedModels] = useState<ModelCatalogEntry[] | null>(null);
  const [xaiModelsLoading, setXaiModelsLoading] = useState(false);
  const [openrouterFetchedModels, setOpenrouterFetchedModels] = useState<
    ModelCatalogEntry[] | null
  >(null);
  const [openrouterModelsLoading, setOpenrouterModelsLoading] = useState(false);
  const [modelProbe, setModelProbe] = useState<ModelProbe | null>(null);
  const [modelProbeLoading, setModelProbeLoading] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const list = await invoke<ProviderDescriptor[]>("provider_list_available");
      setProviders(list);
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (settings?.selectedProvider !== "ollama_cloud") {
      setCloudModelTags(null);
    }
    setModelProbe(null);
  }, [settings?.selectedProvider]);

  const applyModelPatchImmediate = useCallback(
    async (
      patch: Pick<
        SettingsPatch,
        | "openaiModel"
        | "ollamaModel"
        | "ollamaCloudModel"
        | "anthropicModel"
        | "geminiModel"
        | "xaiModel"
        | "openrouterModel"
      >,
    ) => {
      try {
        setError(null);
        setModelProbe(null);
        flushDebounce();
        const next = await applySettingsPatch(patch);
        setSettings(next);
      } catch (e) {
        setError(String(e));
        await refreshSettings();
      }
    },
    [flushDebounce, refreshSettings, setError, setSettings],
  );

  const testActiveModel = useCallback(async () => {
    try {
      setModelProbeLoading(true);
      setError(null);
      flushDebounce();
      setModelProbe(await invoke<ModelProbe>("provider_test_active_model"));
    } catch (e) {
      setModelProbe(null);
      setError(String(e));
    } finally {
      setModelProbeLoading(false);
    }
  }, [flushDebounce, setError]);

  const openaiModelOptions = useMemo(
    () => mergeModelCatalog(DEFAULT_OPENAI_MODELS, openaiFetchedModels, settings?.openaiModel ?? ""),
    [openaiFetchedModels, settings?.openaiModel],
  );

  const localOllamaModelOptions = useMemo(
    () => mergeModelCatalog(DEFAULT_OLLAMA_LOCAL_MODELS, localOllamaTags, settings?.ollamaModel ?? ""),
    [localOllamaTags, settings?.ollamaModel],
  );

  const cloudOllamaModelOptions = useMemo(
    () =>
      mergeModelCatalog(DEFAULT_OLLAMA_CLOUD_MODELS, cloudModelTags, settings?.ollamaCloudModel ?? ""),
    [cloudModelTags, settings?.ollamaCloudModel],
  );

  const anthropicModelOptions = useMemo(
    () =>
      mergeModelCatalog(DEFAULT_ANTHROPIC_MODELS, anthropicFetchedModels, settings?.anthropicModel ?? ""),
    [anthropicFetchedModels, settings?.anthropicModel],
  );

  const geminiModelOptions = useMemo(
    () => mergeModelCatalog(DEFAULT_GEMINI_MODELS, geminiFetchedModels, settings?.geminiModel ?? ""),
    [geminiFetchedModels, settings?.geminiModel],
  );

  const xaiModelOptions = useMemo(
    () => mergeModelCatalog(DEFAULT_XAI_MODELS, xaiFetchedModels, settings?.xaiModel ?? ""),
    [xaiFetchedModels, settings?.xaiModel],
  );

  const openrouterModelOptions = useMemo(
    () =>
      mergeModelCatalog(
        DEFAULT_OPENROUTER_MODELS,
        openrouterFetchedModels,
        settings?.openrouterModel ?? "",
      ),
    [openrouterFetchedModels, settings?.openrouterModel],
  );

  /** Only the provider selected for chat can be probed, so gate the button on it. */
  const probeFor = useCallback(
    (providerId: string) =>
      settings?.selectedProvider === providerId ? testActiveModel : undefined,
    [settings?.selectedProvider, testActiveModel],
  );

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

  const saveOllamaCloudKey = async () => {
    try {
      setError(null);
      await invoke("settings_save_api_key", { provider: "ollama", apiKey: ollamaKeyInput });
      setOllamaKeyInput("");
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  const saveGeminiKey = async () => {
    try {
      setError(null);
      await invoke("settings_save_api_key", { provider: "gemini", apiKey: geminiKeyInput });
      setGeminiKeyInput("");
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  const saveXaiKey = async () => {
    try {
      setError(null);
      await invoke("settings_save_api_key", { provider: "xai", apiKey: xaiKeyInput });
      setXaiKeyInput("");
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  const refreshOllamaCloudModels = useCallback(async () => {
    try {
      setCloudTagsLoading(true);
      setError(null);
      setCloudModelTags(await invoke<ModelCatalogEntry[]>("ollama_cloud_list_models"));
    } catch (e) {
      setCloudModelTags(null);
      setError(String(e));
    } finally {
      setCloudTagsLoading(false);
    }
  }, [setError]);

  const refreshOpenaiModels = useCallback(async () => {
    try {
      setOpenaiModelsLoading(true);
      setError(null);
      setOpenaiFetchedModels(await invoke<ModelCatalogEntry[]>("openai_list_models"));
    } catch (e) {
      setOpenaiFetchedModels(null);
      setError(String(e));
    } finally {
      setOpenaiModelsLoading(false);
    }
  }, [setError]);

  const refreshLocalOllamaModels = useCallback(async () => {
    try {
      setLocalOllamaTagsLoading(true);
      setError(null);
      setLocalOllamaTags(await invoke<ModelCatalogEntry[]>("ollama_list_local_models"));
    } catch (e) {
      setLocalOllamaTags(null);
      setError(String(e));
    } finally {
      setLocalOllamaTagsLoading(false);
    }
  }, [setError]);

  const refreshAnthropicModels = useCallback(async () => {
    try {
      setAnthropicModelsLoading(true);
      setError(null);
      setAnthropicFetchedModels(await invoke<ModelCatalogEntry[]>("anthropic_list_models"));
    } catch (e) {
      setAnthropicFetchedModels(null);
      setError(String(e));
    } finally {
      setAnthropicModelsLoading(false);
    }
  }, [setError]);

  const refreshGeminiModels = useCallback(async () => {
    try {
      setGeminiModelsLoading(true);
      setError(null);
      setGeminiFetchedModels(await invoke<ModelCatalogEntry[]>("gemini_list_models"));
    } catch (e) {
      setGeminiFetchedModels(null);
      setError(String(e));
    } finally {
      setGeminiModelsLoading(false);
    }
  }, [setError]);

  const refreshXaiModels = useCallback(async () => {
    try {
      setXaiModelsLoading(true);
      setError(null);
      setXaiFetchedModels(await invoke<ModelCatalogEntry[]>("xai_list_models"));
    } catch (e) {
      setXaiFetchedModels(null);
      setError(String(e));
    } finally {
      setXaiModelsLoading(false);
    }
  }, [setError]);

  const refreshOpenrouterModels = useCallback(async () => {
    try {
      setOpenrouterModelsLoading(true);
      setError(null);
      setOpenrouterFetchedModels(await invoke<ModelCatalogEntry[]>("openrouter_list_models"));
    } catch (e) {
      setOpenrouterFetchedModels(null);
      setError(String(e));
    } finally {
      setOpenrouterModelsLoading(false);
    }
  }, [setError]);

  const saveOpenrouterKey = async () => {
    try {
      setError(null);
      await invoke("settings_save_api_key", {
        provider: "openrouter",
        apiKey: openrouterKeyInput,
      });
      setOpenrouterKeyInput("");
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
    <>
      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
          Provider
        </h3>
        <label className="block text-xs font-medium text-ps-muted" htmlFor="provider-select">
          Active backend
        </label>
        <div className="relative">
          <Cpu
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ps-faint"
            aria-hidden
          />
          <select
            id="provider-select"
            value={settings?.selectedProvider ?? "placeholder"}
            disabled={!settings}
            onChange={(e) => void onProviderChange(e.target.value)}
            className="ps-select w-full py-2.5 pl-10 pr-9 text-sm"
          >
            {providers
              .filter((p) => p.id !== "ollama" && p.id !== "ollama_cloud")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.requiresApiKey ? " · API key required" : ""}
                </option>
              ))}
            {providers.some((p) => p.id === "ollama" || p.id === "ollama_cloud") ? (
              <optgroup label="Ollama — local vs cloud">
                {providers
                  .filter((p) => p.id === "ollama" || p.id === "ollama_cloud")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.requiresApiKey ? " · API key required" : ""}
                    </option>
                  ))}
              </optgroup>
            ) : null}
          </select>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-ps-border bg-ps-elevated p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
          OpenAI
        </h3>
        <label className="block text-xs font-medium text-ps-muted" htmlFor="openai-base">
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
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        {settings?.selectedProvider === "openai" ? (
          <p className="text-[11px] leading-relaxed text-ps-faint">
            With <span className="font-medium text-ps-muted">OpenAI</span> selected, use{" "}
            <span className="font-mono text-ps-muted">Refresh Models</span> to pull ids from{" "}
            <span className="font-mono text-ps-muted">/v1/models</span> (saved key + Base URL). Common models
            stay listed without a refresh.
          </p>
        ) : null}
        <ModelPickRow
          htmlFor="openai-model"
          label="Model"
          value={settings?.openaiModel ?? ""}
          options={openaiModelOptions}
          disabled={!settings}
          loading={openaiModelsLoading}
          onChangeModel={(v) => void applyModelPatchImmediate({ openaiModel: v })}
          onRefresh={refreshOpenaiModels}
          refreshLabel="Refresh Models"
          onTestModel={probeFor("openai")}
          testing={modelProbeLoading}
          testResult={modelProbe}
        />
        <details className="mt-2 rounded-md border border-ps-border bg-ps-elevated px-2 py-2">
          <summary className="cursor-pointer text-[11px] text-ps-faint">Type model name…</summary>
          <input
            type="text"
            placeholder="Custom or preview model id"
            value={settings?.openaiModel ?? ""}
            disabled={!settings}
            onChange={(e) => {
              const v = e.target.value;
              setSettings((s) => (s ? { ...s, openaiModel: v } : s));
              schedulePatch({ openaiModel: v });
            }}
            className="mt-2 w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
          />
        </details>
        <div className="flex items-center gap-2 text-xs text-ps-faint">
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
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <button
          type="button"
          onClick={() => void saveOpenaiKey()}
          className="w-full rounded-lg bg-ps-accent px-3 py-2 text-xs font-semibold text-ps-accent-fg hover:bg-ps-accent"
        >
          Save OpenAI API key
        </button>
      </section>

      <section className="space-y-4 rounded-lg border border-ps-border bg-ps-elevated p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">Ollama</h3>

        <div className="space-y-3 rounded-md border border-emerald-950/50 bg-emerald-950/10 p-3 ring-1 ring-emerald-900/25">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/90">
            Ollama · Local
          </p>
          <p className="text-[11px] leading-relaxed text-ps-faint">
            Uses your own Ollama install (default{" "}
            <span className="font-mono text-ps-muted">http://127.0.0.1:11434</span>).
          </p>
          <label className="block text-xs font-medium text-ps-muted" htmlFor="ollama-base">
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
            className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
          />
          {settings?.selectedProvider !== "ollama_cloud" ? (
            <>
              {settings?.selectedProvider === "ollama" ? (
                <p className="text-[11px] leading-relaxed text-ps-faint">
                  <span className="font-mono text-ps-muted">Refresh Models</span> loads tags from your local
                  daemon (<span className="font-mono text-ps-muted">/api/tags</span>).
                </p>
              ) : null}
              <ModelPickRow
                htmlFor="ollama-model-local"
                label="Model"
                value={settings?.ollamaModel ?? ""}
                options={localOllamaModelOptions}
                disabled={!settings}
                loading={localOllamaTagsLoading}
                onChangeModel={(v) => void applyModelPatchImmediate({ ollamaModel: v })}
                onRefresh={refreshLocalOllamaModels}
                refreshLabel="Refresh Models"
                onTestModel={probeFor("ollama")}
                testing={modelProbeLoading}
                testResult={modelProbe}
              />
              <details className="mt-2 rounded-md border border-ps-border bg-ps-elevated px-2 py-2">
                <summary className="cursor-pointer text-[11px] text-ps-faint">Type model name…</summary>
                <input
                  type="text"
                  placeholder="e.g. my.gguf:latest"
                  value={settings?.ollamaModel ?? ""}
                  disabled={!settings}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSettings((s) => (s ? { ...s, ollamaModel: v } : s));
                    schedulePatch({ ollamaModel: v });
                  }}
                  className="mt-2 w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
                />
              </details>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-ps-faint">
              With <span className="font-medium text-ps-muted">Ollama · Cloud</span> selected, set the model
              name in the cloud panel below.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-md border border-sky-900/50 bg-sky-950/20 p-3 ring-1 ring-sky-800/35">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300/95">Ollama · Cloud</p>
          {settings?.selectedProvider === "ollama_cloud" ? (
            <>
              <p className="text-xs leading-relaxed text-ps-ink">
                Ollama Cloud runs models on Ollama&apos;s servers (not locally). Requires an Ollama API key from{" "}
                <a
                  href={OLLAMA_CLOUD_KEYS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sky-400 underline-offset-2 hover:text-sky-300 hover:underline"
                >
                  https://ollama.com/settings/keys
                </a>
                .
              </p>
              <p className="text-[11px] leading-relaxed text-ps-faint">
                <span className="font-mono text-ps-muted">Refresh Models</span> loads cloud tags from{" "}
                <span className="font-mono text-ps-muted">https://ollama.com/api/tags</span> and keeps
                only chat-capable ones. Ollama retires cloud models often, so refresh after a failure
                instead of trusting the preset.
              </p>
              <ModelPickRow
                htmlFor="ollama-cloud-model"
                label="Model"
                value={settings?.ollamaCloudModel ?? ""}
                options={cloudOllamaModelOptions}
                disabled={!settings}
                loading={cloudTagsLoading}
                onChangeModel={(v) => void applyModelPatchImmediate({ ollamaCloudModel: v })}
                onRefresh={refreshOllamaCloudModels}
                refreshLabel="Refresh Models"
                onTestModel={probeFor("ollama_cloud")}
                testing={modelProbeLoading}
                testResult={modelProbe}
              />
              <details className="mt-2 rounded-md border border-ps-border bg-ps-elevated px-2 py-2">
                <summary className="cursor-pointer text-[11px] text-ps-faint">Type model name…</summary>
                <input
                  type="text"
                  placeholder={OLLAMA_CLOUD_MODEL_PLACEHOLDER}
                  value={settings?.ollamaCloudModel ?? ""}
                  disabled={!settings}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSettings((s) => (s ? { ...s, ollamaCloudModel: v } : s));
                    schedulePatch({ ollamaCloudModel: v });
                  }}
                  className="mt-2 w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-sky-500/50"
                />
              </details>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-ps-faint">
              Choose <span className="font-medium text-sky-200/90">Ollama · Cloud — models on ollama.com</span>{" "}
              in the provider menu above to configure the cloud model, refresh the catalog from{" "}
              <span className="font-mono text-ps-muted">/api/tags</span>, and save your API key.
            </p>
          )}

          <div className="space-y-2 border-t border-ps-border/70 pt-3">
            <div className="flex items-center gap-2 text-xs text-ps-faint">
              <KeyRound className="size-3.5 shrink-0" aria-hidden />
              <span>
                Ollama Cloud API key:{" "}
                {settings?.hasOllamaApiKey ? (
                  <span className="text-emerald-400/90">saved (encrypted)</span>
                ) : (
                  <span className="text-amber-400/90">not set</span>
                )}
              </span>
            </div>
            <input
              type="password"
              autoComplete="off"
              placeholder="Paste Ollama API key"
              value={ollamaKeyInput}
              onChange={(e) => setOllamaKeyInput(e.target.value)}
              className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-sky-500/50"
            />
            <button
              type="button"
              onClick={() => void saveOllamaCloudKey()}
              className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface"
            >
              Save Ollama Cloud API key
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-ps-border bg-ps-elevated p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
          Anthropic (Claude)
        </h3>
        {settings?.selectedProvider === "anthropic" ? (
          <p className="text-[11px] leading-relaxed text-ps-faint">
            <span className="font-mono text-ps-muted">Refresh Models</span> lists models your API key can access.
            Common Claude ids remain available without a refresh.
          </p>
        ) : null}
        <ModelPickRow
          htmlFor="anthropic-model"
          label="Model"
          value={settings?.anthropicModel ?? ""}
          options={anthropicModelOptions}
          disabled={!settings}
          loading={anthropicModelsLoading}
          onChangeModel={(v) => void applyModelPatchImmediate({ anthropicModel: v })}
          onRefresh={refreshAnthropicModels}
          refreshLabel="Refresh Models"
          onTestModel={probeFor("anthropic")}
          testing={modelProbeLoading}
          testResult={modelProbe}
        />
        <details className="mt-2 rounded-md border border-ps-border bg-ps-elevated px-2 py-2">
          <summary className="cursor-pointer text-[11px] text-ps-faint">Type model name…</summary>
          <input
            type="text"
            placeholder="e.g. claude-3-5-sonnet-20241022"
            value={settings?.anthropicModel ?? ""}
            disabled={!settings}
            onChange={(e) => {
              const v = e.target.value;
              setSettings((s) => (s ? { ...s, anthropicModel: v } : s));
              schedulePatch({ anthropicModel: v });
            }}
            className="mt-2 w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
          />
        </details>
        <div className="flex items-center gap-2 text-xs text-ps-faint">
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
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <button
          type="button"
          onClick={() => void saveAnthropicKey()}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface"
        >
          Save Anthropic API key
        </button>
      </section>

      <section className="space-y-3 rounded-lg border border-ps-border bg-ps-elevated p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
          Google Gemini
        </h3>
        <label className="block text-xs font-medium text-ps-muted" htmlFor="gemini-base">
          Base URL
        </label>
        <input
          id="gemini-base"
          type="url"
          value={settings?.geminiBaseUrl ?? ""}
          disabled={!settings}
          onChange={(e) => {
            const v = e.target.value;
            setSettings((s) => (s ? { ...s, geminiBaseUrl: v } : s));
            schedulePatch({ geminiBaseUrl: v });
          }}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <ModelPickRow
          htmlFor="gemini-model"
          label="Model"
          value={settings?.geminiModel ?? ""}
          options={geminiModelOptions}
          disabled={!settings}
          loading={geminiModelsLoading}
          onChangeModel={(v) => void applyModelPatchImmediate({ geminiModel: v })}
          onRefresh={refreshGeminiModels}
          refreshLabel="Refresh Models"
          onTestModel={probeFor("gemini")}
          testing={modelProbeLoading}
          testResult={modelProbe}
        />
        <details className="mt-2 rounded-md border border-ps-border bg-ps-elevated px-2 py-2">
          <summary className="cursor-pointer text-[11px] text-ps-faint">Type model name…</summary>
          <input
            type="text"
            placeholder="e.g. gemini-2.5-flash"
            value={settings?.geminiModel ?? ""}
            disabled={!settings}
            onChange={(e) => {
              const v = e.target.value;
              setSettings((s) => (s ? { ...s, geminiModel: v } : s));
              schedulePatch({ geminiModel: v });
            }}
            className="mt-2 w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
          />
        </details>
        <div className="flex items-center gap-2 text-xs text-ps-faint">
          <KeyRound className="size-3.5 shrink-0" aria-hidden />
          <span>
            API key:{" "}
            {settings?.hasGeminiApiKey ? (
              <span className="text-emerald-400/90">saved (encrypted)</span>
            ) : (
              <span className="text-amber-400/90">not set</span>
            )}
          </span>
        </div>
        <input
          type="password"
          autoComplete="off"
          placeholder="Google AI Studio API key"
          value={geminiKeyInput}
          onChange={(e) => setGeminiKeyInput(e.target.value)}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <button
          type="button"
          onClick={() => void saveGeminiKey()}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface"
        >
          Save Gemini API key
        </button>
      </section>

      <section className="space-y-3 rounded-lg border border-ps-border bg-ps-elevated p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
          xAI (Grok)
        </h3>
        <label className="block text-xs font-medium text-ps-muted" htmlFor="xai-base">
          Base URL
        </label>
        <input
          id="xai-base"
          type="url"
          value={settings?.xaiBaseUrl ?? ""}
          disabled={!settings}
          onChange={(e) => {
            const v = e.target.value;
            setSettings((s) => (s ? { ...s, xaiBaseUrl: v } : s));
            schedulePatch({ xaiBaseUrl: v });
          }}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <ModelPickRow
          htmlFor="xai-model"
          label="Model"
          value={settings?.xaiModel ?? ""}
          options={xaiModelOptions}
          disabled={!settings}
          loading={xaiModelsLoading}
          onChangeModel={(v) => void applyModelPatchImmediate({ xaiModel: v })}
          onRefresh={refreshXaiModels}
          refreshLabel="Refresh Models"
          onTestModel={probeFor("xai")}
          testing={modelProbeLoading}
          testResult={modelProbe}
        />
        <details className="mt-2 rounded-md border border-ps-border bg-ps-elevated px-2 py-2">
          <summary className="cursor-pointer text-[11px] text-ps-faint">Type model name…</summary>
          <input
            type="text"
            placeholder="e.g. grok-4-fast-reasoning"
            value={settings?.xaiModel ?? ""}
            disabled={!settings}
            onChange={(e) => {
              const v = e.target.value;
              setSettings((s) => (s ? { ...s, xaiModel: v } : s));
              schedulePatch({ xaiModel: v });
            }}
            className="mt-2 w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
          />
        </details>
        <div className="flex items-center gap-2 text-xs text-ps-faint">
          <KeyRound className="size-3.5 shrink-0" aria-hidden />
          <span>
            API key:{" "}
            {settings?.hasXaiApiKey ? (
              <span className="text-emerald-400/90">saved (encrypted)</span>
            ) : (
              <span className="text-amber-400/90">not set</span>
            )}
          </span>
        </div>
        <input
          type="password"
          autoComplete="off"
          placeholder="xAI API key"
          value={xaiKeyInput}
          onChange={(e) => setXaiKeyInput(e.target.value)}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <button
          type="button"
          onClick={() => void saveXaiKey()}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface"
        >
          Save xAI API key
        </button>
      </section>

      <section className="space-y-3 rounded-lg border border-ps-border bg-ps-elevated p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
          OpenRouter
        </h3>
        <p className="text-[11px] leading-relaxed text-ps-faint">
          One key reaches models from many labs. Get a key at{" "}
          <a
            href={OPENROUTER_KEYS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ps-accent underline-offset-2 hover:underline"
          >
            openrouter.ai/keys
          </a>
          . <span className="font-mono text-ps-muted">Refresh Models</span> lists only the
          tool-capable chat models your account can reach, so nothing in the picker is a dead end.
        </p>
        <label className="block text-xs font-medium text-ps-muted" htmlFor="openrouter-base">
          Base URL
        </label>
        <input
          id="openrouter-base"
          type="url"
          value={settings?.openrouterBaseUrl ?? ""}
          disabled={!settings}
          onChange={(e) => {
            const v = e.target.value;
            setSettings((s) => (s ? { ...s, openrouterBaseUrl: v } : s));
            schedulePatch({ openrouterBaseUrl: v });
          }}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <ModelPickRow
          htmlFor="openrouter-model"
          label="Model"
          value={settings?.openrouterModel ?? ""}
          options={openrouterModelOptions}
          disabled={!settings}
          loading={openrouterModelsLoading}
          onChangeModel={(v) => void applyModelPatchImmediate({ openrouterModel: v })}
          onRefresh={refreshOpenrouterModels}
          refreshLabel="Refresh Models"
          onTestModel={probeFor("openrouter")}
          testing={modelProbeLoading}
          testResult={modelProbe}
        />
        <details className="mt-2 rounded-md border border-ps-border bg-ps-elevated px-2 py-2">
          <summary className="cursor-pointer text-[11px] text-ps-faint">Type model name…</summary>
          <input
            type="text"
            placeholder="e.g. openai/gpt-4o-mini"
            value={settings?.openrouterModel ?? ""}
            disabled={!settings}
            onChange={(e) => {
              const v = e.target.value;
              setSettings((s) => (s ? { ...s, openrouterModel: v } : s));
              schedulePatch({ openrouterModel: v });
            }}
            className="mt-2 w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
          />
        </details>
        <div className="flex items-center gap-2 text-xs text-ps-faint">
          <KeyRound className="size-3.5 shrink-0" aria-hidden />
          <span>
            API key:{" "}
            {settings?.hasOpenrouterApiKey ? (
              <span className="text-emerald-400/90">saved (encrypted)</span>
            ) : (
              <span className="text-amber-400/90">not set</span>
            )}
          </span>
        </div>
        <input
          type="password"
          autoComplete="off"
          placeholder="sk-or-…"
          value={openrouterKeyInput}
          onChange={(e) => setOpenrouterKeyInput(e.target.value)}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
        <button
          type="button"
          onClick={() => void saveOpenrouterKey()}
          className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface"
        >
          Save OpenRouter API key
        </button>
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
          Generation
        </h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-ps-muted">
            <span className="inline-flex items-center gap-1.5">
              <span>Temperature</span>
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded-md border border-ps-border/80 bg-ps-elevated dark:bg-ps-elevated text-[11px] font-semibold text-ps-muted hover:border-ps-border hover:text-ps-ink"
                title={TEMPERATURE_INFO}
                aria-label={TEMPERATURE_INFO}
              >
                i
              </button>
            </span>
            <span className="font-mono text-ps-muted">
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
              flushDebounce();
              void (async () => {
                try {
                  setError(null);
                  const next = await applySettingsPatch({ temperature: t });
                  setSettings(next);
                } catch (err) {
                  setError(String(err));
                  await refreshSettings();
                }
              })();
            }}
            className="h-2 w-full cursor-pointer accent-ps-accent disabled:opacity-50"
          />
        </div>
        <label className="block text-xs font-medium text-ps-muted" htmlFor="max-tokens-select">
          Max input tokens
        </label>
        <p className="text-[11px] leading-relaxed text-ps-faint">
          Presets match common context sizes. This caps how many tokens the model may produce in its
          reply (generation budget).{" "}
          <span className="text-ps-muted">
            <strong className="font-medium text-ps-muted">Use model default</strong> lets Persistent Sage use this
            model&apos;s context window from the provider, then apply a safe per-API limit. Explicit values
            are clamped if the active model cannot honor them.
          </span>
        </p>
        <select
          id="max-tokens-select"
          disabled={!settings}
          value={maxTokensSelectValue(settings)}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("legacy:")) return;
            const maxTokens = v === "default" ? null : Number.parseInt(v, 10);
            if (v !== "default" && Number.isNaN(maxTokens)) return;

            flushDebounce();
            setSettings((s) => (s ? { ...s, maxTokens } : s));
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ maxTokens });
                setSettings({ ...next, maxTokens: next.maxTokens ?? null });
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
          className="w-full cursor-pointer rounded-lg border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-900 py-2.5 pl-3 pr-8 text-sm text-zinc-900 dark:text-zinc-100 outline-none [color-scheme:light] dark:[color-scheme:dark] focus:border-ps-accent/60 focus:ring-2 focus:ring-ps-accent/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {MAX_TOKEN_SELECT_OPTIONS.map((o) => (
            <option
              key={o.value}
              value={o.value}
              className="bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {o.label}
            </option>
          ))}
          {settings &&
          typeof settings.maxTokens === "number" &&
          !MAX_TOKEN_SELECT_OPTIONS.some((o) => o.tokens === settings.maxTokens) ? (
            <option
              value={`legacy:${settings.maxTokens}`}
              className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 dark:bg-zinc-800 dark:text-zinc-400"
            >
              Saved value: {settings.maxTokens.toLocaleString()} (pick a preset to replace)
            </option>
          ) : null}
        </select>
      </section>
    </>
  );
}
