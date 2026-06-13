import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderGit2, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { AppModeSwitcher } from "@/components/layout/AppModeSwitcher";
import { CodingChatMain } from "@/components/coding/CodingChatMain";
import { RepoFileTree, type RepoTreeNode } from "@/components/coding/RepoFileTree";
import { useCodingChat } from "@/hooks/useCodingChat";
import { appModeDescription, type AppMode } from "@/lib/appMode";

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
  onModeChange: (mode: AppMode) => void;
};

export function CodingLayout({ onModeChange }: Props) {
  const [repoView, setRepoView] = useState<RepoListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [treeNodes, setTreeNodes] = useState<RepoTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

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

  const activeRepo = useMemo(
    () => repoView?.repos.find((r) => r.id === repoView.activeRepoId) ?? null,
    [repoView],
  );

  const codingChat = useCodingChat(activeRepo);

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

  const selectRepo = useCallback(async (repoId: string) => {
    try {
      const view = await invoke<RepoListView>("coding_repo_set_active", { repoId });
      setRepoView(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const revealReposFolder = useCallback(async () => {
    if (!repoView?.reposDirectory) return;
    try {
      await invoke("open_path", { path: repoView.reposDirectory });
    } catch {
      /* ignore */
    }
  }, [repoView?.reposDirectory]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <AppModeSwitcher mode="coding" onModeChange={onModeChange} />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-100">Coding workspace</h1>
            <p className="truncate text-[11px] text-slate-400">{appModeDescription("coding")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void loadRepos()}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            title="Rescan workspace/repos for new folders"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void revealReposFolder()}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            title="Open workspace/repos in file explorer"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            Open repos folder
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40">
          <div className="border-b border-slate-800 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Repositories</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading…
              </div>
            ) : error ? (
              <p className="px-2 py-3 text-xs text-red-300">{error}</p>
            ) : repoView && repoView.repos.length > 0 ? (
              <ul className="space-y-1">
                {repoView.repos.map((repo) => (
                  <li key={repo.id}>
                    <button
                      type="button"
                      onClick={() => void selectRepo(repo.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                        repoView.activeRepoId === repo.id
                          ? "bg-violet-900/50 text-violet-100"
                          : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{repo.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-3 text-xs leading-relaxed text-slate-400">
                No git repos found. Clone or copy a repository into{" "}
                <span className="font-mono text-slate-300">workspace/repos/</span>, then click
                Refresh.
              </p>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col border-r border-slate-800">
          {activeRepo ? (
            <CodingChatMain
              repoName={activeRepo.name}
              messages={codingChat.messages}
              loading={codingChat.loading}
              sending={codingChat.sending}
              streamAssistant={codingChat.streamAssistant}
              error={codingChat.error}
              onSendMessage={(text) => void codingChat.sendMessage(text)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <p className="max-w-md text-sm text-slate-400">
                Select a repository from the sidebar to start a coding session.
              </p>
            </div>
          )}
        </main>

        <aside className="flex w-56 shrink-0 flex-col bg-slate-900/40 lg:w-64">
          <div className="border-b border-slate-800 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Files</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeRepo ? (
              <RepoFileTree nodes={treeNodes} loading={treeLoading} />
            ) : (
              <p className="px-3 py-4 text-xs leading-relaxed text-slate-500">
                Select a repo to browse its file tree.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
