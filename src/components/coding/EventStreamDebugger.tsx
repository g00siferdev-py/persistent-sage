import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Activity, Bug, CheckCircle2, Copy, Loader2, Play, Trash2, XCircle } from "lucide-react";

type StreamKind =
  | "tool:start"
  | "tool:end"
  | "generation_step:start"
  | "generation_step:end"
  | "tool:status"
  | "synthetic";

type DebugEvent = {
  id: string;
  streamId?: string;
  kind: StreamKind;
  frontendTimestamp: number;
  backendTimestamp?: number;
  generationNumber?: number;
  mission?: string;
  toolKind?: string;
  toolName?: string;
  label?: string;
  input?: unknown;
  success?: boolean;
  output?: string;
  summary?: string;
  status?: string;
  detail?: string;
  payload: unknown;
};

type Props = {
  repoId?: string | null;
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortId(id?: string) {
  if (!id) return "—";
  const parts = id.split("-");
  if (parts.length > 2) return `${parts.slice(0, 2).join("-")}…`;
  return id.length > 16 ? `${id.slice(0, 14)}…` : id;
}

export function EventStreamDebugger({ repoId: _repoId }: Props) {
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [selected, setSelected] = useState<DebugEvent | null>(null);
  const [copyHint, setCopyHint] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const attachedRef = useRef(false);

  useEffect(() => {
    if (attachedRef.current) return;
    attachedRef.current = true;

    let unlistenStart: UnlistenFn | undefined;
    let unlistenEnd: UnlistenFn | undefined;
    let unlistenToolStart: UnlistenFn | undefined;
    let unlistenToolEnd: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;

    const attach = async () => {
      await invoke("agent_stream_replay_recent");

      unlistenStart = await listen<{
        id: string;
        generationNumber?: number;
        mission: string;
      }>("generation_step:start", (e) => {
        setEvents((prev) => [
          ...prev,
          {
            id: e.payload.id,
            kind: "generation_step:start",
            frontendTimestamp: Date.now(),
            generationNumber: e.payload.generationNumber,
            mission: e.payload.mission,
            payload: e.payload,
          },
        ]);
      });

      unlistenEnd = await listen<{
        id: string;
        success: boolean;
        summary: string;
        generationNumber?: number;
        commitSha?: string;
      }>("generation_step:end", (e) => {
        setEvents((prev) => [
          ...prev,
          {
            id: e.payload.id,
            kind: "generation_step:end",
            frontendTimestamp: Date.now(),
            generationNumber: e.payload.generationNumber,
            success: e.payload.success,
            summary: e.payload.summary,
            payload: e.payload,
          },
        ]);
      });

      unlistenToolStart = await listen<{
        streamId: string;
        toolKind: string;
        label: string;
        input?: unknown;
      }>("tool:start", (e) => {
        setEvents((prev) => {
          if (prev.some((x) => x.streamId === e.payload.streamId && x.kind === "tool:start")) {
            return prev;
          }
          return [
            ...prev,
            {
              id: e.payload.streamId,
              streamId: e.payload.streamId,
              kind: "tool:start",
              frontendTimestamp: Date.now(),
              toolKind: e.payload.toolKind,
              label: e.payload.label,
              input: e.payload.input,
              payload: e.payload,
            },
          ];
        });
      });

      unlistenToolEnd = await listen<{
        streamId: string;
        toolKind: string;
        toolName: string;
        label: string;
        success: boolean;
        output: string;
      }>("tool:end", (e) => {
        setEvents((prev) => {
          const idx = prev.findIndex((x) => x.streamId === e.payload.streamId && x.kind === "tool:start");
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              kind: "tool:end",
              toolName: e.payload.toolName,
              label: e.payload.label,
              success: e.payload.success,
              output: e.payload.output,
              payload: e.payload,
            };
            return next;
          }
          // orphan end event — show separately
          return [
            ...prev,
            {
              id: e.payload.streamId,
              streamId: e.payload.streamId,
              kind: "tool:end",
              frontendTimestamp: Date.now(),
              toolKind: e.payload.toolKind,
              toolName: e.payload.toolName,
              label: e.payload.label,
              success: e.payload.success,
              output: e.payload.output,
              payload: e.payload,
            },
          ];
        });
      });

      unlistenStatus = await listen<{
        streamId: string;
        status: string;
        detail?: string;
      }>("tool:status", (e) => {
        setEvents((prev) => {
          const idx = prev.findIndex((x) => x.streamId === e.payload.streamId && x.kind === "tool:start");
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], status: e.payload.status, detail: e.payload.detail, payload: e.payload };
            return next;
          }
          return [
            ...prev,
            {
              id: `${e.payload.streamId}-status-${Date.now()}`,
              streamId: e.payload.streamId,
              kind: "tool:status",
              frontendTimestamp: Date.now(),
              status: e.payload.status,
              detail: e.payload.detail,
              payload: e.payload,
            },
          ];
        });
      });
    };

    void attach();

    return () => {
      unlistenStart?.();
      unlistenEnd?.();
      unlistenToolStart?.();
      unlistenToolEnd?.();
      unlistenStatus?.();
    };
  }, []);

  useEffect(() => {
    if (!collapsed && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, [events, collapsed]);

  const handleClear = () => {
    setEvents([]);
    setSelected(null);
  };

  const handleSaveSnapshot = async () => {
    try {
      const snapshot = await invoke<string>("agent_stream_snapshot");
      await navigator.clipboard.writeText(snapshot);
      setCopyHint(true);
      setTimeout(() => setCopyHint(false), 1500);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to snapshot stream", e);
    }
  };

  const handleEmitSynthetic = async () => {
    try {
      await invoke("agent_stream_emit_synthetic", { label: "manual test" });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Failed to emit synthetic event", e);
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex h-full w-8 shrink-0 flex-col items-center justify-start gap-1 border-l border-slate-800 bg-slate-900/60 py-2 text-[10px] uppercase tracking-wide text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        title="Open Event Stream Debugger"
      >
        <Bug className="h-4 w-4" />
        <span className="rotate-180" style={{ writingMode: "vertical-rl" }}>
          Debug
        </span>
      </button>
    );
  }

  const kindBadge = (kind: StreamKind, toolKind?: string) => {
    switch (kind) {
      case "generation_step:start":
        return (
          <span className="flex items-center gap-1 rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-200">
            <Loader2 className="h-3 w-3 animate-spin" />
            gen:start
          </span>
        );
      case "generation_step:end":
        return (
          <span className="flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            gen:end
          </span>
        );
      case "tool:start":
        return (
          <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
            toolKind === "synthetic" ? "bg-amber-900/40 text-amber-200" : "bg-violet-900/50 text-violet-200"
          }`}>
            <Loader2 className="h-3 w-3 animate-spin" />
            {toolKind === "synthetic" ? "synthetic:start" : "tool:start"}
          </span>
        );
      case "tool:end":
        return (
          <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
            toolKind === "synthetic" ? "bg-amber-900/40 text-amber-200" : "bg-violet-900/40 text-violet-200"
          }`}>
            <CheckCircle2 className="h-3 w-3" />
            {toolKind === "synthetic" ? "synthetic:end" : "tool:end"}
          </span>
        );
      case "tool:status":
        return (
          <span className="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
            <Activity className="h-3 w-3" />
            status
          </span>
        );
      case "synthetic":
        return null;
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden bg-slate-900/60 p-3 text-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-amber-200/90">
          Event Stream Debugger
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleEmitSynthetic()}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-amber-400 hover:bg-slate-800 hover:text-amber-200"
            title="Emit a synthetic tool:start / tool:end pair"
          >
            <Play className="h-3 w-3" />
            Emit
          </button>
          <button
            type="button"
            onClick={() => void handleSaveSnapshot()}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="Copy backend event log snapshot to clipboard"
          >
            <Copy className="h-3 w-3" />
            {copyHint ? "Copied!" : "Snapshot"}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-red-300"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="Collapse Event Stream Debugger"
          >
            <span className="sr-only">Collapse</span>
            <span className="block rotate-180 text-[10px]" style={{ writingMode: "vertical-rl" }}>
              Debug
            </span>
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between text-[10px] text-slate-500">
        <span>{events.length} event{events.length === 1 ? "" : "s"} captured</span>
        <span>{selected ? `Selected: ${shortId(selected.id)}` : "Click an event to inspect"}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-slate-800 bg-slate-950 p-2">
          {events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-500">
              <Bug className="h-5 w-5" />
              <p className="max-w-[180px] text-[11px]">
                No events yet. Emit a synthetic event or run a tool.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1 overflow-y-auto pr-1">
              {events.map((ev) => (
                <li key={`${ev.id}-${ev.frontendTimestamp}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(ev)}
                    className={`flex w-full items-center gap-2 rounded border border-slate-800/50 px-2 py-1.5 text-left hover:bg-slate-900 ${
                      selected?.id === ev.id && selected?.frontendTimestamp === ev.frontendTimestamp
                        ? "bg-slate-900 ring-1 ring-amber-500/40"
                        : "bg-slate-900/40"
                    }`}
                  >
                    {kindBadge(ev.kind, ev.toolKind)}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                      {ev.mission || ev.label || ev.status || ev.kind}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {formatTime(ev.frontendTimestamp)}
                    </span>
                    {ev.success === false && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  </button>
                </li>
              ))}
              <div ref={bottomRef} />
            </ul>
          )}
        </div>

        {selected && (
          <div className="flex min-h-[8rem] shrink-0 flex-col gap-1 rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">
                Payload
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">{selected.kind}</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  title="Close payload details"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 p-1.5 text-[10px] text-slate-300">
              {JSON.stringify(selected.payload, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
