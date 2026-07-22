import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
import type { CalendarEvent, GoogleStatus } from "@/lib/googleTypes";
import { GoogleConnectCard } from "@/components/productivity/GoogleConnectCard";
import { openExternalUrl } from "@/lib/legal";

type Props = {
  status: GoogleStatus | null;
  onStatusChange: (s: GoogleStatus) => void;
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function formatDay(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatTime(iso: string): string {
  if (!iso.includes("T")) return "all day";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

export function CalendarWidget({ status, onStatusChange }: Props) {
  const connected = !!status?.connected && !!status?.calendarEnabled;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<{ events: CalendarEvent[] }>("google_calendar_events", {
        maxResults: 40,
      });
      setEvents(resp.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const key = dayKey(ev.start);
      const list = groups.get(key) ?? [];
      list.push(ev);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [events]);

  const createEvent = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("google_calendar_create_event", {
        summary: title,
        start: when,
        allDay: !when.includes("T"),
      });
      setTitle("");
      setWhen("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!connected) {
    return <GoogleConnectCard status={status} onStatusChange={onStatusChange} compact />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ps-border px-3 py-2">
        <span className="text-[11px] text-ps-faint">Next 14 days</span>
        <div className="flex items-center gap-1">
          <button type="button" className="ps-btn-ghost p-1.5" onClick={() => void load()} title="Refresh" aria-label="Refresh calendar">
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
          </button>
          <button type="button" className="ps-btn-ghost p-1.5" onClick={() => setAdding((v) => !v)} title="Quick add" aria-label="Add event">
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {adding ? (
        <div className="flex shrink-0 flex-col gap-2 border-b border-ps-border bg-ps-elevated/60 p-3">
          <input className="ps-input px-2.5 py-1.5 text-xs" placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            className="ps-input px-2.5 py-1.5 text-xs"
            placeholder="When — 2026-07-28T11:00 or 2026-07-28 (all-day)"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="ps-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="button" className="ps-btn-primary" disabled={saving || !title.trim() || !when.trim()} onClick={() => void createEvent()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              Add event
            </button>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="px-3 py-2 text-xs text-ps-danger">{error}</p> : null}
        {loading && events.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-ps-faint">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading events…
          </div>
        ) : grouped.length === 0 && !error ? (
          <p className="px-3 py-4 text-xs text-ps-faint">No upcoming events.</p>
        ) : (
          grouped.map(([key, dayEvents]) => (
            <div key={key}>
              <p className="ps-label border-b border-ps-border/60 bg-ps-elevated/50 px-3 py-1.5">
                {formatDay(key)}
              </p>
              <ul>
                {dayEvents.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-2 border-b border-ps-border/40 px-3 py-2">
                    <span className="mt-0.5 w-16 shrink-0 text-[11px] font-medium text-ps-warm">
                      {formatTime(ev.start)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ps-ink">{ev.summary}</p>
                      {ev.location ? (
                        <p className="truncate text-[11px] text-ps-faint">{ev.location}</p>
                      ) : null}
                    </div>
                    {ev.htmlLink ? (
                      <button
                        type="button"
                        className="ps-btn-ghost shrink-0 p-1"
                        onClick={() => void openExternalUrl(ev.htmlLink)}
                        title="Open in Google Calendar"
                        aria-label="Open in Google Calendar"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
