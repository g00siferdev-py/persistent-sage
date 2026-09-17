import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  applyRepoFileRefresh,
  canSaveEditorFile,
  dirtyBuffersToStash,
  shouldApplyAsyncEditorResult,
  type StashedRepoBuffers,
} from "@/lib/codingEditorRepoGuard";

export type OpenEditorFile = {
  pathRel: string;
  content: string;
  savedContent: string;
  language: string;
  repoId: string;
  loading?: boolean;
  error?: string | null;
};

export type TerminalLine = {
  id: string;
  kind: "command" | "output" | "error" | "info";
  text: string;
};

type CodingFileView = {
  pathRel: string;
  content: string;
  sizeBytes: number;
  language: string;
};

type CodingShellResult = {
  output: string;
  elapsedSecs: number;
};

export type CodingViewMode = "split" | "editor" | "chat" | "playground";

const VIEW_MODE_KEY = "ps-coding-view-mode";
const TERMINAL_HEIGHT_KEY = "ps-coding-terminal-height";

function loadViewMode(): CodingViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === "editor" || v === "chat" || v === "split" || v === "playground") return v;
  } catch {
    /* ignore */
  }
  return "split";
}

function loadTerminalHeight(): number {
  try {
    const n = Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
    if (Number.isFinite(n) && n >= 120 && n <= 480) return n;
  } catch {
    /* ignore */
  }
  return 200;
}

