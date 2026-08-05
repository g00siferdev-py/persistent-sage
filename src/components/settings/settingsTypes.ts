import type { SettingsLayoutMode } from "@/lib/settingsLayout";

export type SettingsPanelProps = {
  layoutMode: SettingsLayoutMode;
  onLayoutModeChange: (mode: SettingsLayoutMode) => void;
  /** When the user switches companion profile, refresh MemoryAnchor scope and chat threads. */
  onCompanionActiveProfileChange?: (profileId: string) => void | Promise<void>;
  /** Profile id currently used for chat memory (from `useChat`). */
  chatActiveProfileId?: string;
  /** Re-open the first-run setup wizard (from ChatLayout). */
  onRequestOnboarding?: () => void;
};

export type SettingsView = {
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
  openrouterModel: string;
  openrouterBaseUrl: string;
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
  agentCodingToolsEnabled: boolean;
  agentCodingShellEnabled: boolean;
  agentCodingGitEnabled: boolean;
  agentCodingGitRemoteEnabled: boolean;
  agentCodingCompanionLinkedEnabled: boolean;
  agentPersonalityEditEnabled: boolean;
  /** When true, companion/coding agents may spawn nested `task` subagents. */
  subagentsEnabled: boolean;
  subagentMaxDepth: number;
  subagentMaxConcurrent: number;
  subagentRoundBudget: number;
  subagentPreferOpenrouter: boolean;
  subagentModel: string;
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
  hasOpenrouterApiKey: boolean;
  hasGithubPat: boolean;
  hasMoltbookApiKey: boolean;
  onboardingCompleted: boolean;
  artifactsEnabled: boolean;
  moltbookEnabled: boolean;
  moltbookBaseUrl: string;
  moltbookDefaultSubmolt: string;
  moltbookAgentToolsEnabled: boolean;
  moltbookSchedulerEnabled: boolean;
  moltbookInteractIntervalMinutes: number;
  moltbookPostIntervalMinutes: number;
  moltbookEngageBrowseFeed: boolean;
  moltbookEngageSearch: boolean;
  moltbookEngageUpvote: boolean;
  moltbookEngageComment: boolean;
  moltbookEngageReplyOwn: boolean;
  moltbookEngageDms: boolean;
  moltbookEngageFollow: boolean;
  moltbookAgentPrompt: string;
  moltbookNeverDiscussHuman: boolean;
  moltbookBlockedTopics: string;
  moltbookReplyWatcherEnabled: boolean;
  moltbookReplyPollMinutes: number;
  googleEnabled: boolean;
  googleClientId: string;
  googleGmailEnabled: boolean;
  googleCalendarEnabled: boolean;
  googleDriveEnabled: boolean;
  googleAgentToolsEnabled: boolean;
  googleAgentSendEnabled: boolean;
  googleAccountEmail: string;
  hasGoogleClientSecret: boolean;
  googleConnected: boolean;
  googleSageAccountEmail: string;
  googleSageConnected: boolean;
  googleAgentEmailWatchEnabled: boolean;
  googleAgentEmailWatchIntervalMinutes: number;
  googleEmailAgentConversationId?: string | null;
  pulses: PulseEntry[];
};

export type PulseEntry = {
  id: string;
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  instructions: string;
  conversationId?: string | null;
  lastRunAt?: string | null;
};

