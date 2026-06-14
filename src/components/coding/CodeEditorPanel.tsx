import { useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, Loader2, RotateCcw, Save, X } from "lucide-react";
import type { OpenEditorFile } from "@/hooks/useCodingIde";

type Props = {
  repoPathRel: string;
  files: OpenEditorFile[];
  activePath: string | null;
  activeDirty: boolean;
  onSelect: (pathRel: string) => void;
  onClose: (pathRel: string) => void;
  onChange: (content: string) => void;
  onSave: () => void;
  onRevert: () => void;
};

function fileName(pathRel: string): string {
  const i = pathRel.lastIndexOf("/");
  return i >= 0 ? pathRel.slice(i + 1) : pathRel;
}

export function CodeEditorPanel({
  repoPathRel,
  files,
  activePath,
  activeDirty,
  onSelect,
  onClose,
  onChange,
  onSave,
  onRevert,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const active = files.find((f) => f.pathRel === activePath) ?? null;

  const lineCount = useMemo(() => {
    if (!active) return 1;
    return Math.max(1, active.content.split("\n").length);
  }, [active?.content]);

  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount],
  );

  const openExternal = useCallback(async () => {
    if (!active) return;
    const abs = `${repoPathRel}/${active.pathRel}`.replace(/\\/g, "/");
    try {
      await invoke("open_path", { path: abs });
    } catch {
      /* ignore */
    }
  }, [active, repoPathRel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  if (files.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center border-b border-slate-800 bg-slate-950/40 px-6 text-center">
        <p className="max-w-sm text-sm text-slate-500">
          Select a file in the tree to open it here. Edit and save with{" "}
          <kbd className="rounded border border-slate-700 px-1 font-mono text-[10px]">Ctrl+S</kbd>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-slate-800 bg-slate-950/60">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900/80 px-1 py-0.5">
        {files.map((f) => {
          const dirty = f.content !== f.savedContent;
          const isActive = f.pathRel === activePath;
          return (
            <div
              key={f.pathRel}
              className={`flex max-w-[12rem] shrink-0 items-center gap-1 rounded-t px-2 py-1 text-[11px] ${
                isActive
                  ? "bg-slate-950 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
              }`}
            >
              <button
                type="button"
                className="min-w-0 truncate"
                onClick={() => onSelect(f.pathRel)}
                title={f.pathRel}
              >
                {fileName(f.pathRel)}
                {dirty ? " •" : ""}
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 hover:bg-slate-700"
                onClick={() => onClose(f.pathRel)}
                title="Close"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center gap-1 pr-1">
          <button
            type="button"
            disabled={!activeDirty || active?.loading}
            onClick={onRevert}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            title="Revert changes"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            disabled={!activeDirty || active?.loading}
            onClick={onSave}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            title="Save (Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            disabled={!active}
            onClick={() => void openExternal()}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
            title="Open in external editor"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {active?.loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading {active.pathRel}…
        </div>
      ) : active?.error ? (
        <div className="flex-1 overflow-auto p-4 text-xs text-red-300">{active.error}</div>
      ) : active ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            className="shrink-0 select-none overflow-hidden border-r border-slate-800 bg-slate-900/50 py-2 pr-2 text-right font-mono text-[11px] leading-[1.45rem] text-slate-600"
            aria-hidden
          >
            {lineNumbers.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={active.content}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="min-h-0 w-full flex-1 resize-none bg-transparent py-2 pl-2 font-mono text-[12px] leading-[1.45rem] text-slate-100 outline-none"
            data-language={active.language}
          />
        </div>
      ) : null}
    </div>
  );
}