export function useCodingIde(activeRepoId: string | null) {
  const [viewMode, setViewModeState] = useState<CodingViewMode>(loadViewMode);
  const [openFiles, setOpenFiles] = useState<OpenEditorFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(loadTerminalHeight);
  const [shellRunning, setShellRunning] = useState(false);
  const openSeq = useRef(0);
  const activeRepoIdRef = useRef(activeRepoId);
  const openFilesRef = useRef<OpenEditorFile[]>([]);
  const activePathRef = useRef<string | null>(null);
  const buffersByRepo = useRef<Map<string, StashedRepoBuffers<OpenEditorFile>>>(new Map());
  const prevRepoIdRef = useRef<string | null>(null);

  activeRepoIdRef.current = activeRepoId;
  openFilesRef.current = openFiles;
  activePathRef.current = activePath;

  const setViewMode = useCallback((mode: CodingViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const setTerminalHeightPersisted = useCallback((h: number) => {
    const clamped = Math.min(480, Math.max(120, h));
    setTerminalHeight(clamped);
    try {
      localStorage.setItem(TERMINAL_HEIGHT_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const prev = prevRepoIdRef.current;
    openSeq.current += 1;

    if (prev && prev !== activeRepoId) {
      const stash = dirtyBuffersToStash(openFilesRef.current, activePathRef.current);
      if (stash) buffersByRepo.current.set(prev, stash);
      else buffersByRepo.current.delete(prev);
    }

    prevRepoIdRef.current = activeRepoId;

    if (activeRepoId) {
      const restored = buffersByRepo.current.get(activeRepoId);
      if (restored) {
        setOpenFiles(restored.files);
        setActivePath(restored.activePath);
        return;
      }
    }
    setOpenFiles([]);
    setActivePath(null);
  }, [activeRepoId]);

  const appendTerminal = useCallback((kind: TerminalLine["kind"], text: string) => {
    const trimmed = text.trimEnd();
    if (!trimmed) return;
    setTerminalLines((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, kind, text: trimmed },
    ]);
  }, []);

  const clearTerminal = useCallback(() => setTerminalLines([]), []);

  const openFile = useCallback(
    async (pathRel: string) => {
      if (!activeRepoId) return;
      const repoId = activeRepoId;
      const path = pathRel.trim();
      if (!path) return;

      setOpenFiles((prev) => {
        if (prev.some((f) => f.pathRel === path && f.repoId === repoId)) return prev;
        return [
          ...prev,
          {
            pathRel: path,
            content: "",
            savedContent: "",
            language: "plaintext",
            repoId,
            loading: true,
            error: null,
          },
        ];
      });
      setActivePath(path);

      const seq = ++openSeq.current;
      try {
        const file = await invoke<CodingFileView>("coding_read_file", {
          repoId,
          pathRel: path,
        });
        if (
          !shouldApplyAsyncEditorResult({
            startedSeq: seq,
            currentSeq: openSeq.current,
            startedRepoId: repoId,
            currentRepoId: activeRepoIdRef.current,
          })
        ) {
          return;
        }
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.pathRel === path && f.repoId === repoId
              ? {
                  pathRel: file.pathRel,
                  content: file.content,
                  savedContent: file.content,
                  language: file.language,
                  repoId,
                  loading: false,
                  error: null,
                }
              : f,
          ),
        );
      } catch (e) {
        if (
          !shouldApplyAsyncEditorResult({
            startedSeq: seq,
            currentSeq: openSeq.current,
            startedRepoId: repoId,
            currentRepoId: activeRepoIdRef.current,
          })
        ) {
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.pathRel === path && f.repoId === repoId ? { ...f, loading: false, error: msg } : f,
          ),
        );
      }
    },
    [activeRepoId],
  );

  const closeFile = useCallback(
    (pathRel: string) => {
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.pathRel !== pathRel);
        setActivePath((cur) => {
          if (cur !== pathRel) return cur;
          return next.length > 0 ? next[next.length - 1].pathRel : null;
        });
        return next;
      });
    },
    [],
  );

  const updateActiveContent = useCallback(
    (content: string) => {
      if (!activePath) return;
      setOpenFiles((prev) =>
        prev.map((f) => (f.pathRel === activePath ? { ...f, content } : f)),
      );
    },
    [activePath],
  );

  const saveActive = useCallback(async () => {
    if (!activeRepoId || !activePath) return false;
    const file = openFiles.find((f) => f.pathRel === activePath);
    if (!file || !canSaveEditorFile(file, activeRepoId)) return false;
    const repoId = file.repoId;
    const pathRel = file.pathRel;
    const content = file.content;
    try {
      await invoke("coding_write_file", {
        repoId,
        pathRel,
        content,
      });
      if (activeRepoIdRef.current !== repoId) return true;
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.pathRel === pathRel && f.repoId === repoId ? { ...f, savedContent: f.content } : f,
        ),
      );
      appendTerminal("info", `Saved ${pathRel}`);
      return true;
    } catch (e) {
      appendTerminal("error", e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [activePath, activeRepoId, appendTerminal, openFiles]);

  const revertActive = useCallback(() => {
    if (!activePath) return;
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.pathRel === activePath ? { ...f, content: f.savedContent } : f,
      ),
    );
  }, [activePath]);

  const runShell = useCallback(
    async (command: string, cwd?: string) => {
      if (!activeRepoId) return;
      const cmd = command.trim();
      if (!cmd) return;
      setShellRunning(true);
      appendTerminal("command", cwd ? `$ (${cwd}) ${cmd}` : `$ ${cmd}`);
      try {
        const result = await invoke<CodingShellResult>("coding_run_shell", {
          repoId: activeRepoId,
          command: cmd,
          cwd: cwd?.trim() || null,
        });
        appendTerminal("output", `${result.output}\n(${result.elapsedSecs.toFixed(1)}s)`);
      } catch (e) {
        appendTerminal("error", e instanceof Error ? e.message : String(e));
      } finally {
        setShellRunning(false);
      }
    },
    [activeRepoId, appendTerminal],
  );

  const refreshCleanFiles = useCallback(async () => {
    if (!activeRepoId) return;
    const repoId = activeRepoId;
    const seq = openSeq.current;
    const toRefresh = openFiles.filter(
      (f) => f.repoId === repoId && f.content === f.savedContent && !f.loading,
    );
    for (const f of toRefresh) {
      if (
        !shouldApplyAsyncEditorResult({
          startedSeq: seq,
          currentSeq: openSeq.current,
          startedRepoId: repoId,
          currentRepoId: activeRepoIdRef.current,
        })
      ) {
        return;
      }
      try {
        const file = await invoke<CodingFileView>("coding_read_file", {
          repoId,
          pathRel: f.pathRel,
        });
        if (
          !shouldApplyAsyncEditorResult({
            startedSeq: seq,
            currentSeq: openSeq.current,
            startedRepoId: repoId,
            currentRepoId: activeRepoIdRef.current,
          })
        ) {
          return;
        }
        setOpenFiles((prev) =>
          applyRepoFileRefresh(prev, {
            pathRel: f.pathRel,
            content: file.content,
            language: file.language,
            repoId,
          }),
        );
      } catch {
        /* ignore stale paths */
      }
    }
  }, [activeRepoId, openFiles]);

  const activeFile = openFiles.find((f) => f.pathRel === activePath) ?? null;
  const activeDirty =
    activeFile != null && activeFile.content !== activeFile.savedContent;

  return {
    viewMode,
    setViewMode,
    openFiles,
    activePath,
    activeFile,
    activeDirty,
    openFile,
    closeFile,
    setActivePath,
    updateActiveContent,
    saveActive,
    revertActive,
    terminalLines,
    terminalOpen,
    setTerminalOpen,
    terminalHeight,
    setTerminalHeight: setTerminalHeightPersisted,
    appendTerminal,
    clearTerminal,
    runShell,
    shellRunning,
    refreshCleanFiles,
  };
}
