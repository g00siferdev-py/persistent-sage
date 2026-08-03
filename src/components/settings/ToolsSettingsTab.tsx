import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound } from "lucide-react";
import { SettingsSection, SettingsToggleCard } from "@/components/settings/settingsUi";
import {
  applySettingsPatch,
  providerSupportsTools,
  providerToolsFootnote,
} from "@/components/settings/settingsHelpers";
import type { AppDataPaths, SettingsPatch, SettingsView } from "@/components/settings/settingsTypes";
import { toolDisplayName, toolLabelList } from "@/lib/toolDisplayNames";

const TOOLS_SECTION_INFO = (
  <>
    Chat-only options for OpenAI, xAI, Ollama, and Anthropic. Pulse uses the same toggles when it runs in the
    background. Tool names below are what your companion sees in plain language; the app still uses internal ids for
    API calls.
  </>
);

const WEB_TOOLS_WHEN_ENABLED = (
  <ul className="mt-2 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed text-ps-faint">
    <li>{toolDisplayName("web_search")}</li>
    <li>{toolDisplayName("fetch_url")}</li>
    <li>{toolDisplayName("http_request")}</li>
  </ul>
);

const WEB_TOOLS_INFO = (
  <>
    When enabled, your companion may use:{" "}
    <strong className="font-medium text-ps-muted">
      {toolLabelList(["web_search", "fetch_url", "http_request"])}
    </strong>
    . Web Search uses DuckDuckGo; Fetch URL loads public pages as plain text. For JS-heavy news homepages (CNN, BBC),
    also turn on{" "}
    <strong className="font-medium text-ps-muted">{toolDisplayName("fetch_browser")}</strong> below.
    Requests leave this device; local and private URLs are blocked. Requires a tool-capable model. Off by default.
  </>
);

const PERSONALITY_EDIT_INFO = (
  <>
    When enabled, your companion may use{" "}
    <strong className="font-medium text-ps-muted">{toolDisplayName("personality_get")}</strong> and{" "}
    <strong className="font-medium text-ps-muted">{toolDisplayName("personality_update")}</strong> to
    read or change the active profile in{" "}
    <span className="font-mono text-ps-muted">personality.json</span>. Saves to disk and updates
    this chat&apos;s persona immediately. Off by default.
  </>
);

const BROWSER_FETCH_INFO = (
  <>
    Uses system Chrome, Chromium, or Edge to load pages with JavaScript, a normal browser user-agent, and a persistent
    cookie profile. Better for news sites and bot-protected pages. Requires{" "}
    <strong className="font-medium text-ps-muted">Allow web tools</strong> to be on as well. Needs a
    browser install or{" "}
    <span className="font-mono text-ps-muted">PERSISTENT_SAGE_CHROME_PATH</span>. In Docker, install{" "}
    <span className="font-mono text-ps-muted">ca-certificates</span> and set{" "}
    <span className="font-mono text-ps-muted">PERSISTENT_SAGE_CHROME_NO_SANDBOX=1</span> if needed.
    Off by default.
  </>
);

const BROWSER_ROBOTS_INFO = (
  <>
    When enabled,{" "}
    <strong className="font-medium text-ps-muted">{toolDisplayName("fetch_browser")}</strong> does not
    block URLs based on robots.txt. For personal automation on your machine; many news sites disallow bots in
    robots.txt. Off by default.
  </>
);

const WORKSPACE_TOOLS_INFO = (
  <>
    When enabled, your companion may use{" "}
    <strong className="font-medium text-ps-muted">
      {toolLabelList(["workspace_list_directory", "workspace_read_file", "workspace_write_file"])}
    </strong>{" "}
    in the Persistent Sage workspace, and{" "}
    <strong className="font-medium text-ps-muted">{toolDisplayName("database_query")}</strong> on{" "}
    <span className="font-mono text-ps-muted">.db</span> /{" "}
    <span className="font-mono text-ps-muted">.sqlite</span> files there (workspace location). Paths
    are relative; <span className="font-mono text-ps-muted">..</span> is rejected. Off by default.
    For the live app database folder, enable App data directory databases below instead.
  </>
);

const APP_DATA_DB_INFO = (
  <>
    When enabled, your companion may use{" "}
    <strong className="font-medium text-ps-muted">{toolDisplayName("database_query")}</strong> on SQLite
    files in Persistent Sage&apos;s data directory — the same resolved path as the live memory database (for example{" "}
    <span className="font-mono text-ps-muted">~/.local/share/persistent-sage/data</span> on Linux, or
    the portable <span className="font-mono text-ps-muted">data/</span> folder next to the
    executable). Use a filename only (e.g.{" "}
    <span className="font-mono text-ps-muted">nova_memory.sqlite</span>), no subdirectories. Off by
    default.
  </>
);

const DB_WRITE_INFO = (
  <>
    When off (default),{" "}
    <strong className="font-medium text-ps-muted">{toolDisplayName("database_query")}</strong> is
    read-only (SELECT and introspection). When on, INSERT/UPDATE/DELETE/REPLACE are allowed. Requires{" "}
    <strong className="font-medium text-ps-muted">Workspace file tools</strong> and/or{" "}
    <strong className="font-medium text-ps-muted">Database Query on app data</strong> enabled above.
    DROP/ALTER/CREATE/PRAGMA/VACUUM remain blocked.
  </>
);

const CODING_TOOLS_INFO = (
  <>
    For <strong className="font-medium text-ps-muted">Coding mode</strong> only. Enables{" "}
    {toolLabelList(["coding_grep", "coding_apply_patch"])} scoped to the active repo under{" "}
    <span className="font-mono text-ps-muted">workspace/repos/</span>. Also enables workspace file
    tools for that session. Off by default.
  </>
);

const CODING_SHELL_INFO = (
  <>
    Coding mode: allowlisted shell commands via {toolDisplayName("coding_run_command")} (npm, cargo, git, python, etc.)
    in the active repo directory. Off by default.
  </>
);

const CODING_GIT_INFO = (
  <>
    Coding mode: {toolLabelList(["coding_git_status", "coding_git_diff", "coding_git_commit"])} for the active repo.
    Commits are local only unless remote git is enabled. Off by default.
  </>
);

const CODING_GIT_REMOTE_INFO = (
  <>
    Coding mode: {toolLabelList(["coding_git_push", "coding_git_pull", "coding_git_fetch", "coding_git_clone"])} via HTTPS
    and a saved GitHub PAT. Force push is blocked. Requires a GitHub token below (or ask the agent to save one). Off by
    default.
  </>
);

const CODING_COMPANION_LINKED_INFO = (
  <>
    When on, coding mode uses your{" "}
    <strong className="font-medium text-ps-muted">active companion</strong> (persona + memory).
    Project decisions from coding can be saved to that companion&apos;s memory; code snippets and command output are
    filtered out. Uses the same provider and model as Companion mode.
  </>
);

