import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckSquare, Loader2, Plus, RefreshCw, Square } from "lucide-react";
import type { GoogleStatus } from "@/lib/googleTypes";
import { GoogleConnectCard } from "@/components/productivity/GoogleConnectCard";

type Task = {
  id: string;
  title: string;
  status: string;
  completed: boolean;
  due?: string;
  notes?: string;
  listId?: string;
};

type Props = {
  status: GoogleStatus | null;
  onStatusChange: (s: GoogleStatus) => void;
};

/** Google Tasks — list, add, and toggle complete. */
export function TasksWidget({ status, onStatusChange }: Props) {
  const connected = !!status?.connected && !!status?.enabled;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<{ listId: string; tasks: Task[] }>("google_tasks_list", {
        maxResults: 40,
      });
      setListId(resp.listId ?? null);
      setTasks(resp.tasks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setAdding(true);
    setError(null);
    try {
      await invoke("google_tasks_add", { title: t });
      setTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (task: Task) => {
    setError(null);
    try {
      await invoke("google_tasks_set_completed", {
        taskId: task.id,
        completed: !task.completed,
        listId: task.listId || listId,
      });
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, completed: !t.completed, status: !t.completed ? "completed" : "needsAction" } : t,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!connected) {
    return <GoogleConnectCard status={status} onStatusChange={onStatusChange} compact />;
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-3">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="ps-input min-w-0 flex-1 px-2.5 py-1.5 text-xs"
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New task"
        />
        <button type="submit" className="ps-btn-primary p-1.5" disabled={adding || !title.trim()} aria-label="Add task">
          {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        </button>
        <button type="button" className="ps-btn p-1.5" onClick={() => void load()} disabled={loading} aria-label="Refresh">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </form>
      {error ? (
        <p className="text-[11px] text-ps-danger">
          {error}
          {/403|not been used|disabled/i.test(error) ? (
            <>
              {" "}
              Enable the <strong>Tasks API</strong> in Google Cloud, then reconnect if needed.
            </>
          ) : /insufficient|scope|auth/i.test(error) ? (
            <> Reconnect Google under Settings to grant Tasks access.</>
          ) : null}
        </p>
      ) : null}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => void toggle(task)}
              className="flex w-full items-start gap-2 rounded-md border border-ps-border bg-ps-elevated px-2.5 py-2 text-left hover:border-ps-accent/40"
            >
              {task.completed ? (
                <CheckSquare className="mt-0.5 size-3.5 shrink-0 text-ps-success" aria-hidden />
              ) : (
                <Square className="mt-0.5 size-3.5 shrink-0 text-ps-muted" aria-hidden />
              )}
              <span
                className={`min-w-0 flex-1 text-xs ${task.completed ? "text-ps-faint line-through" : "text-ps-ink"}`}
              >
                {task.title || "Untitled"}
              </span>
            </button>
          </li>
        ))}
        {!loading && !error && tasks.length === 0 ? (
          <li className="py-6 text-center text-[11px] text-ps-faint">No tasks yet.</li>
        ) : null}
      </ul>
    </div>
  );
}