export type SettingsPatch = {
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
  openrouterModel?: string;
  openrouterBaseUrl?: string;
  thinkingEffort?: "low" | "medium" | "high";
  temperature?: number;
  /** Omit = unchanged; null = clear cap */
  maxTokens?: number | null;
  agentWebToolsEnabled?: boolean;
  agentBrowserFetchEnabled?: boolean;
  agentBrowserIgnoreRobots?: boolean;
  agentWorkspaceEnabled?: boolean;
  agentCodingToolsEnabled?: boolean;
  agentCodingShellEnabled?: boolean;
  agentCodingGitEnabled?: boolean;
  agentCodingGitRemoteEnabled?: boolean;
  agentCodingCompanionLinkedEnabled?: boolean;
  agentPersonalityEditEnabled?: boolean;
  subagentsEnabled?: boolean;
  subagentMaxDepth?: number;
  subagentMaxConcurrent?: number;
  subagentRoundBudget?: number;
  subagentPreferOpenrouter?: boolean;
  subagentModel?: string;
  databaseAppDataEnabled?: boolean;
  databaseAllowWrite?: boolean;
  pulseEnabled?: boolean;
  pulseIntervalMinutes?: number;
  pulseInstructions?: string;
  pulseConversationId?: string | null;
  pulses?: PulseEntry[];
  memoryLlmExtractionEnabled?: boolean;
  memorySemanticEnabled?: boolean;
  embeddingModel?: string;
  onboardingCompleted?: boolean;
  artifactsEnabled?: boolean;
  moltbookEnabled?: boolean;
  moltbookBaseUrl?: string;
  moltbookDefaultSubmolt?: string;
  moltbookAgentToolsEnabled?: boolean;
  moltbookSchedulerEnabled?: boolean;
  moltbookInteractIntervalMinutes?: number;
  moltbookPostIntervalMinutes?: number;
  moltbookEngageBrowseFeed?: boolean;
  moltbookEngageSearch?: boolean;
  moltbookEngageUpvote?: boolean;
  moltbookEngageComment?: boolean;
  moltbookEngageReplyOwn?: boolean;
  moltbookEngageDms?: boolean;
  moltbookEngageFollow?: boolean;
  moltbookAgentPrompt?: string;
  moltbookNeverDiscussHuman?: boolean;
  moltbookBlockedTopics?: string;
  moltbookReplyWatcherEnabled?: boolean;
  moltbookReplyPollMinutes?: number;
  googleEnabled?: boolean;
  googleClientId?: string;
  googleGmailEnabled?: boolean;
  googleCalendarEnabled?: boolean;
  googleDriveEnabled?: boolean;
  googleAgentToolsEnabled?: boolean;
  googleAgentSendEnabled?: boolean;
  googleAgentEmailWatchEnabled?: boolean;
  googleAgentEmailWatchIntervalMinutes?: number;
  googleEmailAgentConversationId?: string | null;
};

export type ProviderDescriptor = {
  id: string;
  label: string;
  localFirst: boolean;
  requiresApiKey: boolean;
};

/** One model a provider offers, already filtered by the backend to chat-capable entries. */
export type ModelCatalogEntry = {
  id: string;
  label: string;
  supportsTools: boolean;
  supportsVision: boolean;
  contextLength?: number | null;
  isFree: boolean;
};

export type SettingsTab = "companion" | "provider" | "tools" | "general";

export type PulseTickPayload = {
  ok: boolean;
  at: string;
  pulseId?: string;
  pulseName?: string;
  conversationId?: string;
  summary?: string;
  error?: string;
};

export type DestructiveModal = "memory" | "factory";

export type AppDataPaths = {
  dataDirectory: string;
  databaseFile: string;
  workspaceDirectory: string;
  sqliteProfile: string;
  novaDataDirEnv: boolean;
  novaPortableEnv: boolean;
};

export type CacheInfo = {
  path: string;
  exists: boolean;
  itemCount: number;
  sizeBytes: number;
};

export type StoreUpdateCheckResult = {
  upToDate: boolean;
  updateAvailable: boolean;
  packageCount: number;
  message: string;
};

export type DistributionInfo = {
  channel: "microsoft_store" | "direct_download";
  updatesViaMicrosoftStore: boolean;
  storeLibraryUri: string;
};

export type PendingUpdate = {
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (callback?: (event: unknown) => void) => Promise<void>;
};

export type FeedbackKind = "bug" | "idea" | "feedback";
