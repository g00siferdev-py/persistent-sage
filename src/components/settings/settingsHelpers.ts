import { invoke } from "@tauri-apps/api/core";
import type { SettingsLayoutMode } from "@/lib/settingsLayout";
import type {
  AppDataPaths,
  CacheInfo,
  FeedbackKind,
  SettingsPatch,
  SettingsView,
} from "@/components/settings/settingsTypes";

export const FEEDBACK_ISSUE_URL = "https://github.com/g00siferdev-py/persistent-sage/issues/new";

/** Preset caps for assistant generation; `null` = defer to model / context (see backend). */
export const MAX_TOKEN_SELECT_OPTIONS: { value: string; label: string; tokens: number | null }[] = [
  { value: "default", label: "Use model default (recommended)", tokens: null },
  { value: "4096", label: "4,096", tokens: 4096 },
  { value: "8192", label: "8,192", tokens: 8192 },
  { value: "16384", label: "16,384", tokens: 16384 },
  { value: "32768", label: "32,768", tokens: 32768 },
  { value: "128000", label: "128,000", tokens: 128_000 },
  { value: "200000", label: "200,000 (large-context models)", tokens: 200_000 },
];

export function providerSupportsTools(settings: SettingsView | null): boolean {
  return Boolean(
    settings &&
      ["openai", "ollama", "ollama_cloud", "anthropic", "xai"].includes(settings.selectedProvider),
  );
}

export function providerToolsFootnote(settings: SettingsView | null): string | undefined {
  if (providerSupportsTools(settings)) return undefined;
  return "Switch provider to OpenAI, xAI, Ollama, or Anthropic.";
}

export function settingsPanelWidth(mode: SettingsLayoutMode): string {
  switch (mode) {
    case "hidden":
      return "w-0 min-w-0";
    case "compact":
      return "w-[min(100%,26rem)] min-w-[20rem]";
    case "full":
      return "w-[min(92vw,44rem)] min-w-[28rem]";
  }
}

export function mergeModelOptions(
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

export function maxTokensSelectValue(settings: SettingsView | null): string {
  if (!settings) return "default";
  const mt = settings.maxTokens;
  if (mt == null) return "default";
  if (MAX_TOKEN_SELECT_OPTIONS.some((o) => o.tokens === mt)) {
    return String(mt);
  }
  return `legacy:${mt}`;
}

export function normalizeCacheInfo(
  raw: Partial<CacheInfo> & { directory?: string; fileCount?: number; totalBytes?: number },
): CacheInfo {
  return {
    path: raw.path ?? raw.directory ?? "",
    exists: raw.exists ?? true,
    itemCount: raw.itemCount ?? raw.fileCount ?? 0,
    sizeBytes: raw.sizeBytes ?? raw.totalBytes ?? 0,
  };
}

export function modelForProvider(settings: SettingsView | null): string {
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

export function feedbackIssueUrl(
  kind: FeedbackKind,
  settings: SettingsView | null,
  backend: string | null,
  dataPaths: AppDataPaths | null,
): string {
  const appVersion = backend ?? "unknown";
  const provider = settings?.selectedProvider ?? "unknown";
  const model = modelForProvider(settings);
  const installType = dataPaths?.novaPortableEnv ? "portable" : "desktop/default";
  const titlePrefix =
    kind === "bug" ? "[Bug]" : kind === "idea" ? "[Idea]" : "[Feedback]";
  const labels =
    kind === "bug" ? "bug,feedback" : kind === "idea" ? "enhancement,feedback" : "feedback";
  const body = [
    "## Summary",
    "",
    kind === "bug"
      ? "What went wrong?"
      : kind === "idea"
        ? "What would make Persistent Sage better?"
        : "What worked well? What felt confusing or missing?",
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

export async function applySettingsPatch(patch: SettingsPatch): Promise<SettingsView> {
  return invoke<SettingsView>("settings_update", { patch });
}
