import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Activity, CheckCircle2, Loader2, XCircle } from "lucide-react";

type StreamKind = "tool:start" | "tool:end" | "generation_step:start" | "generation_step:end" | "tool:status";

type StreamEvent = {
  id: string;
  streamId?: string;
  kind: StreamKind;
  timestamp: number;
  generationNumber?: number;
  mission?: string;
  depth?: number;
  agentKind?: string;
  toolKind?: string;
  toolName?: string;
  label?: string;
  input?: unknown;
  success?: boolean;
  output?: string;
  summary?: string;
  status?: string;
  detail?: string;
};

type Props = {
  repoId?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AgentActionStream({ repoId: _repoId }: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [collapsed, setCollapsed] = useState(false);
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
      // Replay events that were emitted before this component mounted.
      await invoke("agent_stream_replay_recent");

      unlistenStart = await listen<{
        id: string;
        generationNumber?: number;
        mission: string;
        depth?: number;
        agentKind?: string;
      }>("generation_step:start", (e) => {
        setEvents((prev) => [
          ...prev,
          {
            id: e.payload.id,
            kind: "generation_step:start",
            timestamp: Date.now(),
            generationNumber: e.payload.generationNumber,
            mission: e.payload.mission,
            depth: e.payload.depth,
            agentKind: e.payload.agentKind,
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
            timestamp: Date.now(),
            generationNumber: e.payload.generationNumber,
            success: e.payload.success,
            summary: e.payload.summary,
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
              timestamp: Date.now(),
              toolKind: e.payload.toolKind,
              label: e.payload.label,
              input: e.payload.input,
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
              success: e.payload.success,
              output: e.payload.output,
            };
            return next;
          }
          // orphan end event — show a stub
          return [
            ...prev,
            {
              id: e.payload.streamId,
              streamId: e.payload.streamId,
              kind: "tool:end",
              timestamp: Date.now(),
              toolKind: e.payload.toolKind,
              toolName: e.payload.toolName,
              label: e.payload.label,
              success: e.payload.success,
              output: e.payload.output,
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
            next[idx] = { ...next[idx], status: e.payload.status, detail: e.payload.detail };
            return next;
          }
          return [
            ...prev,
            {
              id: `${e.payload.streamId}-status-${Date.now()}`,
              streamId: e.payload.streamId,
              kind: "tool:status",
              timestamp: Date.now(),
              status: e.payload.status,
              detail: e.payload.detail,
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
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, collapsed]);

  const handleClear = () => setEvents([]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex h-full w-8 shrink-0 flex-col items-center justify-start gap-1 border-l border-ps-border bg-ps-elevated py-2 text-[10px] uppercase tracking-wide text-ps-faint hover:bg-ps-surface hover:text-ps-ink"
        title="Open Agent Action Stream"
      >
        <Activity className="h-4 w-4" />
        <span className="rotate-180" style={{ writingMode: "vertical-rl" }}>
          Stream
        </span>
      </button>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden bg-ps-elevated p-3 text-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-200/90">
          Agent Action Stream
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClear}
            className="rounded px-2 py-1 text-[10px] text-ps-faint hover:bg-ps-surface hover:text-ps-ink"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-ps-faint hover:bg-ps-surface hover:text-ps-ink"
            title="Collapse Agent Action Stream"
          >
            <span className="sr-only">Collapse</span>
            <span className="block rotate-180 text-[10px]" style={{ writingMode: "vertical-rl" }}>
              Stream
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded border border-ps-border bg-ps-canvas p-2">
        {events.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ps-faint">
            <Activity className="h-5 w-5" />
            <p className="max-w-[180px] text-[11px]">
              Agent activity will appear here when generation steps and tools run.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="rounded border border-ps-border bg-ps-elevated p-2"
                style={{ marginLeft: Math.min((ev.depth ?? 0) * 12, 48) }}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">
                    {ev.kind === "generation_step:start" && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />}
                    {ev.kind === "generation_step:end" && (ev.success ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />)}
                    {ev.kind === "tool:start" && <Loader2 className="h-3.5 w-3.5 animate-spin text-ps-accent" />}
                    {ev.kind === "tool:end" && (ev.success ? <CheckCircle2 className="h-3.5 w-3.5 text-ps-accent" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />)}
                    {ev.kind === "tool:status" && <Activity className="h-3.5 w-3.5 text-ps-faint" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-ps-ink">
                        {ev.kind === "generation_step:start" &&
                          (ev.agentKind === "subagent" ? "Subagent started" : "Generation step started")}
                        {ev.kind === "generation_step:end" &&
                          (ev.summary?.startsWith("Error:") || ev.success === false
                            ? "Subagent / step ended"
                            : "Generation step ended")}
                        {ev.kind === "tool:start" && ev.label}
                        {ev.kind === "tool:end" && (ev.toolName || ev.label || "Tool ended")}
                        {ev.kind === "tool:status" && ev.status}
                      </span>
                      <span className="shrink-0 text-[10px] text-ps-faint">{formatTime(ev.timestamp)}</span>
                    </div>
                    {ev.mission && <p className="mt-0.5 truncate text-[10px] text-ps-faint">{ev.mission}</p>}
                    {ev.summary && <p className="mt-0.5 text-[10px] text-ps-faint">{ev.summary}</p>}
                    {ev.output && (
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-ps-canvas p-1.5 text-[10px] text-ps-muted">
                        {ev.output}
                      </pre>
                    )}
                    {ev.detail && <p className="mt-0.5 text-[10px] text-ps-faint">{ev.detail}</p>}
                    {ev.input !== undefined && ev.input !== null && ev.kind === "tool:start" && (
                      <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap rounded bg-ps-canvas p-1.5 text-[10px] text-ps-faint">
                        {JSON.stringify(ev.input, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </li>
            ))}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
    </div>
  );
}
