import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Heart,
  KeyRound,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  RefreshCw,
  SlidersHorizontal,
  Wrench,
  X,
} from "lucide-react";
import { CompanionPersonalitySection } from "@/components/settings/CompanionPersonalitySection";
import { SettingsSection, SettingsToggleCard } from "@/components/settings/settingsUi";
import { useTheme } from "@/hooks/useTheme";
import type { SettingsLayoutMode } from "@/lib/settingsLayout";
import { toolDisplayName, toolLabelList } from "@/lib/toolDisplayNames";

type Props = {
  layoutMode: SettingsLayoutMode;
  onLayoutModeChange: (mode: SettingsLayoutMode) => void;
  /** When the user switches companion profile, refresh MemoryAnchor scope and chat threads. */
  onCompanionActiveProfileChange?: (profileId: string) => void | Promise<void>;
  /** Profile id currently used for chat memory (from `useChat`). */
  chatActiveProfileId?: string;
  /** Re-open the first-run setup wizard (from ChatLayout). */
  onRequestOnboarding?: () => void;
};

const TOOLS_SECTION_INFO = (
  <>
    Chat-only options for OpenAI, Ollama, and Anthropic. Pulse uses the same toggles when it runs in the background.
    Tool names below are what
    your companion sees in plain language; the app still uses internal ids for API calls.
  </>
);

const WEB_TOOLS_WHEN_ENABLED = (
  <ul className="mt-2 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed text-slate-500">
    <li>{toolDisplayName("web_search")}</li>
    <li>{toolDisplayName("fetch_url")}</li>
    <li>{toolDisplayName("http_request")}</li>
  </ul>
);

const WEB_TOOLS_INFO = (
  <>
    When enabled, your companion may use: <strong className="font-medium text-slate-700 dark:text-slate-300">{toolLabelList(["web_search", "fetch_url", "http_request"])}</strong>.
    Web Search uses DuckDuckGo; Fetch URL loads public pages as plain text. For JS-heavy news homepages (CNN, BBC), also turn on{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("fetch_browser")}</strong> below.
    Requests leave this device; local and private URLs are blocked. Requires a tool-capable model. Off by default.
  </>
);

const PERSONALITY_EDIT_INFO = (
  <>
    When enabled, your companion may use <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("personality_get")}</strong> and{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("personality_update")}</strong> to read or change the active profile in{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">personality.json</span>. Saves to disk and updates this chat&apos;s persona immediately. Off by default.
  </>
);

