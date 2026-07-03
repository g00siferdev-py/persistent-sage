import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderGit2, FolderOpen, FolderPlus, GripVertical, Loader2, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { AppModeSwitcher } from "@/components/layout/AppModeSwitcher";
import { AppHelpButton } from "@/components/help/AppHelpButton";
import { DonateFooter } from "@/components/support/DonateFooter";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import {
  cycleSettingsLayoutMode,
  loadSettingsLayoutMode,
  saveSettingsLayoutMode,
  type SettingsLayoutMode,
} from "@/lib/settingsLayout";
import { CodingNotepad } from "@/components/coding/CodingNotepad";
import { TokenContextCounter } from "@/components/TokenContextCounter";
import { AgentActionStream } from "@/components/coding/AgentActionStream";
import { EventStreamDebugger } from "@/components/coding/EventStreamDebugger";
import { CodingChatMain } from "@/components/coding/CodingChatMain";
import { RepoFileTree, type RepoTreeNode, type TreeExpandCommand } from "@/components/coding/RepoFileTree";
import { CodeEditorPanel } from "@/components/coding/CodeEditorPanel";
import { CodingTerminalPanel } from "@/components/coding/CodingTerminalPanel";
import { CodingViewToolbar } from "@/components/coding/CodingViewToolbar";
import { CodingPlaygroundPanel } from "@/components/coding/CodingPlaygroundPanel";
import { useCodingChat } from "@/hooks/useCodingChat";
import { useCodingIde } from "@/hooks/useCodingIde";
import { appModeDescription, type AppMode } from "@/lib/appMode";
import type { ChatToolStreamEvent } from "@/types/toolStream";

type RepoMeta = {
  id: string;
  name: string;
  pathRel: string;
  remoteUrl?: string;
  createdAt: string;
  updatedAt: string;
};

type RepoListView = {
  repos: RepoMeta[];
  activeRepoId?: string;
  reposDirectory: string;
};

type Props = {
  activeConversationId: string | null;
  activeRepoId: string | null;
  onActiveConversationIdChange: (id: string | null) => void;
  onActiveRepoIdChange: (id: string | null) => void;
  onModeChange: (mode: AppMode) => void;
};