export type ToolsSettingsTabProps = {
  settings: SettingsView | null;
  setSettings: Dispatch<SetStateAction<SettingsView | null>>;
  dataPaths: AppDataPaths | null;
  panelDense: boolean;
  flushDebounce: () => void;
  schedulePatch: (patch: SettingsPatch) => void;
  setError: (error: string | null) => void;
  refreshSettings: () => Promise<void>;
};

export function ToolsSettingsTab({
  settings,
  setSettings,
  dataPaths,
  panelDense,
  flushDebounce,
  schedulePatch,
  setError,
  refreshSettings,
}: ToolsSettingsTabProps) {
  const [githubPatInput, setGithubPatInput] = useState("");
  const [googleClientIdInput, setGoogleClientIdInput] = useState("");
  const [googleSecretInput, setGoogleSecretInput] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMsg, setGoogleMsg] = useState<string | null>(null);
  const [googleHasBuiltin, setGoogleHasBuiltin] = useState(false);
  const [moltbookKeyInput, setMoltbookKeyInput] = useState("");
  const [moltbookAgentName, setMoltbookAgentName] = useState("");
  const [moltbookBusy, setMoltbookBusy] = useState(false);
  const [moltbookStatusMsg, setMoltbookStatusMsg] = useState<string | null>(null);
  const [moltbookSchedBusy, setMoltbookSchedBusy] = useState(false);
  const [moltbookSchedMsg, setMoltbookSchedMsg] = useState<string | null>(null);
  const [preferSubmolt, setPreferSubmolt] = useState(
    () => Boolean(settings?.moltbookDefaultSubmolt?.trim()),
  );
  const [submoltOptions, setSubmoltOptions] = useState<{ name: string; displayName: string }[]>(
    [],
  );
  const [submoltsLoading, setSubmoltsLoading] = useState(false);
  const [submoltsError, setSubmoltsError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await invoke<{ hasBuiltinClient: boolean }>("google_status");
        setGoogleHasBuiltin(!!s.hasBuiltinClient);
      } catch {
        setGoogleHasBuiltin(false);
      }
    })();
  }, [settings?.googleEnabled, settings?.googleClientId]);

  useEffect(() => {
    setPreferSubmolt(Boolean(settings?.moltbookDefaultSubmolt?.trim()));
  }, [settings?.moltbookDefaultSubmolt]);

  useEffect(() => {
    if (!settings?.moltbookEnabled || !settings?.hasMoltbookApiKey || !preferSubmolt) {
      return;
    }
    let cancelled = false;
    setSubmoltsLoading(true);
    setSubmoltsError(null);
    void invoke<{ submolts?: unknown }>("moltbook_list_submolts")
      .then((res) => {
        if (cancelled) return;
        const raw = Array.isArray(res?.submolts) ? res.submolts : [];
        const opts = raw
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const o = item as Record<string, unknown>;
            const name =
              typeof o.name === "string"
                ? o.name
                : typeof o.submolt === "string"
                  ? o.submolt
                  : null;
            if (!name) return null;
            const displayName =
              typeof o.display_name === "string"
                ? o.display_name
                : typeof o.displayName === "string"
                  ? o.displayName
                  : name;
            return { name, displayName };
          })
          .filter((x): x is { name: string; displayName: string } => x != null)
          .sort((a, b) => a.name.localeCompare(b.name));
        setSubmoltOptions(opts);
      })
      .catch((e) => {
        if (!cancelled) setSubmoltsError(String(e));
      })
      .finally(() => {
        if (!cancelled) setSubmoltsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings?.moltbookEnabled, settings?.hasMoltbookApiKey, preferSubmolt]);

  const saveGithubPat = async () => {
    try {
      setError(null);
      await invoke("settings_save_api_key", { provider: "github", apiKey: githubPatInput });
      setGithubPatInput("");
      await refreshSettings();
    } catch (e) {
      setError(String(e));
    }
  };

  const saveMoltbookKey = async () => {
    try {
      setError(null);
      setMoltbookStatusMsg(null);
      await invoke("settings_save_api_key", { provider: "moltbook", apiKey: moltbookKeyInput });
      setMoltbookKeyInput("");
      await refreshSettings();
      setMoltbookStatusMsg("Moltbook API key saved (encrypted).");
    } catch (e) {
      setError(String(e));
    }
  };

  const registerMoltbookAgent = async () => {
    try {
      setMoltbookBusy(true);
      setError(null);
      setMoltbookStatusMsg(null);
      const registered = await invoke<Record<string, unknown>>("moltbook_register_agent", {
        name: moltbookAgentName,
        description: "Persistent Sage companion agent",
      });
      setMoltbookAgentName("");
      await refreshSettings();
      const agent =
        registered.agent && typeof registered.agent === "object"
          ? (registered.agent as Record<string, unknown>)
          : registered;
      const claimUrl =
        (typeof agent.claim_url === "string" && agent.claim_url) ||
        (typeof registered.claim_url === "string" && registered.claim_url) ||
        null;
      const code =
        (typeof agent.verification_code === "string" && agent.verification_code) ||
        (typeof registered.verification_code === "string" && registered.verification_code) ||
        null;
      setMoltbookStatusMsg(
        claimUrl
          ? `Agent registered and API key saved. Claim it here to finish setup: ${claimUrl}${
              code ? ` (code: ${code})` : ""
            }`
          : "Agent registered on Moltbook — the API key was saved to encrypted settings automatically.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setMoltbookBusy(false);
    }
  };

  const testMoltbookConnection = async () => {
    try {
      setMoltbookBusy(true);
      setError(null);
      setMoltbookStatusMsg(null);
      const me = await invoke<Record<string, unknown>>("moltbook_me");
      const agent =
        me.agent && typeof me.agent === "object" ? (me.agent as Record<string, unknown>) : me;
      const name = typeof agent.name === "string" ? agent.name : "your agent";
      const karma = typeof agent.karma === "number" ? ` · ${agent.karma} karma` : "";
      setMoltbookStatusMsg(`Connected as ${name}${karma}.`);
    } catch (e) {
      setMoltbookStatusMsg(null);
      setError(String(e));
    } finally {
      setMoltbookBusy(false);
    }
  };

  const runMoltbookScheduler = async (
    command: "moltbook_scheduler_run_interact" | "moltbook_scheduler_run_post",
  ) => {
    try {
      setMoltbookSchedBusy(true);
      setError(null);
      setMoltbookSchedMsg(null);
      const result = await invoke<{
        ok?: boolean;
        summary?: string;
        error?: string;
        action?: string;
      }>(command);
      if (result?.ok === false || result?.error) {
        setMoltbookSchedMsg(null);
        setError(result.error || "Moltbook scheduler action failed.");
        return;
      }
      const clip =
        typeof result?.summary === "string" && result.summary.trim()
          ? result.summary.trim().slice(0, 220)
          : null;
      setMoltbookSchedMsg(
        clip
          ? `${command === "moltbook_scheduler_run_post" ? "Posted" : "Engaged"} — ${clip}`
          : command === "moltbook_scheduler_run_post"
            ? "Agent posted — check the Moltbook thread in your chat list."
            : "Agent engaged — check the Moltbook thread in your chat list.",
      );
    } catch (e) {
      setMoltbookSchedMsg(null);
      setError(String(e));
    } finally {
      setMoltbookSchedBusy(false);
    }
  };

  return (
    <>
      <SettingsSection
        title="Assistant tools"
        info={TOOLS_SECTION_INFO}
        compact
      >
        <div className={`${panelDense ? "space-y-1" : "space-y-1.5"}`}>
        <div className="space-y-1.5 rounded-md border border-ps-border bg-ps-elevated px-2.5 py-2 text-[10px] leading-relaxed text-ps-faint">
          <p>
            <span className="font-medium text-ps-muted">Built-in tools</span> — grouped below by what enables them.
          </p>
          <p>
            <span className="text-ps-muted">Web:</span>{" "}
            {toolLabelList(["web_search", "fetch_url", "http_request", "fetch_browser"])}
          </p>
          <p>
            <span className="text-ps-muted">Files:</span>{" "}
            {toolLabelList([
              "workspace_list_directory",
              "workspace_read_file",
              "workspace_write_file",
            ])}
          </p>
          <p>
            <span className="text-ps-muted">Other:</span>{" "}
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
          title="Enable chat artifacts"
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
                const next = await applySettingsPatch({ artifactsEnabled });
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
                const next = await applySettingsPatch({ agentWebToolsEnabled });
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
                const next = await applySettingsPatch({ agentBrowserFetchEnabled });
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
                const next = await applySettingsPatch({ agentBrowserIgnoreRobots });
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
                const next = await applySettingsPatch({ agentPersonalityEditEnabled });
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
                const next = await applySettingsPatch({ agentWorkspaceEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        >
          {dataPaths?.workspaceDirectory ? (
            <p className="break-all font-mono text-[10px] text-ps-faint" title={dataPaths.workspaceDirectory}>
              {dataPaths.workspaceDirectory}
            </p>
          ) : null}
        </SettingsToggleCard>

        <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-ps-accent">
          Coding mode
        </p>
        <SettingsToggleCard
          id="agent-coding-companion-linked"
          title="Link coding mode to active companion"
          compact
          info={CODING_COMPANION_LINKED_INFO}
          footnote="Companion selection is the profile chosen in the Companion tab."
          checked={settings?.agentCodingCompanionLinkedEnabled ?? true}
          onChange={(agentCodingCompanionLinkedEnabled) => {
            setSettings((s) => (s ? { ...s, agentCodingCompanionLinkedEnabled } : s));
            flushDebounce();
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ agentCodingCompanionLinkedEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        <SettingsToggleCard
          id="agent-coding-tools"
          title={`Allow ${toolLabelList(["coding_grep", "coding_apply_patch"])}`}
          compact
          info={CODING_TOOLS_INFO}
          footnote={providerToolsFootnote(settings)}
          checked={settings?.agentCodingToolsEnabled ?? false}
          disabled={!providerSupportsTools(settings)}
          onChange={(agentCodingToolsEnabled) => {
            setSettings((s) => (s ? { ...s, agentCodingToolsEnabled } : s));
            flushDebounce();
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ agentCodingToolsEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        <SettingsToggleCard
          id="agent-coding-shell"
          title={`Allow ${toolDisplayName("coding_run_command")}`}
          compact
          info={CODING_SHELL_INFO}
          nestDepth={1}
          footnote={providerToolsFootnote(settings)}
          checked={settings?.agentCodingShellEnabled ?? false}
          disabled={!providerSupportsTools(settings) || !settings?.agentCodingToolsEnabled}
          onChange={(agentCodingShellEnabled) => {
            setSettings((s) => (s ? { ...s, agentCodingShellEnabled } : s));
            flushDebounce();
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ agentCodingShellEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        <SettingsToggleCard
          id="agent-coding-git"
          title={`Allow ${toolLabelList(["coding_git_status", "coding_git_diff", "coding_git_commit"])}`}
          compact
          info={CODING_GIT_INFO}
          nestDepth={1}
          footnote={providerToolsFootnote(settings)}
          checked={settings?.agentCodingGitEnabled ?? false}
          disabled={!providerSupportsTools(settings) || !settings?.agentCodingToolsEnabled}
          onChange={(agentCodingGitEnabled) => {
            setSettings((s) => (s ? { ...s, agentCodingGitEnabled } : s));
            flushDebounce();
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ agentCodingGitEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        <SettingsToggleCard
          id="agent-coding-git-remote"
          title={`Allow ${toolLabelList(["coding_git_push", "coding_git_pull", "coding_git_fetch", "coding_git_clone"])}`}
          compact
          info={CODING_GIT_REMOTE_INFO}
          nestDepth={1}
          footnote={providerToolsFootnote(settings)}
          checked={settings?.agentCodingGitRemoteEnabled ?? false}
          disabled={
            !providerSupportsTools(settings) ||
            !settings?.agentCodingToolsEnabled ||
            !settings?.agentCodingGitEnabled
          }
          onChange={(agentCodingGitRemoteEnabled) => {
            setSettings((s) => (s ? { ...s, agentCodingGitRemoteEnabled } : s));
            flushDebounce();
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ agentCodingGitRemoteEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        <div className="ml-3 space-y-2 rounded-md border border-ps-border bg-ps-elevated px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">GitHub (coding mode)</p>
          <p className="text-[11px] leading-relaxed text-ps-faint">
            Personal Access Token for HTTPS clone, push, and pull. Stored encrypted locally — same as API keys. You
            can also paste a token in chat and ask the agent to save it.
          </p>
          <div className="flex items-center gap-2 text-xs text-ps-faint">
            <KeyRound className="size-3.5 shrink-0" aria-hidden />
            <span>
              GitHub PAT:{" "}
              {settings?.hasGithubPat ? (
                <span className="text-emerald-400/90">saved (encrypted)</span>
              ) : (
                <span className="text-amber-400/90">not set</span>
              )}
            </span>
          </div>
          <input
            type="password"
            autoComplete="off"
            placeholder="ghp_… or github_pat_…"
            value={githubPatInput}
            onChange={(e) => setGithubPatInput(e.target.value)}
            className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-ps-accent/50"
          />
          <button
            type="button"
            onClick={() => void saveGithubPat()}
            className="w-full rounded-lg bg-ps-accent px-3 py-2 text-xs font-semibold text-ps-accent-fg hover:bg-ps-accent"
          >
            Save GitHub PAT
          </button>
        </div>
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
                const next = await applySettingsPatch({ databaseAppDataEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        >
          {dataPaths?.dataDirectory ? (
            <p className="break-all font-mono text-[10px] text-ps-faint" title={dataPaths.dataDirectory}>
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
                const next = await applySettingsPatch({ databaseAllowWrite });
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

      <SettingsSection
        title="Moltbook"
        className="rounded-lg border border-ps-border bg-ps-elevated p-3"
        description={
          <span className="text-[#5a8f8c] dark:text-[#8ebdb9]">
            The social network for AI agents. Humans configure and browse; only the registered agent posts,
            comments, and DMs.
          </span>
        }
      >
        <SettingsToggleCard
          id="moltbook-enabled"
          title="Enable Moltbook integration"
          compact
          description="Shows the Moltbook panel so you can browse the feed and configure the agent. Humans never post — only the registered agent does."
          checked={settings?.moltbookEnabled ?? false}
          onChange={(moltbookEnabled) => {
            setSettings((s) => (s ? { ...s, moltbookEnabled } : s));
            flushDebounce();
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ moltbookEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        {settings?.moltbookEnabled ? (
          <>
            <div className="ml-0 space-y-2 rounded-md border border-[#3d8b8f]/40 bg-[#0a2a2d]/40 px-3 py-3">
              <p
                className="text-lg font-bold tracking-tight text-[#e8f4f3]"
                style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
              >
                Moltbook
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7ec8c4]">
                Agent identity
              </p>
              <div className="flex items-center gap-2 text-xs text-ps-faint">
                <KeyRound className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Moltbook API key:{" "}
                  {settings?.hasMoltbookApiKey ? (
                    <span className="text-emerald-400/90">saved (encrypted)</span>
                  ) : (
                    <span className="text-amber-400/90">not set</span>
                  )}
                </span>
              </div>
              {!settings?.hasMoltbookApiKey ? (
                <div className="space-y-2">
                  <p className="text-[11px] leading-relaxed text-ps-faint">
                    New to Moltbook? Register your companion as an agent — the API key is
                    stored encrypted automatically. That agent (not you) will post on Moltbook.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={moltbookAgentName}
                      onChange={(e) => setMoltbookAgentName(e.target.value)}
                      placeholder="Agent name (e.g. SageBot)"
                      className="min-w-0 flex-1 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-[#e86d4a]/60"
                    />
                    <button
                      type="button"
                      disabled={moltbookBusy || !moltbookAgentName.trim()}
                      onClick={() => void registerMoltbookAgent()}
                      className="rounded-lg bg-[#e86d4a] px-3 py-2 text-xs font-semibold text-[#1a100c] hover:bg-[#f0835f] disabled:opacity-50"
                    >
                      {moltbookBusy ? "Registering…" : "Register agent"}
                    </button>
                  </div>
                </div>
              ) : null}
              <p className="text-[11px] leading-relaxed text-ps-faint">
                Already have a key (moltbook_sk_…)? Paste it here.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="moltbook_sk_…"
                  value={moltbookKeyInput}
                  onChange={(e) => setMoltbookKeyInput(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 font-mono text-sm text-ps-ink outline-none focus:border-[#e86d4a]/60"
                />
                <button
                  type="button"
                  onClick={() => void saveMoltbookKey()}
                  className="rounded-lg bg-[#e86d4a] px-3 py-2 text-xs font-semibold text-[#1a100c] hover:bg-[#f0835f]"
                >
                  Save key
                </button>
              </div>
              <button
                type="button"
                disabled={moltbookBusy || !settings?.hasMoltbookApiKey}
                onClick={() => void testMoltbookConnection()}
                className="w-full rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-accent-soft disabled:opacity-50"
              >
                {moltbookBusy ? "Checking…" : "Test connection"}
              </button>
              {moltbookStatusMsg ? (
                <p className="text-[11px] leading-relaxed text-emerald-500 dark:text-emerald-400">
                  {moltbookStatusMsg}
                </p>
              ) : null}
            </div>

            <div className="ml-0 space-y-2 rounded-md border border-[#3d8b8f]/40 bg-[#0a2a2d]/40 px-3 py-3">
              <label
                htmlFor="moltbook-prefer-submolt"
                className="flex cursor-pointer items-start gap-2 text-xs text-[#c5dedc]"
              >
                <input
                  id="moltbook-prefer-submolt"
                  type="checkbox"
                  className="mt-0.5 size-3.5 rounded border-ps-border accent-[#e86d4a]"
                  checked={preferSubmolt}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setPreferSubmolt(on);
                    flushDebounce();
                    if (!on) {
                      setSettings((s) => (s ? { ...s, moltbookDefaultSubmolt: "" } : s));
                      void (async () => {
                        try {
                          setError(null);
                          const next = await applySettingsPatch({ moltbookDefaultSubmolt: "" });
                          setSettings(next);
                        } catch (err) {
                          setError(String(err));
                          await refreshSettings();
                        }
                      })();
                    } else if (!(settings?.moltbookDefaultSubmolt ?? "").trim()) {
                      const fallback = submoltOptions[0]?.name ?? "general";
                      setSettings((s) =>
                        s ? { ...s, moltbookDefaultSubmolt: fallback } : s,
                      );
                      schedulePatch({ moltbookDefaultSubmolt: fallback });
                    }
                  }}
                />
                <span>
                  <span className="font-semibold text-[#e8f4f3]">
                    Choose a preferred submolt to post in
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[#8ebdb9]">
                    Off by default — the agent picks the community each time. Turn on only if you
                    want a preferred default (the agent can still override it).
                  </span>
                </span>
              </label>
              {preferSubmolt ? (
                <label className="flex flex-col gap-1 pl-5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7ec8c4]">
                    Preferred community
                  </span>
                  <select
                    value={settings?.moltbookDefaultSubmolt || ""}
                    onChange={(e) => {
                      const moltbookDefaultSubmolt = e.target.value;
                      setSettings((s) => (s ? { ...s, moltbookDefaultSubmolt } : s));
                      schedulePatch({ moltbookDefaultSubmolt });
                    }}
                    disabled={submoltsLoading}
                    className="ps-select w-full max-w-xs px-3 py-2 text-sm"
                  >
                    {settings?.moltbookDefaultSubmolt &&
                    !submoltOptions.some((o) => o.name === settings.moltbookDefaultSubmolt) ? (
                      <option value={settings.moltbookDefaultSubmolt}>
                        m/{settings.moltbookDefaultSubmolt} (saved)
                      </option>
                    ) : null}
                    {submoltOptions.map((o) => (
                      <option key={o.name} value={o.name}>
                        m/{o.name}
                        {o.displayName !== o.name ? ` — ${o.displayName}` : ""}
                      </option>
                    ))}
                    {submoltOptions.length === 0 && !submoltsLoading ? (
                      <option value={settings?.moltbookDefaultSubmolt || "general"}>
                        m/{settings?.moltbookDefaultSubmolt || "general"}
                      </option>
                    ) : null}
                  </select>
                  <span className="text-[11px] leading-relaxed text-[#8ebdb9]">
                    {submoltsLoading
                      ? "Loading communities from Moltbook…"
                      : submoltsError
                        ? `Could not load list (${submoltsError}). Saved preference still applies.`
                        : "Loaded from Moltbook. Agent may still choose a different community."}
                  </span>
                </label>
              ) : null}
            </div>

            <div className="ml-3 space-y-3 rounded-md border border-ps-border bg-ps-elevated px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
                Agent voice on Moltbook
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ps-muted">
                  Extra guidelines for the agent
                </span>
                <textarea
                  rows={4}
                  value={settings?.moltbookAgentPrompt ?? ""}
                  onChange={(e) => {
                    const moltbookAgentPrompt = e.target.value;
                    setSettings((s) => (s ? { ...s, moltbookAgentPrompt } : s));
                    schedulePatch({ moltbookAgentPrompt });
                  }}
                  placeholder="Tone, topics to favor, how the agent should engage…"
                  className="w-full resize-y rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-[#e86d4a]/60"
                />
              </label>
              <SettingsToggleCard
                id="moltbook-never-discuss-human"
                title="Never discuss the human"
                compact
                description="When on, the agent must not name, describe, or allude to you in any Moltbook post, comment, or DM."
                checked={settings?.moltbookNeverDiscussHuman ?? true}
                onChange={(moltbookNeverDiscussHuman) => {
                  setSettings((s) => (s ? { ...s, moltbookNeverDiscussHuman } : s));
                  flushDebounce();
                  void (async () => {
                    try {
                      setError(null);
                      const next = await applySettingsPatch({ moltbookNeverDiscussHuman });
                      setSettings(next);
                    } catch (err) {
                      setError(String(err));
                      await refreshSettings();
                    }
                  })();
                }}
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ps-muted">
                  Blocked topics
                </span>
                <textarea
                  rows={2}
                  value={settings?.moltbookBlockedTopics ?? ""}
                  onChange={(e) => {
                    const moltbookBlockedTopics = e.target.value;
                    setSettings((s) => (s ? { ...s, moltbookBlockedTopics } : s));
                    schedulePatch({ moltbookBlockedTopics });
                  }}
                  placeholder="Comma- or newline-separated topics the agent must avoid"
                  className="w-full resize-y rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-[#e86d4a]/60"
                />
              </label>
            </div>

            <SettingsToggleCard
              id="moltbook-agent-tools"
              title="Let the agent use Moltbook tools"
              compact
              nestDepth={1}
              description="Gives the agent home, feed, search, comment, upvote, post, DMs, and follow tools so it can browse and act on Moltbook. Humans never post — only the agent does. Rate limits: 1 post / 30 min, 50 comments / hour."
              footnote={providerToolsFootnote(settings)}
              checked={settings?.moltbookAgentToolsEnabled ?? false}
              disabled={!providerSupportsTools(settings)}
              onChange={(moltbookAgentToolsEnabled) => {
                setSettings((s) => (s ? { ...s, moltbookAgentToolsEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await applySettingsPatch({ moltbookAgentToolsEnabled });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />
            <SettingsToggleCard
              id="moltbook-scheduler"
              title="Autonomous scheduler"
              compact
              nestDepth={1}
              description="The agent (never you) browses and posts to Moltbook on its own timers. Requires the Moltbook tools above. Activity is logged to a 'Moltbook' thread in your chat list."
              footnote={providerToolsFootnote(settings)}
              checked={settings?.moltbookSchedulerEnabled ?? false}
              disabled={
                !providerSupportsTools(settings) ||
                !(settings?.moltbookAgentToolsEnabled ?? false)
              }
              onChange={(moltbookSchedulerEnabled) => {
                setSettings((s) => (s ? { ...s, moltbookSchedulerEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await applySettingsPatch({ moltbookSchedulerEnabled });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />
            {settings?.moltbookSchedulerEnabled ? (
              <div className="ml-3 space-y-3 rounded-md border border-ps-border bg-ps-elevated px-3 py-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
                    Engage every (minutes)
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    value={settings?.moltbookInteractIntervalMinutes ?? 120}
                    onChange={(e) => {
                      const moltbookInteractIntervalMinutes = Math.max(
                        5,
                        Math.min(10080, Number(e.target.value) || 0),
                      );
                      setSettings((s) =>
                        s ? { ...s, moltbookInteractIntervalMinutes } : s,
                      );
                      schedulePatch({ moltbookInteractIntervalMinutes });
                    }}
                    className="w-32 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-[#e86d4a]/60"
                  />
                  <span className="text-[11px] leading-relaxed text-ps-faint">
                    How often the agent reads the feed, votes, and comments (default 120).
                  </span>
                </label>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
                    Engage actions
                  </p>
                  <p className="text-[11px] leading-relaxed text-ps-faint">
                    What the agent may do during an engage tick.
                  </p>
                  {(
                    [
                      {
                        id: "moltbook-engage-browse-feed",
                        key: "moltbookEngageBrowseFeed",
                        label: "Browse feed",
                        defaultOn: true,
                      },
                      {
                        id: "moltbook-engage-search",
                        key: "moltbookEngageSearch",
                        label: "Search",
                        defaultOn: true,
                      },
                      {
                        id: "moltbook-engage-upvote",
                        key: "moltbookEngageUpvote",
                        label: "Upvote",
                        defaultOn: true,
                      },
                      {
                        id: "moltbook-engage-comment",
                        key: "moltbookEngageComment",
                        label: "Comment",
                        defaultOn: true,
                      },
                      {
                        id: "moltbook-engage-reply-own",
                        key: "moltbookEngageReplyOwn",
                        label: "Reply to comments on own posts",
                        defaultOn: true,
                      },
                      {
                        id: "moltbook-engage-dms",
                        key: "moltbookEngageDms",
                        label: "DMs",
                        defaultOn: false,
                      },
                      {
                        id: "moltbook-engage-follow",
                        key: "moltbookEngageFollow",
                        label: "Follow",
                        defaultOn: false,
                      },
                    ] as const
                  ).map(({ id, key, label, defaultOn }) => (
                    <label
                      key={key}
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 text-xs text-ps-muted"
                    >
                      <input
                        id={id}
                        type="checkbox"
                        className="size-3.5 rounded border-ps-border accent-[#e86d4a]"
                        checked={settings?.[key] ?? defaultOn}
                        onChange={(e) => {
                          const value = e.target.checked;
                          setSettings((s) => (s ? { ...s, [key]: value } : s));
                          flushDebounce();
                          void (async () => {
                            try {
                              setError(null);
                              const next = await applySettingsPatch({ [key]: value });
                              setSettings(next);
                            } catch (err) {
                              setError(String(err));
                              await refreshSettings();
                            }
                          })();
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
                    Post every (minutes)
                  </span>
                  <input
                    type="number"
                    min={30}
                    max={10080}
                    value={settings?.moltbookPostIntervalMinutes ?? 720}
                    onChange={(e) => {
                      const moltbookPostIntervalMinutes = Math.max(
                        30,
                        Math.min(10080, Number(e.target.value) || 0),
                      );
                      setSettings((s) =>
                        s ? { ...s, moltbookPostIntervalMinutes } : s,
                      );
                      schedulePatch({ moltbookPostIntervalMinutes });
                    }}
                    className="w-32 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-[#e86d4a]/60"
                  />
                  <span className="text-[11px] leading-relaxed text-ps-faint">
                    How often the agent publishes an original post. Moltbook caps posting at
                    1 per 30 min (default 720 = every 12 hours). Humans never post.
                  </span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={moltbookSchedBusy}
                    onClick={() =>
                      void runMoltbookScheduler("moltbook_scheduler_run_interact")
                    }
                    className="flex-1 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-accent-soft disabled:opacity-50"
                  >
                    {moltbookSchedBusy ? "Working…" : "Engage now (agent)"}
                  </button>
                  <button
                    type="button"
                    disabled={moltbookSchedBusy}
                    onClick={() =>
                      void runMoltbookScheduler("moltbook_scheduler_run_post")
                    }
                    className="flex-1 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-semibold text-ps-ink hover:bg-ps-accent-soft disabled:opacity-50"
                  >
                    {moltbookSchedBusy ? "Working…" : "Post now (agent)"}
                  </button>
                </div>
                {moltbookSchedMsg ? (
                  <p className="text-[11px] leading-relaxed text-emerald-500 dark:text-emerald-400">
                    {moltbookSchedMsg}
                  </p>
                ) : null}
              </div>
            ) : null}

            <SettingsToggleCard
              id="moltbook-reply-watcher"
              title="Reply watcher"
              compact
              nestDepth={1}
              description="Polls the agent's home feed for new comments on its posts so the agent can reply. Humans never post — the agent handles replies."
              footnote={providerToolsFootnote(settings)}
              checked={settings?.moltbookReplyWatcherEnabled ?? false}
              disabled={
                !providerSupportsTools(settings) ||
                !(settings?.moltbookAgentToolsEnabled ?? false)
              }
              onChange={(moltbookReplyWatcherEnabled) => {
                setSettings((s) => (s ? { ...s, moltbookReplyWatcherEnabled } : s));
                flushDebounce();
                void (async () => {
                  try {
                    setError(null);
                    const next = await applySettingsPatch({ moltbookReplyWatcherEnabled });
                    setSettings(next);
                  } catch (err) {
                    setError(String(err));
                    await refreshSettings();
                  }
                })();
              }}
            />
            {settings?.moltbookReplyWatcherEnabled ? (
              <label className="ml-3 flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ps-faint">
                  Reply poll interval (minutes)
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={settings?.moltbookReplyPollMinutes ?? 2}
                  onChange={(e) => {
                    const moltbookReplyPollMinutes = Math.max(
                      1,
                      Math.min(30, Number(e.target.value) || 0),
                    );
                    setSettings((s) => (s ? { ...s, moltbookReplyPollMinutes } : s));
                    schedulePatch({ moltbookReplyPollMinutes });
                  }}
                  className="w-32 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-[#e86d4a]/60"
                />
                <span className="text-[11px] leading-relaxed text-ps-faint">
                  How often to check for replies on the agent&apos;s posts (1–30, default 2).
                </span>
              </label>
            ) : null}
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Google Workspace"
        className="rounded-lg border border-ps-border bg-ps-elevated p-3"
        description={
          <>
            Gmail, Google Calendar, Google Drive, Contacts, and Tasks — powers the
            Productivity-mode widgets and (optionally) companion agent tools like
            &ldquo;did I get an email from…&rdquo;, &ldquo;what&rsquo;s on my task
            list?&rdquo;, or &ldquo;add a vet appointment Tuesday at 11&rdquo;.
            Weather is available to the companion separately (no Google setup).
            Tokens are stored encrypted on this machine; nothing is shared with
            Persistent Sage servers (there are none).
          </>
        }
      >
        <SettingsToggleCard
          id="google-enabled"
          title="Enable Google Workspace integration"
          compact
          description="Master switch (optional — Sign in with Google also turns this on). Official builds include one-click sign-in; no Client ID or secret for normal users."
          checked={settings?.googleEnabled ?? false}
          onChange={(googleEnabled) => {
            setSettings((s) => (s ? { ...s, googleEnabled } : s));
            flushDebounce();
            void (async () => {
              try {
                setError(null);
                const next = await applySettingsPatch({ googleEnabled });
                setSettings(next);
              } catch (err) {
                setError(String(err));
                await refreshSettings();
              }
            })();
          }}
        />
        {settings?.googleEnabled || googleHasBuiltin ? (
          <>
            <div className="ml-0 space-y-2 rounded-md border border-ps-border bg-ps-surface px-3 py-3">
              <p className="ps-label">Your Google</p>
              {settings?.googleConnected && settings?.googleAccountEmail ? (
                <p className="text-[11px] text-ps-success">
                  Connected as {settings.googleAccountEmail}
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-ps-faint">
                  {googleHasBuiltin
                    ? "Click Sign in with Google — browser opens, you approve, done. No Cloud Console setup."
                    : "This build has no built-in Google app credentials. Add your own OAuth client under Advanced below, then sign in."}
                </p>
              )}
              {settings?.googleClientId ? (
                <div className="rounded-md border border-ps-border bg-ps-panel/50 px-2.5 py-2">
                  <p className="text-[10px] leading-relaxed text-ps-muted">
                    A custom OAuth Client ID is saved and overrides the built-in app. Clear it to use
                    one-click Sign in with Google again.
                  </p>
                  <button
                    type="button"
                    className="ps-btn mt-1.5 px-2 py-1 text-[11px]"
                    onClick={() => {
                      flushDebounce();
                      void (async () => {
                        try {
                          setError(null);
                          const next = await applySettingsPatch({ googleClientId: "" });
                          setSettings(next);
                          try {
                            await invoke("settings_save_api_key", {
                              provider: "google_client_secret",
                              apiKey: "",
                            });
                          } catch {
                            /* clearing secret is best-effort */
                          }
                          setGoogleMsg("Custom OAuth cleared — using built-in Google app.");
                          await refreshSettings();
                        } catch (err) {
                          setError(String(err));
                        }
                      })();
                    }}
                  >
                    Use built-in Sign in with Google
                  </button>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={googleBusy || (!googleHasBuiltin && !settings?.googleClientId)}
                  onClick={() => {
                    setGoogleBusy(true);
                    setGoogleMsg(null);
                    void (async () => {
                      try {
                        setError(null);
                        await invoke("google_auth_start", { account: "user" });
                        setGoogleMsg("Your Google account connected.");
                        await refreshSettings();
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setGoogleBusy(false);
                      }
                    })();
                  }}
                  className="ps-btn-primary px-3 py-2"
                >
                  {googleBusy
                    ? "Waiting for browser…"
                    : settings?.googleConnected
                      ? "Reconnect account"
                      : "Sign in with Google"}
                </button>
                {settings?.googleConnected ? (
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await invoke("google_disconnect", { account: "user" });
                          setGoogleMsg("Disconnected.");
                          await refreshSettings();
                        } catch (err) {
                          setError(String(err));
                        }
                      })();
                    }}
                    className="ps-btn px-3 py-2"
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
            </div>
            <div className="ml-0 space-y-2 rounded-md border border-ps-border bg-ps-surface px-3 py-3">
              <p className="ps-label">Agent&apos;s designated email</p>
              <p className="text-[11px] leading-relaxed text-ps-faint">
                Optional mailbox for agent correspondence — separate from your primary Google
                account. Create a Gmail specifically for your companion (any name you choose), then
                sign it in here. Tools use <span className="font-mono">account=agent</span>. While
                the OAuth app is in Testing, add that address as a consent-screen test user.
              </p>
              {settings?.googleSageConnected && settings?.googleSageAccountEmail ? (
                <p className="text-[11px] text-ps-success">
                  Connected as {settings.googleSageAccountEmail}
                </p>
              ) : (
                <p className="text-[11px] text-ps-faint">Not connected.</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={googleBusy || (!googleHasBuiltin && !settings?.googleClientId)}
                  onClick={() => {
                    setGoogleBusy(true);
                    setGoogleMsg(null);
                    void (async () => {
                      try {
                        setError(null);
                        await invoke("google_auth_start", { account: "agent" });
                        setGoogleMsg("Agent email account connected.");
                        await refreshSettings();
                      } catch (err) {
                        setError(String(err));
                      } finally {
                        setGoogleBusy(false);
                      }
                    })();
                  }}
                  className="ps-btn-primary px-3 py-2"
                >
                  {googleBusy
                    ? "Waiting for browser…"
                    : settings?.googleSageConnected
                      ? "Reconnect agent email"
                      : "Connect agent email"}
                </button>
                {settings?.googleSageConnected ? (
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await invoke("google_disconnect", { account: "agent" });
                          setGoogleMsg("Agent email disconnected.");
                          await refreshSettings();
                        } catch (err) {
                          setError(String(err));
                        }
                      })();
                    }}
                    className="ps-btn px-3 py-2"
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
              {settings?.googleSageConnected ? (
                <div className="space-y-2 border-t border-ps-border pt-2">
                  <div className="space-y-1.5 rounded-md border border-ps-border bg-ps-panel/40 px-2.5 py-2">
                    <p className="text-[11px] font-medium text-ps-ink">Global Email Agent</p>
                    <p className="text-[10px] leading-relaxed text-ps-muted">
                      One dedicated chat handles all agent-mailbox mail. Continuity lives in{" "}
                      <span className="font-mono">correspondence_sync.md</span>; every companion can
                      update it via the <span className="font-mono">correspondence_sync</span> tool.
                      On each inbox wake the Email Agent dirty-checks timestamps and only re-reads
                      the full sync file when it changed.
                    </p>
                    {settings.googleEmailAgentConversationId ? (
                      <p
                        className="font-mono text-[10px] text-ps-faint"
                        title={settings.googleEmailAgentConversationId}
                      >
                        Thread:{" "}
                        {settings.googleEmailAgentConversationId.length > 18
                          ? `${settings.googleEmailAgentConversationId.slice(0, 16)}…`
                          : settings.googleEmailAgentConversationId}
                      </p>
                    ) : (
                      <p className="text-[10px] text-ps-faint">
                        Created automatically on the first inbox check (or use the button below).
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="ps-btn-primary px-2 py-1 text-[11px]"
                        disabled={!settings}
                        onClick={() => {
                          void (async () => {
                            try {
                              setError(null);
                              // Ensure exists by running a bound check path: bind current chat as the
                              // global Email Agent if the user wants an explicit thread, otherwise
                              // Check now will auto-create "Email Agent".
                              const googleEmailAgentConversationId =
                                settings?.pulseConversationId?.trim() || null;
                              if (!googleEmailAgentConversationId) {
                                setError(
                                  "Open any companion chat first to seed the Email Agent thread id, or turn on Watch / Check now to auto-create it.",
                                );
                                return;
                              }
                              setSettings((s) =>
                                s ? { ...s, googleEmailAgentConversationId } : s,
                              );
                              schedulePatch({ googleEmailAgentConversationId });
                              setGoogleMsg(
                                "Current chat bound as the global Email Agent (or rename it to Email Agent in the sidebar).",
                              );
                              await refreshSettings();
                            } catch (err) {
                              setError(String(err));
                            }
                          })();
                        }}
                      >
                        Use this chat as Email Agent
                      </button>
                      {settings.googleEmailAgentConversationId ? (
                        <button
                          type="button"
                          className="ps-btn px-2 py-1 text-[11px]"
                          onClick={() => {
                            setSettings((s) =>
                              s ? { ...s, googleEmailAgentConversationId: null } : s,
                            );
                            schedulePatch({ googleEmailAgentConversationId: null });
                            setGoogleMsg(
                              "Cleared. Next inbox check will recreate the global Email Agent thread.",
                            );
                          }}
                        >
                          Reset thread
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <SettingsToggleCard
                    id="agent-email-watch"
                    title="Watch agent inbox"
                    compact
                    description="Timer wakes the global Email Agent only. It dirty-checks correspondence_sync, then reads/replies on the agent mailbox."
                    checked={settings?.googleAgentEmailWatchEnabled ?? false}
                    onChange={(googleAgentEmailWatchEnabled) => {
                      setSettings((s) => (s ? { ...s, googleAgentEmailWatchEnabled } : s));
                      schedulePatch({ googleAgentEmailWatchEnabled });
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-[10px] text-ps-muted">
                      Every
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        className="ps-input ml-1 w-16 px-2 py-1 font-mono text-xs"
                        value={settings?.googleAgentEmailWatchIntervalMinutes ?? 3}
                        disabled={!settings}
                        onChange={(e) => {
                          const raw = Number.parseInt(e.target.value, 10);
                          const googleAgentEmailWatchIntervalMinutes = Number.isNaN(raw)
                            ? 3
                            : Math.min(1440, Math.max(1, raw));
                          setSettings((s) =>
                            s ? { ...s, googleAgentEmailWatchIntervalMinutes } : s,
                          );
                          schedulePatch({ googleAgentEmailWatchIntervalMinutes });
                        }}
                      />{" "}
                      min
                    </label>
                    <button
                      type="button"
                      className="ps-btn px-2 py-1 text-[11px]"
                      disabled={!settings || settings.selectedProvider === "placeholder"}
                      onClick={() => {
                        void (async () => {
                          try {
                            setError(null);
                            await invoke("agent_email_watch_run_now");
                            setGoogleMsg("Email Agent inbox checked.");
                            await refreshSettings();
                          } catch (err) {
                            setError(String(err));
                          }
                        })();
                      }}
                    >
                      Check now
                    </button>
                  </div>
                  <p className="text-[10px] text-ps-faint">
                    Requires Google agent tools. Sync file:{" "}
                    <span className="font-mono">workspace/correspondence_sync.md</span>.
                  </p>
                </div>
              ) : null}
              {googleMsg ? <p className="text-[11px] text-ps-success">{googleMsg}</p> : null}
            </div>
              <details className="pt-1">
                <summary className="cursor-pointer select-none text-[11px] font-medium text-ps-muted hover:text-ps-ink">
                  Advanced — use your own OAuth client
                </summary>
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] leading-relaxed text-ps-faint">
                    For self-builds or development: create a <strong>Desktop app</strong> client
                    (not Web) in Google Cloud Console → APIs &amp; Services → Credentials. Enable
                    Gmail, Calendar, Drive, People, and Tasks APIs. Sign-in uses a temporary
                    loopback URL (<span className="font-mono">http://127.0.0.1:&lt;port&gt;</span>
                    ) — keep Persistent Sage open until the browser shows “connected”. Paste{" "}
                    <strong>both</strong> Client ID and Client secret from the downloaded JSON. A
                    saved Client ID overrides the built-in app. Official releases bake in the
                    publisher client via GitHub secrets{" "}
                    <span className="font-mono">PS_GOOGLE_CLIENT_ID</span> /{" "}
                    <span className="font-mono">PS_GOOGLE_CLIENT_SECRET</span>.
                  </p>
                  <p className="text-[11px] leading-relaxed text-ps-faint">
                    Client ID:{" "}
                    {settings?.googleClientId ? (
                      <span className="font-mono text-ps-muted">{settings.googleClientId.slice(0, 28)}…</span>
                    ) : (
                      <span className="text-ps-faint">using built-in</span>
                    )}
                    {" · "}Client secret:{" "}
                    {settings?.hasGoogleClientSecret ? (
                      <span className="text-ps-success">saved (encrypted)</span>
                    ) : (
                      <span className="text-ps-faint">not set</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="…apps.googleusercontent.com"
                      value={googleClientIdInput}
                      onChange={(e) => setGoogleClientIdInput(e.target.value)}
                      className="ps-input min-w-0 flex-1 px-3 py-2 font-mono text-xs"
                    />
                    <button
                      type="button"
                      disabled={!googleClientIdInput.trim()}
                      onClick={() => {
                        flushDebounce();
                        void (async () => {
                          try {
                            setError(null);
                            const next = await applySettingsPatch({
                              googleClientId: googleClientIdInput.trim(),
                            });
                            setSettings(next);
                            setGoogleClientIdInput("");
                            setGoogleMsg("Client ID saved.");
                          } catch (err) {
                            setError(String(err));
                          }
                        })();
                      }}
                      className="ps-btn-primary px-3 py-2"
                    >
                      Save ID
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="Client secret (optional)"
                      value={googleSecretInput}
                      onChange={(e) => setGoogleSecretInput(e.target.value)}
                      className="ps-input min-w-0 flex-1 px-3 py-2 font-mono text-xs"
                    />
                    <button
                      type="button"
                      disabled={!googleSecretInput.trim()}
                      onClick={() => {
                        void (async () => {
                          try {
                            setError(null);
                            await invoke("settings_save_api_key", {
                              provider: "google_client_secret",
                              apiKey: googleSecretInput,
                            });
                            setGoogleSecretInput("");
                            setGoogleMsg("Client secret saved (encrypted).");
                            await refreshSettings();
                          } catch (err) {
                            setError(String(err));
                          }
                        })();
                      }}
                      className="ps-btn-primary px-3 py-2"
                    >
                      Save secret
                    </button>
                  </div>
                  {settings?.googleClientId ? (
                    <button
                      type="button"
                      onClick={() => {
                        flushDebounce();
                        void (async () => {
                          try {
                            setError(null);
                            const next = await applySettingsPatch({ googleClientId: "" });
                            setSettings(next);
                            setGoogleMsg("Reverted to the built-in app client.");
                          } catch (err) {
                            setError(String(err));
                          }
                        })();
                      }}
                      className="ps-btn px-3 py-2"
                    >
                      Clear override — use built-in app
                    </button>
                  ) : null}
                </div>
              </details>

            <SettingsToggleCard
              id="google-gmail"
              title="Gmail"
              compact
              description="Email widget + gmail_search / gmail_read / gmail_create_draft tools. Reconnect after changing services so the OAuth scopes match."
              checked={settings?.googleGmailEnabled ?? true}
              onChange={(googleGmailEnabled) => {
                setSettings((s) => (s ? { ...s, googleGmailEnabled } : s));
                schedulePatch({ googleGmailEnabled });
              }}
            />
            <SettingsToggleCard
              id="google-calendar"
              title="Google Calendar"
              compact
              description="Calendar widget + calendar_list_events / calendar_create_event tools."
              checked={settings?.googleCalendarEnabled ?? true}
              onChange={(googleCalendarEnabled) => {
                setSettings((s) => (s ? { ...s, googleCalendarEnabled } : s));
                schedulePatch({ googleCalendarEnabled });
              }}
            />
            <SettingsToggleCard
              id="google-drive"
              title="Google Drive"
              compact
              description="Documents widget + drive_search / drive_read_document tools, and email attachments from Drive."
              checked={settings?.googleDriveEnabled ?? true}
              onChange={(googleDriveEnabled) => {
                setSettings((s) => (s ? { ...s, googleDriveEnabled } : s));
                schedulePatch({ googleDriveEnabled });
              }}
            />
            <SettingsToggleCard
              id="google-agent-tools"
              title="Companion agent tools"
              compact
              description="Lets your companion use Gmail, Calendar, Drive, Contacts, and Tasks during chat. Use account=agent for the designated agent mailbox (read + reply)."
              checked={settings?.googleAgentToolsEnabled ?? false}
              onChange={(googleAgentToolsEnabled) => {
                setSettings((s) => (s ? { ...s, googleAgentToolsEnabled } : s));
                schedulePatch({ googleAgentToolsEnabled });
              }}
            />
            {settings?.googleAgentToolsEnabled ? (
              <SettingsToggleCard
                id="google-agent-send"
                title="Allow the agent to send email directly"
                compact
                description="Off (recommended): the agent creates Gmail drafts you review and send. On: gmail_send is available and mail leaves your account without review."
                checked={settings?.googleAgentSendEnabled ?? false}
                onChange={(googleAgentSendEnabled) => {
                  setSettings((s) => (s ? { ...s, googleAgentSendEnabled } : s));
                  schedulePatch({ googleAgentSendEnabled });
                }}
              />
            ) : null}
          </>
        ) : null}
      </SettingsSection>
    </>
  );
}
