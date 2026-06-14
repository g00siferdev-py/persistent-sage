import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, Loader2, Terminal, Trash2 } from "lucide-react";
import type { TerminalLine } from "@/hooks/useCodingIde";

type Props = {
  lines: TerminalLine[];
  open: boolean;
  height: number;
  running: boolean;
  onToggleOpen: () => void;
  onClear: () => void;
  onRun: (command: string) => void;
  onHeightChange?: (height: number) => void;
};

export function CodingTerminalPanel({
  lines,
  open,
  height,
  running,
  onToggleOpen,
  onClear,
  onRun,
  onHeightChange,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onHeightChange || !open) return;
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !onHeightChange) return;
    const delta = dragRef.current.startY - e.clientY;
    onHeightChange(dragRef.current.startHeight + delta);
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cmd = draft.trim();
    if (!cmd || running) return;
    setDraft("");
    onRun(cmd);
  };

  return (
    <div
      ref={panelRef}
      className="relative flex shrink-0 flex-col border-t border-slate-800 bg-slate-950"
      style={open ? { height } : undefined}
    >
      {open && onHeightChange ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize touch-none"
        />
      ) : null}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
        >
          <Terminal className="h-3.5 w-3.5" aria-hidden />
          Terminal
          {open ? (
            <ChevronDown className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronUp className="h-3 w-3" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          title="Clear terminal"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {open ? (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
          >
            {lines.length === 0 ? (
              <p className="text-slate-600">
                Run allowlisted commands here (cargo, npm, git, python, …). Enable shell in
                Settings → Tools → Coding mode.
              </p>
            ) : (
              lines.map((line) => (
                <div
                  key={line.id}
                  className={
                    line.kind === "command"
                      ? "text-emerald-400/90"
                      : line.kind === "error"
                        ? "text-red-300"
                        : line.kind === "info"
                          ? "text-slate-500"
                          : "whitespace-pre-wrap text-slate-300"
                  }
                >
                  {line.text}
                </div>
              ))
            )}
          </div>
          <form onSubmit={submit} className="flex shrink-0 gap-2 border-t border-slate-800 p-2">
            <span className="flex items-center font-mono text-xs text-emerald-500/80">$</span>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={running}
              placeholder="Type a command…"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-violet-600"
            />
            <button
              type="submit"
              disabled={running || !draft.trim()}
              className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Run"}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