export function CodingLayout({
  activeConversationId,
  activeRepoId,
  onActiveConversationIdChange,
  onActiveRepoIdChange,
  onModeChange,
}: Props) {
  const [repoView, setRepoView] = useState<RepoListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [treeNodes, setTreeNodes] = useState<RepoTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTemplate, setNewProjectTemplate] = useState("empty");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandCommand, setExpandCommand] = useState<TreeExpandCommand | null>(null);
  const [expandVersion, setExpandVersion] = useState(0);

  // Collapsible right-side tool panels.
  const [streamPanelOpen, setStreamPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("persistent-sage:stream-panel-open") !== "false";
    } catch {
      return true;
    }
  });
  const [debuggerPanelOpen, setDebuggerPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("persistent-sage:debugger-panel-open") !== "false";
    } catch {
      return true;
    }
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 520;
    try {
      const saved = window.localStorage.getItem("persistent-sage:right-panel-width");
      return saved ? Math.max(180, parseInt(saved, 10)) : 520;
    } catch {
      return 520;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("persistent-sage:stream-panel-open", String(streamPanelOpen));
    } catch {
      /* ignore */
    }
  }, [streamPanelOpen]);
  useEffect(() => {
    try {
      window.localStorage.setItem("persistent-sage:debugger-panel-open", String(debuggerPanelOpen));
    } catch {
      /* ignore */
    }
  }, [debuggerPanelOpen]);
  useEffect(() => {
    try {
      window.localStorage.setItem("persistent-sage:right-panel-width", String(rightPanelWidth));
    } catch {
      /* ignore */
    }
  }, [rightPanelWidth]);

  const [notesOpen, setNotesOpen] = useState(false);
  const [settingsLayoutMode, setSettingsLayoutMode] = useState<SettingsLayoutMode>(() =>
    loadSettingsLayoutMode(),
  );

  const setSettingsLayout = useCallback((mode: SettingsLayoutMode) => {
    setSettingsLayoutMode(mode);
    saveSettingsLayoutMode(mode);
  }, []);

  const cycleSettingsLayout = useCallback(() => {
    setSettingsLayout(cycleSettingsLayoutMode(settingsLayoutMode));
  }, [settingsLayoutMode, setSettingsLayout]);

  const loadRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const view = await invoke<RepoListView>("coding_repo_list");
      setRepoView(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  // Sync active repo from lifted state when the repo list loads or external selection changes.
  useEffect(() => {
    if (!repoView) return;
    if (activeRepoId && repoView.activeRepoId !== activeRepoId) {
      void selectRepo(activeRepoId);
    }
  }, [activeRepoId, repoView?.repos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeRepo = useMemo(() => {
    if (!repoView?.repos.length) return null;
    const targetId = activeRepoId ?? repoView.activeRepoId;
    if (!targetId) return null;
    return repoView.repos.find((r) => r.id === targetId) ?? null;
  }, [activeRepoId, repoView]);

  const codingChat = useCodingChat({
    activeRepo,
    externalConversationId: activeConversationId,
    onConversationIdChange: onActiveConversationIdChange,
  });
  const codingIde = useCodingIde(activeRepo?.id ?? null);
  const prevSendingRef = useRef(false);

  const dirtyCount = useMemo(
    () => codingIde.openFiles.filter((f) => f.content !== f.savedContent).length,
    [codingIde.openFiles],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<ChatToolStreamEvent>("chat:tool-stream", (ev) => {
        const convId = codingChat.conversationId;
        if (convId && ev.payload.conversationId !== convId) return;
        if (ev.payload.toolName !== "coding_run_command") return;
        if (ev.payload.phase === "start") {
          const detail = ev.payload.detail.trim();
          codingIde.appendTerminal("command", detail || "Running command?");
        } else if (ev.payload.phase === "output" && ev.payload.delta) {
          codingIde.appendTerminal("output", ev.payload.delta);
        }
      });
    })();
    return () => unlisten?.();
  }, [codingChat.conversationId, codingIde.appendTerminal]);

  const loadTree = useCallback(async (repoId: string) => {
    setTreeLoading(true);
    try {
      const nodes = await invoke<RepoTreeNode[]>("coding_repo_tree", { repoId });
      setTreeNodes(nodes);
    } catch {
      setTreeNodes([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeRepo?.id) {
      void loadTree(activeRepo.id);
    } else {
      setTreeNodes([]);
    }
  }, [activeRepo?.id, loadTree]);

  useEffect(() => {
    if (prevSendingRef.current && !codingChat.sending && activeRepo?.id) {
      void loadTree(activeRepo.id);
      void codingIde.refreshCleanFiles();
    }
    prevSendingRef.current = codingChat.sending;
  }, [activeRepo?.id, codingChat.sending, codingIde.refreshCleanFiles, loadTree]);

  const selectRepo = useCallback(
    async (repoId: string) => {
      try {
        const view = await invoke<RepoListView>("coding_repo_set_active", { repoId });
        setRepoView(view);
        onActiveRepoIdChange(repoId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onActiveRepoIdChange],
  );

  const handleModeChange = useCallback(
    (mode: AppMode) => {
      if (mode === "companion") {
        // Keep the current conversation id; App.tsx persists it.
      }
      onModeChange(mode);
    },
    [onModeChange],
  );

  const revealReposFolder = useCallback(async () => {
    if (!repoView?.reposDirectory) return;
    try {
      await invoke("open_path", { path: repoView.reposDirectory });
    } catch {
      /* ignore */
    }
  }, [repoView?.reposDirectory]);

  const cloneRepo = useCallback(async () => {
    const url = cloneUrl.trim();
    if (!url) {
      setCloneError("Enter an HTTPS git URL.");
      return;
    }
    setCloning(true);
    setCloneError(null);
    try {
      const view = await invoke<RepoListView>("coding_repo_clone", {
        url,
        name: cloneName.trim() || null,
      });
      setRepoView(view);
      setCloneUrl("");
      setCloneName("");
    } catch (e) {
      setCloneError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  }, [cloneName, cloneUrl]);

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name) {
      setCreateError("Enter a project name.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const view = await invoke<RepoListView>("coding_repo_create", {
        name,
        template: newProjectTemplate,
      });
      setRepoView(view);
      setNewProjectName("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [newProjectName, newProjectTemplate]);

  const collapseTree = useCallback(() => {
    const version = expandVersion + 1;
    setExpandVersion(version);
    setExpandCommand({ version, open: false });
  }, [expandVersion]);

  const expandTree = useCallback(() => {
    const version = expandVersion + 1;
    setExpandVersion(version);
    setExpandCommand({ version, open: true });
  }, [expandVersion]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(Math.max(startWidth + delta, 180), 1200);
      setRightPanelWidth(newWidth);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightPanelWidth]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-200/55 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-none">
        <div className="flex min-w-0 items-center gap-3">
          <AppModeSwitcher mode="coding" onModeChange={handleModeChange} />
          <TokenContextCounter conversationId={activeConversationId} />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">Coding workspace</h1>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{appModeDescription("coding")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AppHelpButton />
          <button
            type="button"
            onClick={() => void cycleSettingsLayout()}
            aria-expanded={settingsLayoutMode !== "hidden"}
            aria-controls="nova-settings-panel"
            title={`Settings: ${settingsLayoutMode === "hidden" ? "Hidden" : settingsLayoutMode === "compact" ? "Compact" : "Full"} ? click to cycle`}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Settings
          </button>
          <button
            type="button"
            onClick={() => void loadRepos()}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
            title="Rescan workspace/repos for new folders"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void revealReposFolder()}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
            title="Open workspace/repos in file explorer"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            Open repos folder
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden bg-slate-200/55 p-2 dark:bg-slate-950 dark:p-0">
        <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto dark:bg-slate-900/40">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-none">
            <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                Repositories
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-600 dark:text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading?
              </div>
            ) : error ? (
              <p className="px-2 py-3 text-xs text-red-600 dark:text-red-300">{error}</p>
            ) : repoView && repoView.repos.length > 0 ? (
              <ul className="space-y-1">
                {repoView.repos.map((repo) => (
                  <li key={repo.id}>
                    <button
                      type="button"
                      onClick={() => void selectRepo(repo.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                        repoView.activeRepoId === repo.id
                          ? "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100"
                          : "text-slate-700 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{repo.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                No git repos yet. Create a new project below, clone one, or copy a repository into{" "}
                <span className="font-mono text-slate-700 dark:text-slate-300">workspace/repos/</span>, then click Refresh.
              </p>
            )}
          </div>
          </div>
          <CodingNotepad open={notesOpen} onToggle={() => setNotesOpen((v) => !v)} />
          <div className="shrink-0 space-y-0 rounded-lg border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-none">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
              New project
            </p>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                disabled={creating}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-violet-600"
              />
              <select
                value={newProjectTemplate}
                onChange={(e) => setNewProjectTemplate(e.target.value)}
                disabled={creating}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:focus:border-violet-600"
              >
                <option value="empty">Empty (README + .gitignore)</option>
                <option value="rust">Rust (cargo init)</option>
                <option value="node">Node.js (package.json)</option>
                <option value="python">Python (pyproject.toml + src layout)</option>
                <option value="tauri">Tauri (React + Rust ? requires npm)</option>
                <option value="csharp">C# (.NET console ? requires SDK)</option>
              </select>
              <p className="px-1 text-[10px] leading-relaxed text-slate-500">
                Tauri and C# templates need npm or the .NET SDK installed on this machine.
              </p>
              {createError ? <p className="px-1 text-[10px] text-red-300">{createError}</p> : null}
              <button
                type="button"
                onClick={() => void createProject()}
                disabled={creating || !newProjectName.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-800 px-2 py-1.5 text-xs font-medium text-emerald-50 hover:bg-emerald-700 disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden />
                )}
                {creating ? "Creating?" : "Create project"}
              </button>
            </div>
          </div>
          <div className="shrink-0 space-y-0 rounded-lg border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-none">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
              Clone repository
            </p>
            <div className="space-y-2">
              <input
                type="url"
                placeholder="https://github.com/owner/repo.git"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                disabled={cloning}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-violet-600"
              />
              <input
                type="text"
                placeholder="Folder name (optional)"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                disabled={cloning}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-violet-600"
              />
              {cloneError ? <p className="px-1 text-[10px] text-red-600 dark:text-red-300">{cloneError}</p> : null}
              <button
                type="button"
                onClick={() => void cloneRepo()}
                disabled={cloning || !cloneUrl.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-violet-700 px-2 py-1.5 text-xs font-medium text-violet-50 hover:bg-violet-600 disabled:opacity-50"
              >
                {cloning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                )}
                {cloning ? "Cloning?" : "Clone"}
              </button>
              <p className="px-1 text-[10px] leading-relaxed text-slate-500">
                Requires a GitHub PAT in Settings ? Tools ? GitHub.
              </p>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:shadow-none">
          {activeRepo ? (
            <>
              <CodingViewToolbar
                viewMode={codingIde.viewMode}
                onChange={codingIde.setViewMode}
                dirtyCount={dirtyCount}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {codingIde.viewMode === "playground" ? (
                  <CodingPlaygroundPanel />
                ) : (
                  <>
                    {codingIde.viewMode !== "chat" ? (
                      <div
                        className={
                          codingIde.viewMode === "split"
                            ? "flex min-h-0 flex-1 flex-col"
                            : "flex min-h-0 flex-[2] flex-col"
                        }
                      >
                        <CodeEditorPanel
                          repoPathRel={activeRepo.pathRel}
                          files={codingIde.openFiles}
                          activePath={codingIde.activePath}
                          activeDirty={codingIde.activeDirty}
                          onSelect={codingIde.setActivePath}
                          onClose={codingIde.closeFile}
                          onChange={codingIde.updateActiveContent}
                          onSave={() => void codingIde.saveActive()}
                          onRevert={codingIde.revertActive}
                        />
                      </div>
                    ) : null}
                    {codingIde.viewMode !== "editor" ? (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        <CodingChatMain
                          repoName={activeRepo.name}
                          messages={codingChat.messages}
                          loading={codingChat.loading}
                          sending={codingChat.sending}
                          streamAssistant={codingChat.streamAssistant}
                          error={codingChat.error}
                          onSendMessage={(text) => void codingChat.sendMessage(text)}
                          onAbortTurn={codingChat.abortTurn}
                        />
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <CodingTerminalPanel
                lines={codingIde.terminalLines}
                open={codingIde.terminalOpen}
                height={codingIde.terminalHeight}
                running={codingIde.shellRunning}
                onToggleOpen={() => codingIde.setTerminalOpen((v) => !v)}
                onClear={codingIde.clearTerminal}
                onRun={(cmd) => void codingIde.runShell(cmd)}
                onHeightChange={codingIde.setTerminalHeight}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <p className="max-w-md text-sm text-slate-400">
                Select a repository from the sidebar to start a coding session.
              </p>
            </div>
          )}
        </main>

        {/* Resizable right-side panel stack with independent toggles */}
        <aside
          className="relative flex h-full shrink-0 flex-col border-l border-slate-200 bg-slate-100/80 dark:border-slate-800 dark:bg-slate-900/40"
          style={{ width: rightPanelWidth }}
        >
          {/* Resize handle */}
          <div
            className="absolute left-0 top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center hover:bg-violet-500/10 active:bg-violet-500/20"
            onMouseDown={startResize}
            title="Drag to resize side panel"
          >
            <GripVertical className="size-3 text-slate-600" aria-hidden />
          </div>

          {/* Panel toggle header */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-2 py-1.5 pl-4 dark:border-slate-800">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStreamPanelOpen((v) => !v)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${streamPanelOpen ? "bg-violet-100 text-violet-800 dark:bg-violet-700/40 dark:text-violet-200" : "text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"}`}
                title="Toggle stream panel"
              >
                Stream
              </button>
              <button
                type="button"
                onClick={() => setDebuggerPanelOpen((v) => !v)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${debuggerPanelOpen ? "bg-violet-100 text-violet-800 dark:bg-violet-700/40 dark:text-violet-200" : "text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300"}`}
                title="Toggle debugger panel"
              >
                Debugger
              </button>
            </div>
            {streamPanelOpen || debuggerPanelOpen ? (
              <button
                type="button"
                onClick={() => {
                  setStreamPanelOpen(false);
                  setDebuggerPanelOpen(false);
                }}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                title="Hide all side panels"
              >
                <PanelLeftClose className="size-3.5" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setStreamPanelOpen(true);
                  setDebuggerPanelOpen(true);
                }}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                title="Show all side panels"
              >
                <PanelLeftOpen className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          {streamPanelOpen ? (
            <div className="flex min-h-0 flex-[2] flex-col">
              <AgentActionStream repoId={activeRepo?.id} />
            </div>
          ) : null}
          {debuggerPanelOpen ? (
            <div className={`flex min-h-0 flex-1 flex-col border-t border-slate-800 ${!streamPanelOpen ? "flex-[2]" : ""}`}>
              <EventStreamDebugger repoId={activeRepo?.id} />
            </div>
          ) : null}
        </aside>
        <aside className="flex w-56 shrink-0 flex-col rounded-lg border border-slate-300 bg-slate-100 shadow-sm dark:border-slate-700 dark:bg-slate-900/40 dark:shadow-none lg:w-64">
          <div className="flex items-center justify-between gap-2 border-b border-slate-300 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Files</h2>
            {activeRepo ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={collapseTree}
                  className="rounded px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  title="Collapse all folders"
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  onClick={expandTree}
                  className="rounded px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  title="Expand all folders"
                >
                  Expand all
                </button>
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950/30">
            {activeRepo ? (
              <RepoFileTree
                nodes={treeNodes}
                loading={treeLoading}
                expandCommand={expandCommand}
                selectedPath={codingIde.activePath}
                onOpenFile={(path) => void codingIde.openFile(path)}
              />
            ) : (
              <p className="px-3 py-4 text-xs leading-relaxed text-slate-500">
                Select a repo to browse its file tree.
              </p>
            )}
          </div>
        </aside>
        <SettingsPanel
          layoutMode={settingsLayoutMode}
          onLayoutModeChange={setSettingsLayout}
        />
      </div>
      <DonateFooter />
    </div>
  );
}