const BROWSER_FETCH_INFO = (
  <>
    Uses system Chrome, Chromium, or Edge to load pages with JavaScript, a normal browser user-agent, and a
    persistent cookie profile. Better for news sites and bot-protected pages. Requires{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">Allow web tools</strong> to be on as well.
    Needs a browser install or{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">PERSISTENT_SAGE_CHROME_PATH</span>. In Docker, install{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">ca-certificates</span> and set{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">PERSISTENT_SAGE_CHROME_NO_SANDBOX=1</span> if needed. Off by default.
  </>
);

const BROWSER_ROBOTS_INFO = (
  <>
    When enabled, <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("fetch_browser")}</strong> does not
    block URLs based on robots.txt. For personal automation on your machine; many news sites disallow bots in
    robots.txt. Off by default.
  </>
);

const WORKSPACE_TOOLS_INFO = (
  <>
    When enabled, your companion may use{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">
      {toolLabelList([
        "workspace_list_directory",
        "workspace_read_file",
        "workspace_write_file",
      ])}
    </strong>{" "}
    in the Persistent Sage workspace, and <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("database_query")}</strong> on{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">.db</span> / <span className="font-mono text-slate-600 dark:text-slate-400">.sqlite</span> files there
    (workspace location). Paths are relative; <span className="font-mono text-slate-600 dark:text-slate-400">..</span> is rejected. Off by default.
    For the live app database folder, enable App data directory databases below instead.
  </>
);

const APP_DATA_DB_INFO = (
  <>
    When enabled, your companion may use <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("database_query")}</strong> on
    SQLite files in Persistent Sage&apos;s data directory — the same resolved path as the live memory database (for example{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">~/.local/share/persistent-sage/data</span> on Linux, or the portable{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">data/</span> folder next to the executable). Use a filename only (e.g.{" "}
    <span className="font-mono text-slate-600 dark:text-slate-400">nova_memory.sqlite</span>), no subdirectories. Off by default.
  </>
);

const DB_WRITE_INFO = (
  <>
    When off (default), <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("database_query")}</strong> is
    read-only (SELECT and introspection). When on, INSERT/UPDATE/DELETE/REPLACE are allowed. Requires{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">Workspace file tools</strong> and/or{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">Database Query on app data</strong> enabled above. DROP/ALTER/CREATE/PRAGMA/VACUUM
    remain blocked.
  </>
);

const FEEDBACK_ISSUE_URL = "https://github.com/g00siferdev-py/persistent-sage/issues/new";

function providerSupportsTools(settings: SettingsView | null): boolean {
  return Boolean(
    settings &&
      ["openai", "ollama", "ollama_cloud", "anthropic", "xai"].includes(settings.selectedProvider),
  );
}

function providerToolsFootnote(settings: SettingsView | null): string | undefined {
  if (providerSupportsTools(settings)) return undefined;
  return "Switch provider to OpenAI, xAI, Ollama, or Anthropic.";
}

function settingsPanelWidth(mode: SettingsLayoutMode): string {
  switch (mode) {
    case "hidden":
      return "w-0 min-w-0";
    case "compact":
      return "w-[min(100%,26rem)] min-w-[20rem]";
    case "full":
      return "w-[min(92vw,44rem)] min-w-[28rem]";
  }
}

type SettingsView = {
  selectedProvider: string;
  openaiModel: string;
  openaiBaseUrl: string;
  ollamaModel: string;
  ollamaCloudModel: string;
  ollamaBaseUrl: string;
  anthropicModel: string;
  geminiModel: string;
  geminiBaseUrl: string;
  xaiModel: string;
  xaiBaseUrl: string;
  thinkingEffort: "low" | "medium" | "high";
  temperature: number;
  /** Omitted in JSON when unset (Rust `None`) — treat like `null` (model default). */
  maxTokens?: number | null;
  /** When true and the active provider supports it, the model may call built-in web search / URL fetch tools. */
  agentWebToolsEnabled: boolean;
  /** When true (and web tools on), the model may use headless Chrome via fetch_browser for JS-heavy sites. */
  agentBrowserFetchEnabled: boolean;
  /** When true, fetch_browser skips robots.txt checks (personal use; off by default). */
  agentBrowserIgnoreRobots: boolean;
  /** When true, the model may read/write/list files only under the app workspace folder (see data paths). */
  agentWorkspaceEnabled: boolean;
  agentPersonalityEditEnabled: boolean;
  /** When true, database_query may use location=app_data on .db/.sqlite files in the Persistent Sage data directory (same folder as the live memory DB). */
  databaseAppDataEnabled: boolean;
  /** When true, database_query may run INSERT/UPDATE/DELETE/REPLACE on workspace .db files (DROP/ALTER/CREATE still blocked). */
  databaseAllowWrite: boolean;
  pulseEnabled: boolean;
  pulseIntervalMinutes: number;
  pulseInstructions: string;
  pulseConversationId?: string | null;
  memoryLlmExtractionEnabled: boolean;
  memorySemanticEnabled: boolean;
  embeddingModel: string;
  hasOpenaiApiKey: boolean;
  hasAnthropicApiKey: boolean;
  hasOllamaApiKey: boolean;
  hasGeminiApiKey: boolean;
  hasXaiApiKey: boolean;
  onboardingCompleted: boolean;
  artifactsEnabled: boolean;
};

type SettingsPatch = {
  selectedProvider?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  ollamaModel?: string;
  ollamaCloudModel?: string;
  ollamaBaseUrl?: string;
  anthropicModel?: string;
  geminiModel?: string;
  geminiBaseUrl?: string;
  xaiModel?: string;
  xaiBaseUrl?: string;
  thinkingEffort?: "low" | "medium" | "high";
  temperature?: number;
  /** Omit = unchanged; null = clear cap */
  maxTokens?: number | null;
  agentWebToolsEnabled?: boolean;
  agentBrowserFetchEnabled?: boolean;
  agentBrowserIgnoreRobots?: boolean;
  agentWorkspaceEnabled?: boolean;
  agentPersonalityEditEnabled?: boolean;
  databaseAppDataEnabled?: boolean;
  databaseAllowWrite?: boolean;
  pulseEnabled?: boolean;
  pulseIntervalMinutes?: number;
  pulseInstructions?: string;
  memoryLlmExtractionEnabled?: boolean;
  memorySemanticEnabled?: boolean;
  embeddingModel?: string;
  onboardingCompleted?: boolean;
  artifactsEnabled?: boolean;
};

const MEMORY_LLM_INFO = (
  <>
    After each user message, Persistent Sage asks your chat provider to extract durable facts (health, preferences,
    accessibility) as curated anchors. Uses a small JSON completion — not the full reply. Off falls back to
    keyword heuristics only.
  </>
);

const MEMORY_SEMANTIC_INFO = (
  <>
    Embeds anchor text in the background (small batches). During chat, your companion can use{" "}
    <strong className="font-medium text-slate-700 dark:text-slate-300">{toolDisplayName("memory_search")}</strong> for semantic lookup — not a blocking
    network call on every message. Requires OpenAI, <strong>local</strong> Ollama (<code className="font-mono text-[10px]">ollama pull nomic-embed-text</code>), or local Ollama when chat uses Anthropic or Ollama Cloud.
  </>
);

type ProviderDescriptor = {
  id: string;
  label: string;
  localFirst: boolean;
  requiresApiKey: boolean;
};

const DEBOUNCE_MS = 400;

const MEMORY_WIPE_COPY = `This will permanently delete ALL conversations, messages, anchors, and memories across every personality.
Persistent Sage will forget everything it has learned about you.
Your API keys, settings, and personality profiles will be preserved.This action cannot be undone.
To proceed, type CONFIRM and click Wipe.`;

const FACTORY_RESET_COPY = `This will permanently delete ALL conversations, memories, anchors, and settings.
Persistent Sage will forget everything it has ever learned about you.
This action cannot be undone.To proceed, type CONFIRM in the box below and click Reset.`;

const TEMPERATURE_INFO =
  "Temperature controls creativity. Lower = more focused/predictable. Higher = more creative/random (0.0–2.0).";

const OLLAMA_CLOUD_KEYS_URL = "https://ollama.com/settings/keys";

const OLLAMA_CLOUD_MODEL_PLACEHOLDER = "kimi-k2.5:cloud or gpt-oss:120b-cloud";

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

const DEFAULT_OLLAMA_CLOUD_MODELS = ["gpt-oss:120b-cloud", "kimi-k2.5:cloud"] as const;

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

function mergeModelOptions(
  defaults: readonly string[],
  fetched: string[] | null | undefined,
  current: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of defaults) {
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  if (fetched) {
    for (const f of [...fetched].sort((a, b) => a.localeCompare(b))) {
      if (!seen.has(f)) {
        seen.add(f);
        out.push(f);
      }
    }
  }
  const cur = current.trim();
  if (cur && !seen.has(cur)) {
    out.push(cur);
  }
  return out;
}

type ModelPickRowProps = {
  htmlFor: string;
  label: string;
  value: string;
  optionIds: string[];
  disabled?: boolean;
  loading: boolean;
  onChangeModel: (v: string) => void;
  onRefresh: () => void | Promise<void>;
  refreshLabel: string;
};

function ModelPickRow({
  htmlFor,
  label,
  value,
  optionIds,
  disabled,
  loading,
  onChangeModel,
  onRefresh,
  refreshLabel,
}: ModelPickRowProps) {
  const safeValue = optionIds.includes(value) ? value : optionIds[0] ?? "";
  return (
    <>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <select
          id={htmlFor}
          title="Select model…"
          className="min-w-0 flex-1 cursor-pointer rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 py-2 pl-3 pr-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:light] dark:[color-scheme:dark]"
          value={safeValue}
          disabled={disabled || optionIds.length === 0}
          onChange={(e) => onChangeModel(e.target.value)}
        >
          {optionIds.map((id) => (
            <option key={id} value={id} className="bg-slate-100 dark:bg-slate-900">
              {id}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void onRefresh()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-2.5 py-2 text-[11px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-slate-700 dark:text-slate-300" aria-hidden /> : null}
          <span className="whitespace-nowrap">{refreshLabel}</span>
        </button>
      </div>
    </>
  );
}

/** Preset caps for assistant generation; `null` = defer to model / context (see backend). */
const MAX_TOKEN_SELECT_OPTIONS: { value: string; label: string; tokens: number | null }[] = [
  { value: "default", label: "Use model default (recommended)", tokens: null },
  { value: "4096", label: "4,096", tokens: 4096 },
  { value: "8192", label: "8,192", tokens: 8192 },
  { value: "16384", label: "16,384", tokens: 16384 },
  { value: "32768", label: "32,768", tokens: 32768 },
  { value: "128000", label: "128,000", tokens: 128_000 },
  { value: "200000", label: "200,000 (large-context models)", tokens: 200_000 },
];

function maxTokensSelectValue(settings: SettingsView | null): string {
  if (!settings) return "default";
  const mt = settings.maxTokens;
  if (mt == null) return "default";
  if (MAX_TOKEN_SELECT_OPTIONS.some((o) => o.tokens === mt)) {
    return String(mt);
  }
  return `legacy:${mt}`;
}

type SettingsTab = "companion" | "provider" | "tools" | "general";

type PulseTickPayload = {
  ok: boolean;
  at: string;
  conversationId?: string;
  summary?: string;
  error?: string;
};

type DestructiveModal = "memory" | "factory";

type AppDataPaths = {
  dataDirectory: string;
  databaseFile: string;
  workspaceDirectory: string;
  sqliteProfile: string;
  novaDataDirEnv: boolean;
  novaPortableEnv: boolean;
};

type StoreUpdateCheckResult = {
  upToDate: boolean;
  updateAvailable: boolean;
  packageCount: number;
  message: string;
};

type DistributionInfo = {
  channel: "microsoft_store" | "direct_download";
  updatesViaMicrosoftStore: boolean;
  storeLibraryUri: string;
};

type PendingUpdate = {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (callback?: (event: unknown) => void) => Promise<void>;
};

type FeedbackKind = "bug" | "idea" | "beta";

function modelForProvider(settings: SettingsView | null): string {
  if (!settings) return "unknown";
  switch (settings.selectedProvider) {
    case "openai":
      return settings.openaiModel || "unknown";
    case "ollama":
      return settings.ollamaModel || "unknown";
    case "ollama_cloud":
      return settings.ollamaCloudModel || "unknown";
    case "anthropic":
      return settings.anthropicModel || "unknown";
    case "gemini":
      return settings.geminiModel || "unknown";
    case "xai":
      return settings.xaiModel || "unknown";
    default:
      return "n/a";
  }
}

function feedbackIssueUrl(kind: FeedbackKind, settings: SettingsView | null, backend: string | null, dataPaths: AppDataPaths | null): string {
  const appVersion = backend ?? "unknown";
  const provider = settings?.selectedProvider ?? "unknown";
  const model = modelForProvider(settings);
  const installType = dataPaths?.novaPortableEnv ? "portable" : "desktop/default";
  const titlePrefix =
    kind === "bug" ? "[Bug]" : kind === "idea" ? "[Idea]" : "[Beta feedback]";
  const labels =
    kind === "bug" ? "bug,beta-feedback" : kind === "idea" ? "enhancement,beta-feedback" : "beta-feedback";
  const body = [
    "## Summary",
    "",
    kind === "bug"
      ? "What went wrong?"
      : kind === "idea"
        ? "What would make Persistent Sage better?"
        : "How did the beta feel? What worked well or felt confusing?",
    "",
    "## Environment",
    "",
    `- App version: ${appVersion}`,
    `- Provider: ${provider}`,
    `- Model: ${model}`,
    `- Install type: ${installType}`,
    "- OS: ",
    "",
    "## Details",
    "",
    kind === "bug"
      ? "Steps to reproduce:\n1. \n2. \n3. \n\nExpected result:\n\nActual result:"
      : "Notes:",
    "",
    "## Privacy check",
    "",
    "Please do not paste API keys, private chats, Memory Anchor contents, or sensitive personal information.",
  ].join("\n");

  const url = new URL(FEEDBACK_ISSUE_URL);
  url.searchParams.set("title", `${titlePrefix} `);
  url.searchParams.set("labels", labels);
  url.searchParams.set("body", body);
  return url.toString();
}

export function SettingsPanel({
  layoutMode,
  onLayoutModeChange,
  onCompanionActiveProfileChange,
  chatActiveProfileId,
  onRequestOnboarding,
}: Props) {
  const { isDark, setDarkMode } = useTheme();
  const open = layoutMode !== "hidden";
  const panelDense = layoutMode === "full";
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [backend, setBackend] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [anthropicKeyInput, setAnthropicKeyInput] = useState("");
  const [ollamaKeyInput, setOllamaKeyInput] = useState("");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [xaiKeyInput, setXaiKeyInput] = useState("");
  const [cloudModelTags, setCloudModelTags] = useState<string[] | null>(null);
  const [cloudTagsLoading, setCloudTagsLoading] = useState(false);
  const [openaiFetchedModels, setOpenaiFetchedModels] = useState<string[] | null>(null);
  const [openaiModelsLoading, setOpenaiModelsLoading] = useState(false);
  const [localOllamaTags, setLocalOllamaTags] = useState<string[] | null>(null);
  const [localOllamaTagsLoading, setLocalOllamaTagsLoading] = useState(false);
  const [anthropicFetchedModels, setAnthropicFetchedModels] = useState<string[] | null>(null);
  const [anthropicModelsLoading, setAnthropicModelsLoading] = useState(false);
  const [geminiFetchedModels, setGeminiFetchedModels] = useState<string[] | null>(null);
  const [geminiModelsLoading, setGeminiModelsLoading] = useState(false);
  const [xaiFetchedModels, setXaiFetchedModels] = useState<string[] | null>(null);
  const [xaiModelsLoading, setXaiModelsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    if (!open) return;
    void refreshSettings();
    void loadProviders();
    void refreshDataPaths();
    void refreshDistributionInfo();
  }, [open, refreshSettings, loadProviders, refreshDataPaths, refreshDistributionInfo]);

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
    if (!open) {
      setDestructiveModal(null);
      setWipeConfirmInput("");
    }
  }, [open]);

  useEffect(() => {
    if (settings?.selectedProvider !== "ollama_cloud") {
      setCloudModelTags(null);
    }
  }, [settings?.selectedProvider]);

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

  const applyModelPatchImmediate = useCallback(
    async (patch: Pick<SettingsPatch, "openaiModel" | "ollamaModel" | "ollamaCloudModel" | "anthropicModel" | "geminiModel" | "xaiModel">) => {
      try {
        setError(null);
        flushDebounce();
        const next = await invoke<SettingsView>("settings_update", { patch });
        setSettings(next);
      } catch (e) {
        setError(String(e));
        await refreshSettings();
      }
    },
    [flushDebounce, refreshSettings],
  );

  useEffect(() => () => flushDebounce(), [flushDebounce]);

  const openaiModelOptions = useMemo(
    () => mergeModelOptions(DEFAULT_OPENAI_MODELS, openaiFetchedModels, settings?.openaiModel ?? ""),
    [openaiFetchedModels, settings?.openaiModel],
  );

  const localOllamaModelOptions = useMemo(
    () =>
      mergeModelOptions(DEFAULT_OLLAMA_LOCAL_MODELS, localOllamaTags, settings?.ollamaModel ?? ""),
    [localOllamaTags, settings?.ollamaModel],
  );

  const cloudOllamaModelOptions = useMemo(
    () =>
      mergeModelOptions(DEFAULT_OLLAMA_CLOUD_MODELS, cloudModelTags, settings?.ollamaCloudModel ?? ""),
    [cloudModelTags, settings?.ollamaCloudModel],
  );

  const anthropicModelOptions = useMemo(
    () =>
      mergeModelOptions(
        DEFAULT_ANTHROPIC_MODELS,
        anthropicFetchedModels,
        settings?.anthropicModel ?? "",
      ),
    [anthropicFetchedModels, settings?.anthropicModel],
  );

  const geminiModelOptions = useMemo(
    () =>
      mergeModelOptions(
        DEFAULT_GEMINI_MODELS,
        geminiFetchedModels,
        settings?.geminiModel ?? "",
      ),
    [geminiFetchedModels, settings?.geminiModel],
  );

  const xaiModelOptions = useMemo(
    () => mergeModelOptions(DEFAULT_XAI_MODELS, xaiFetchedModels, settings?.xaiModel ?? ""),
    [xaiFetchedModels, settings?.xaiModel],
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
      const tags = await invoke<string[]>("ollama_cloud_list_models");
      setCloudModelTags(tags);
    } catch (e) {
      setCloudModelTags(null);
      setError(String(e));
    } finally {
      setCloudTagsLoading(false);
    }
  }, []);

  const refreshOpenaiModels = useCallback(async () => {
    try {
      setOpenaiModelsLoading(true);
      setError(null);
      const ids = await invoke<string[]>("openai_list_models");
      setOpenaiFetchedModels(ids);
    } catch (e) {
      setOpenaiFetchedModels(null);
      setError(String(e));
    } finally {
      setOpenaiModelsLoading(false);
    }
  }, []);

  const refreshLocalOllamaModels = useCallback(async () => {
    try {
      setLocalOllamaTagsLoading(true);
      setError(null);
      const tags = await invoke<string[]>("ollama_list_local_models");
      setLocalOllamaTags(tags);
    } catch (e) {
      setLocalOllamaTags(null);
      setError(String(e));
    } finally {
      setLocalOllamaTagsLoading(false);
    }
  }, []);

  const refreshAnthropicModels = useCallback(async () => {
    try {
      setAnthropicModelsLoading(true);
      setError(null);
      const ids = await invoke<string[]>("anthropic_list_models");
      setAnthropicFetchedModels(ids);
    } catch (e) {
      setAnthropicFetchedModels(null);
      setError(String(e));
    } finally {
      setAnthropicModelsLoading(false);
    }
  }, []);

  const refreshGeminiModels = useCallback(async () => {
    try {
      setGeminiModelsLoading(true);
      setError(null);
      const ids = await invoke<string[]>("gemini_list_models");
      setGeminiFetchedModels(ids);
    } catch (e) {
      setGeminiFetchedModels(null);
      setError(String(e));
    } finally {
      setGeminiModelsLoading(false);
    }
  }, []);

  const refreshXaiModels = useCallback(async () => {
    try {
      setXaiModelsLoading(true);
      setError(null);
      const ids = await invoke<string[]>("xai_list_models");
      setXaiFetchedModels(ids);
    } catch (e) {
      setXaiFetchedModels(null);
      setError(String(e));
    } finally {
      setXaiModelsLoading(false);
    }
  }, []);

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
          setUpdateProgress("If Windows does not restart the app automatically, close and reopen Persistent Sage after the Store finishes.");
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
    [backend, dataPaths, settings],
  );

  const onProviderChange = async (id: string) => {
    try {
      setError(null);
      await invoke("provider_switch", { providerId: id });
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

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
              title="Full panel — fits tools on one screen"
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
            className={`flex shrink-0 flex-col gap-0.5 border-r border-slate-200 dark:border-slate-800/80 p-2 ${panelDense ? "w-[5.5rem]" : "w-[6.75rem]"}`}
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
            className={
              settingsTab === "companion"
                ? `flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${panelDense ? "px-3 py-2" : "px-4 py-4"}`
                : panelDense && settingsTab === "tools"
                  ? `flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${panelDense ? "px-3 py-2" : "px-4 py-4"}`
                  : `min-h-0 min-w-0 flex-1 overflow-y-auto ${panelDense ? "space-y-3 px-3 py-2" : "space-y-6 px-4 py-4"}`
            }
          >
          {error ? (
            <p className="rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
              {error}
            </p>
          ) : null}

          {settingsTab === "companion" ? (
            <CompanionPersonalitySection
              visible={open}
              chatActiveProfileId={chatActiveProfileId ?? "default"}
              onActiveProfileMemorySync={onCompanionActiveProfileChange}
            />
          ) : null}

          {settingsTab === "provider" ? (
            <>
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Provider
            </h3>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="provider-select">
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
                className="w-full appearance-none rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 py-2.5 pl-10 pr-9 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-50"
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

          <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              OpenAI
            </h3>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="openai-base">
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
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
            />
            {settings?.selectedProvider === "openai" ? (
              <p className="text-[11px] leading-relaxed text-slate-500">
                With <span className="font-medium text-slate-700 dark:text-slate-300">OpenAI</span> selected, use{" "}
                <span className="font-mono text-slate-600 dark:text-slate-400">Refresh Models</span> to pull ids from{" "}
                <span className="font-mono text-slate-600 dark:text-slate-400">/v1/models</span> (saved key + Base URL). Common models
                stay listed without a refresh.
              </p>
            ) : null}
            <ModelPickRow
              htmlFor="openai-model"
              label="Model"
              value={settings?.openaiModel ?? ""}
              optionIds={openaiModelOptions}
              disabled={!settings}
              loading={openaiModelsLoading}
              onChangeModel={(v) => void applyModelPatchImmediate({ openaiModel: v })}
              onRefresh={refreshOpenaiModels}
              refreshLabel="Refresh Models"
            />
            <details className="mt-2 rounded-md border border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950/30 px-2 py-2">
              <summary className="cursor-pointer text-[11px] text-slate-500">Type model name…</summary>
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
                className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
              />
            </details>
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
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <button
              type="button"
              onClick={() => void saveOpenaiKey()}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white hover:bg-indigo-500"
            >
              Save OpenAI API key
            </button>
          </section>

          <section className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ollama</h3>

            <div className="space-y-3 rounded-md border border-emerald-950/50 bg-emerald-950/10 p-3 ring-1 ring-emerald-900/25">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/90">
                Ollama · Local
              </p>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Uses your own Ollama install (default{" "}
                <span className="font-mono text-slate-600 dark:text-slate-400">http://127.0.0.1:11434</span>).
              </p>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="ollama-base">
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
                className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
              />
              {settings?.selectedProvider !== "ollama_cloud" ? (
                <>
                  {settings?.selectedProvider === "ollama" ? (
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      <span className="font-mono text-slate-600 dark:text-slate-400">Refresh Models</span> loads tags from your local
                      daemon (<span className="font-mono text-slate-600 dark:text-slate-400">/api/tags</span>).
                    </p>
                  ) : null}
                  <ModelPickRow
                    htmlFor="ollama-model-local"
                    label="Model"
                    value={settings?.ollamaModel ?? ""}
                    optionIds={localOllamaModelOptions}
                    disabled={!settings}
                    loading={localOllamaTagsLoading}
                    onChangeModel={(v) => void applyModelPatchImmediate({ ollamaModel: v })}
                    onRefresh={refreshLocalOllamaModels}
                    refreshLabel="Refresh Models"
                  />
                  <details className="mt-2 rounded-md border border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950/30 px-2 py-2">
                    <summary className="cursor-pointer text-[11px] text-slate-500">Type model name…</summary>
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
                      className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
                    />
                  </details>
                </>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  With <span className="font-medium text-slate-700 dark:text-slate-300">Ollama · Cloud</span> selected, set the model
                  name in the cloud panel below.
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-md border border-sky-900/50 bg-sky-950/20 p-3 ring-1 ring-sky-800/35">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300/95">Ollama · Cloud</p>
              {settings?.selectedProvider === "ollama_cloud" ? (
                <>
                  <p className="text-xs leading-relaxed text-slate-900 dark:text-slate-100">
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
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    <span className="font-mono text-slate-600 dark:text-slate-400">Refresh Models</span> loads cloud tags from{" "}
                    <span className="font-mono text-slate-600 dark:text-slate-400">https://ollama.com/api/tags</span>. Preset{" "}
                    <span className="font-mono text-slate-600 dark:text-slate-400">{OLLAMA_CLOUD_MODEL_PLACEHOLDER}</span> entries stay
                    available without a refresh.
                  </p>
                  <ModelPickRow
                    htmlFor="ollama-cloud-model"
                    label="Model"
                    value={settings?.ollamaCloudModel ?? ""}
                    optionIds={cloudOllamaModelOptions}
                    disabled={!settings}
                    loading={cloudTagsLoading}
                    onChangeModel={(v) => void applyModelPatchImmediate({ ollamaCloudModel: v })}
                    onRefresh={refreshOllamaCloudModels}
                    refreshLabel="Refresh Models"
                  />
                  <details className="mt-2 rounded-md border border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950/30 px-2 py-2">
                    <summary className="cursor-pointer text-[11px] text-slate-500">Type model name…</summary>
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
                      className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-sky-500/50"
                    />
                  </details>
                </>
              ) : (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Choose <span className="font-medium text-sky-200/90">Ollama · Cloud — models on ollama.com</span>{" "}
                  in the provider menu above to configure the cloud model, refresh the catalog from{" "}
                  <span className="font-mono text-slate-600 dark:text-slate-400">/api/tags</span>, and save your API key.
                </p>
              )}

              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800/70 pt-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
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
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-sky-500/50"
                />
                <button
                  type="button"
                  onClick={() => void saveOllamaCloudKey()}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
                >
                  Save Ollama Cloud API key
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Anthropic (Claude)
            </h3>
            {settings?.selectedProvider === "anthropic" ? (
              <p className="text-[11px] leading-relaxed text-slate-500">
                <span className="font-mono text-slate-600 dark:text-slate-400">Refresh Models</span> lists models your API key can access.
                Common Claude ids remain available without a refresh.
              </p>
            ) : null}
            <ModelPickRow
              htmlFor="anthropic-model"
              label="Model"
              value={settings?.anthropicModel ?? ""}
              optionIds={anthropicModelOptions}
              disabled={!settings}
              loading={anthropicModelsLoading}
              onChangeModel={(v) => void applyModelPatchImmediate({ anthropicModel: v })}
              onRefresh={refreshAnthropicModels}
              refreshLabel="Refresh Models"
            />
            <details className="mt-2 rounded-md border border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950/30 px-2 py-2">
              <summary className="cursor-pointer text-[11px] text-slate-500">Type model name…</summary>
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
                className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
              />
            </details>
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
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <button
              type="button"
              onClick={() => void saveAnthropicKey()}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
            >
              Save Anthropic API key
            </button>
          </section>

          <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Google Gemini
            </h3>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="gemini-base">
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
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <ModelPickRow
              htmlFor="gemini-model"
              label="Model"
              value={settings?.geminiModel ?? ""}
              optionIds={geminiModelOptions}
              disabled={!settings}
              loading={geminiModelsLoading}
              onChangeModel={(v) => void applyModelPatchImmediate({ geminiModel: v })}
              onRefresh={refreshGeminiModels}
              refreshLabel="Refresh Models"
            />
            <details className="mt-2 rounded-md border border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950/30 px-2 py-2">
              <summary className="cursor-pointer text-[11px] text-slate-500">Type model name…</summary>
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
                className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
              />
            </details>
            <div className="flex items-center gap-2 text-xs text-slate-500">
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
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <button
              type="button"
              onClick={() => void saveGeminiKey()}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
            >
              Save Gemini API key
            </button>
          </section>

          <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/40 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              xAI (Grok)
            </h3>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="xai-base">
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
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <ModelPickRow
              htmlFor="xai-model"
              label="Model"
              value={settings?.xaiModel ?? ""}
              optionIds={xaiModelOptions}
              disabled={!settings}
              loading={xaiModelsLoading}
              onChangeModel={(v) => void applyModelPatchImmediate({ xaiModel: v })}
              onRefresh={refreshXaiModels}
              refreshLabel="Refresh Models"
            />
            <details className="mt-2 rounded-md border border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950/30 px-2 py-2">
              <summary className="cursor-pointer text-[11px] text-slate-500">Type model name…</summary>
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
                className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
              />
            </details>
            <div className="flex items-center gap-2 text-xs text-slate-500">
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
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500/50"
            />
            <button
              type="button"
              onClick={() => void saveXaiKey()}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
            >
              Save xAI API key
            </button>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Generation
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span>Temperature</span>
                  <button
                    type="button"
                    className="inline-flex size-5 items-center justify-center rounded-full border border-slate-300 dark:border-slate-600/80 bg-slate-100 dark:bg-slate-900/80 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:border-slate-500 hover:text-slate-800 dark:text-slate-200"
                    title={TEMPERATURE_INFO}
                    aria-label={TEMPERATURE_INFO}
                  >
                    i
                  </button>
                </span>
                <span className="font-mono text-slate-700 dark:text-slate-300">
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
                      const next = await invoke<SettingsView>("settings_update", {
                        patch: { temperature: t },
                      });
                      setSettings(next);
                    } catch (err) {
                      setError(String(err));
                      await refreshSettings();
                    }
                  })();
                }}
                className="h-2 w-full cursor-pointer accent-indigo-500 disabled:opacity-50"
              />
            </div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="max-tokens-select">
              Max input tokens
            </label>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Presets match common context sizes. This caps how many tokens the model may produce in its
              reply (generation budget).{" "}
              <span className="text-slate-600 dark:text-slate-400">
                <strong className="font-medium text-slate-700 dark:text-slate-300">Use model default</strong> lets Persistent Sage use this
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
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { maxTokens },
                    });
                    setSettings({ ...next, maxTokens: next.maxTokens ?? null });
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
              className="w-full cursor-pointer rounded-lg border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-900 py-2.5 pl-3 pr-8 text-sm text-zinc-900 dark:text-zinc-100 outline-none [color-scheme:light] dark:[color-scheme:dark] focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
          ) : null}

          {settingsTab === "tools" ? (
            <>
          <SettingsSection
            title="Assistant tools"
            info={TOOLS_SECTION_INFO}
            compact
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className={`min-h-0 flex-1 ${panelDense ? "space-y-1 overflow-hidden" : "space-y-1.5 overflow-y-auto"}`}>
            <div className="space-y-1.5 rounded-md border border-slate-200 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950/30 px-2.5 py-2 text-[10px] leading-relaxed text-slate-500">
              <p>
                <span className="font-medium text-slate-600 dark:text-slate-400">Built-in tools</span> — grouped below by what enables them.
              </p>
              <p>
                <span className="text-slate-600">Web:</span>{" "}
                {toolLabelList(["web_search", "fetch_url", "http_request", "fetch_browser"])}
              </p>
              <p>
                <span className="text-slate-600">Files:</span>{" "}
                {toolLabelList([
                  "workspace_list_directory",
                  "workspace_read_file",
                  "workspace_write_file",
                ])}
              </p>
              <p>
                <span className="text-slate-600">Other:</span>{" "}
                {toolLabelList([
                  "database_query",
                  "personality_get",
                  "personality_update",
                  "memory_search",
                ])}
              </p>
            </div>
            <SettingsToggleCard
              id="artifacts-enabled"
              title="Enable chat artifacts (experimental)"
              compact
              info={
                <>
                  Allows Persistent Sage to render structured assistant outputs (HTML pages, charts, tables, and forms) inside the chat window.
                  Artifacts are rendered locally with no JavaScript execution.
                </>
              }
              checked={settings?.artifactsEnabled ?? true}
              onChange={(artifactsEnabled) => {
                setSettings((s) => (s ? { ...s, artifactsEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { artifactsEnabled },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />
            <SettingsToggleCard
              id="agent-web-tools"
              title="Allow web tools for the assistant"
              compact
              info={WEB_TOOLS_INFO}
              footnote={providerToolsFootnote(settings)}
              checked={settings?.agentWebToolsEnabled ?? false}
              disabled={!providerSupportsTools(settings)}
              onChange={(agentWebToolsEnabled) => {
                setSettings((s) => (s ? { ...s, agentWebToolsEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { agentWebToolsEnabled },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            >
              {settings?.agentWebToolsEnabled ? WEB_TOOLS_WHEN_ENABLED : null}
            </SettingsToggleCard>
            <SettingsToggleCard
              id="agent-browser-fetch"
              title={toolDisplayName("fetch_browser")}
              compact
              info={BROWSER_FETCH_INFO}
              nestDepth={1}
              footnote="Requires Allow web tools."
              checked={settings?.agentBrowserFetchEnabled ?? false}
              disabled={!providerSupportsTools(settings) || !settings?.agentWebToolsEnabled}
              onChange={(agentBrowserFetchEnabled) => {
                setSettings((s) => (s ? { ...s, agentBrowserFetchEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { agentBrowserFetchEnabled },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />
            <SettingsToggleCard
              id="agent-browser-ignore-robots"
              title="Ignore robots.txt for browser fetch"
              compact
              info={BROWSER_ROBOTS_INFO}
              nestDepth={2}
              footnote="Requires Browser Page Fetch."
              checked={settings?.agentBrowserIgnoreRobots ?? false}
              disabled={
                !providerSupportsTools(settings) ||
                !settings?.agentWebToolsEnabled ||
                !settings?.agentBrowserFetchEnabled
              }
              onChange={(agentBrowserIgnoreRobots) => {
                setSettings((s) => (s ? { ...s, agentBrowserIgnoreRobots } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { agentBrowserIgnoreRobots },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />

            <SettingsToggleCard
              id="agent-personality-edit"
              title={`Allow ${toolDisplayName("personality_get")} & ${toolDisplayName("personality_update")}`}
              compact
              info={PERSONALITY_EDIT_INFO}
              footnote={providerToolsFootnote(settings)}
              checked={settings?.agentPersonalityEditEnabled ?? false}
              disabled={!providerSupportsTools(settings)}
              onChange={(agentPersonalityEditEnabled) => {
                setSettings((s) => (s ? { ...s, agentPersonalityEditEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { agentPersonalityEditEnabled },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />

            <SettingsToggleCard
              id="agent-workspace-tools"
              title={`Allow ${toolLabelList([
                "workspace_list_directory",
                "workspace_read_file",
                "workspace_write_file",
              ])}`}
              compact
              info={WORKSPACE_TOOLS_INFO}
              footnote={providerToolsFootnote(settings)}
              checked={settings?.agentWorkspaceEnabled ?? false}
              disabled={!providerSupportsTools(settings)}
              onChange={(agentWorkspaceEnabled) => {
                setSettings((s) => (s ? { ...s, agentWorkspaceEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { agentWorkspaceEnabled },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            >
              {dataPaths?.workspaceDirectory ? (
                <p className="break-all font-mono text-[10px] text-slate-500" title={dataPaths.workspaceDirectory}>
                  {dataPaths.workspaceDirectory}
                </p>
              ) : null}
            </SettingsToggleCard>
            <SettingsToggleCard
              id="database-app-data-enabled"
              title={`${toolDisplayName("database_query")} on app data folder`}
              compact
              info={APP_DATA_DB_INFO}
              footnote={providerToolsFootnote(settings)}
              checked={settings?.databaseAppDataEnabled ?? false}
              disabled={!providerSupportsTools(settings)}
              onChange={(databaseAppDataEnabled) => {
                setSettings((s) => (s ? { ...s, databaseAppDataEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { databaseAppDataEnabled },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            >
              {dataPaths?.dataDirectory ? (
                <p className="break-all font-mono text-[10px] text-slate-500" title={dataPaths.dataDirectory}>
                  {dataPaths.dataDirectory}
                </p>
              ) : null}
            </SettingsToggleCard>
            <SettingsToggleCard
              id="database-allow-write"
              title={`Allow write access (${toolDisplayName("database_query")})`}
              compact
              info={DB_WRITE_INFO}
              nestDepth={1}
              footnote="Requires Workspace file tools and/or Database Query on app data."
              checked={settings?.databaseAllowWrite ?? false}
              disabled={
                !providerSupportsTools(settings) ||
                (!settings?.agentWorkspaceEnabled && !settings?.databaseAppDataEnabled)
              }
              onChange={(databaseAllowWrite) => {
                setSettings((s) => (s ? { ...s, databaseAllowWrite } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { databaseAllowWrite },
                    });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />
            </div>
          </SettingsSection>
            </>
          ) : null}

          {settingsTab === "general" ? (
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
            title="Open beta feedback"
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
                  onClick={() => void openFeedback("beta")}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300/70 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/25 px-3 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-950/40"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  Beta feedback
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
                  flushDebounce();
                  void (async () => {
                    try {
                      setError(null);
                      const next = await invoke<SettingsView>("settings_update", { patch: { pulseEnabled } });
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
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { memoryLlmExtractionEnabled },
                    });
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
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await invoke<SettingsView>("settings_update", {
                      patch: { memorySemanticEnabled },
                    });
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
            </>
          ) : null}
          </div>
        </div>
      </div>

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
    </aside>
  );
}
