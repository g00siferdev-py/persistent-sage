import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type OpenEditorFile = {
  pathRel: string;
  content: string;
  savedContent: string;
  language: string;
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

export type CodingViewMode = "split" | "editor" | "chat";

const VIEW_MODE_KEY = "ps-coding-view-mode";
const TERMINAL_HEIGHT_KEY = "ps-coding-terminal-height";

function loadViewMode(): CodingViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === "editor" || v === "chat" || v === "split") return v;
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
      const path = pathRel.trim();
      if (!path) return;

      setOpenFiles((prev) => {
        if (prev.some((f) => f.pathRel === path)) return prev;
        return [
          ...prev,
          {
            pathRel: path,
            content: "",
            savedContent: "",
            language: "plaintext",
            loading: true,
            error: null,
          },
        ];
      });
      setActivePath(path);

      const seq = ++openSeq.current;
      try {
        const file = await invoke<CodingFileView>("coding_read_file", {
          repoId: activeRepoId,
          pathRel: path,
        });
        if (seq !== openSeq.current) return;
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.pathRel === path
              ? {
                  pathRel: file.pathRel,
                  content: file.content,
                  savedContent: file.content,
                  language: file.language,
                  loading: false,
                  error: null,
                }
              : f,
          ),
        );
      } catch (e) {
        if (seq !== openSeq.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.pathRel === path ? { ...f, loading: false, error: msg } : f,
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
    if (!file || file.loading || file.error) return false;
    try {
      await invoke("coding_write_file", {
        repoId: activeRepoId,
        pathRel: file.pathRel,
        content: file.content,
      });
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.pathRel === file.pathRel ? { ...f, savedContent: f.content } : f,
        ),
      );
      appendTerminal("info", `Saved ${file.pathRel}`);
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
    const toRefresh = openFiles.filter((f) => f.content === f.savedContent && !f.loading);
    for (const f of toRefresh) {
      try {
        const file = await invoke<CodingFileView>("coding_read_file", {
          repoId: activeRepoId,
          pathRel: f.pathRel,
        });
        setOpenFiles((prev) =>
          prev.map((x) =>
            x.pathRel === f.pathRel
              ? {
                  ...x,
                  content: file.content,
                  savedContent: file.content,
                  language: file.language,
                }
              : x,
          ),
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
