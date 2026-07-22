import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FileText, FolderOpen, Loader2, Plus, RefreshCw } from "lucide-react";

type ProjectMeta = {
  id: string;
  title: string;
  kind?: string;
  updatedAt?: string;
};

type View = { kind: "list" } | { kind: "doc"; id: string; title: string };

/** Collaborative projects — creation and browsing now live in Productivity mode.
 *  The companion still continues projects conversationally from chat. */
export function ProjectsWidget() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [doc, setDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<{ projects: ProjectMeta[]; activeProjectId?: string | null }>(
        "project_list",
      );
      setProjects(resp.projects ?? []);
      setActiveId(resp.activeProjectId?.trim() || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDoc = async (p: ProjectMeta) => {
    setView({ kind: "doc", id: p.id, title: p.title });
    setDoc(null);
    setError(null);
    try {
      const text = await invoke<string>("project_read_doc", { id: p.id });
      setDoc(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createProject = async () => {
    setCreating(true);
    setError(null);
    try {
      await invoke("project_create_direct", { title });
      setTitle("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const openFolder = async () => {
    try {
      await invoke("open_path", { path: "workspace/projects" });
    } catch (e) {
      setError(String(e));
    }
  };

  if (view.kind === "doc") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-ps-border px-3 py-2">
          <button type="button" className="ps-btn-ghost p-1" onClick={() => setView({ kind: "list" })} aria-label="Back to projects">
            <ArrowLeft className="size-3.5" aria-hidden />
          </button>
          <span className="min-w-0 truncate text-xs font-semibold text-ps-ink">{view.title}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? <p className="text-xs text-ps-danger">{error}</p> : null}
          {doc != null ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-ps-ink">{doc}</pre>
          ) : !error ? (
            <div className="flex items-center gap-2 text-xs text-ps-faint">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ps-border px-3 py-2">
        <span className="text-[11px] text-ps-faint">Living documents under workspace/projects</span>
        <div className="flex items-center gap-1">
          <button type="button" className="ps-btn-ghost p-1.5" onClick={() => void load()} title="Refresh" aria-label="Refresh projects">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
          <button type="button" className="ps-btn-ghost p-1.5" onClick={() => void openFolder()} title="Open projects folder" aria-label="Open projects folder">
            <FolderOpen className="size-3.5" aria-hidden />
          </button>
          <button type="button" className="ps-btn-ghost p-1.5" onClick={() => setAdding((v) => !v)} title="New project" aria-label="New project">
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {adding ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-ps-border bg-ps-elevated/60 p-3">
          <input
            className="ps-input min-w-0 flex-1 px-2.5 py-1.5 text-xs"
            placeholder="Project title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) void createProject();
            }}
          />
          <button type="button" className="ps-btn-primary" disabled={creating || !title.trim()} onClick={() => void createProject()}>
            {creating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            Create
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="px-3 py-2 text-xs text-ps-danger">{error}</p> : null}
        {projects.length === 0 && !loading && !error ? (
          <p className="px-3 py-4 text-xs leading-relaxed text-ps-faint">
            No projects yet. Create one here, then ask your companion to work on it from chat —
            it can read and update the project document with its tools.
          </p>
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void openDoc(p)}
                  className={`flex w-full items-center gap-2 border-b border-ps-border/40 border-l-2 px-3 py-2 text-left transition-colors hover:bg-ps-accent-soft ${
                    p.id === activeId ? "border-l-ps-accent" : "border-l-transparent"
                  }`}
                >
                  <FileText className="size-3.5 shrink-0 text-ps-warm" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ps-ink">{p.title}</p>
                    <p className="truncate text-[10px] text-ps-faint">
                      {p.kind || "document"}
                      {p.id === activeId ? " · active" : ""}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
