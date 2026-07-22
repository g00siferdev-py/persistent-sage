import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Loader2, PenLine, RefreshCw, Search, Send } from "lucide-react";
import type { GmailFull, GmailSummary, GoogleStatus } from "@/lib/googleTypes";
import { GoogleConnectCard } from "@/components/productivity/GoogleConnectCard";

type View = { kind: "list" } | { kind: "read"; id: string } | { kind: "compose" };

type Props = {
  status: GoogleStatus | null;
  onStatusChange: (s: GoogleStatus) => void;
};

export function EmailWidget({ status, onStatusChange }: Props) {
  const connected = !!status?.connected && !!status?.gmailEnabled;
  const [view, setView] = useState<View>({ kind: "list" });
  const [messages, setMessages] = useState<GmailSummary[]>([]);
  const [message, setMessage] = useState<GmailFull | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const loadList = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<{ messages: GmailSummary[] }>("google_gmail_list", {
        query: q || null,
        maxResults: 20,
      });
      setMessages(resp.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void loadList("");
  }, [connected, loadList]);

  const openMessage = async (id: string) => {
    setView({ kind: "read", id });
    setMessage(null);
    setError(null);
    try {
      const full = await invoke<GmailFull>("google_gmail_get", { messageId: id });
      setMessage(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendMail = async (asDraft: boolean) => {
    setSending(true);
    setError(null);
    setSentNote(null);
    try {
      await invoke("google_gmail_send", {
        to,
        subject,
        body,
        send: !asDraft,
      });
      setSentNote(asDraft ? "Draft saved to Gmail." : "Sent.");
      setTo("");
      setSubject("");
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  if (!connected) {
    return <GoogleConnectCard status={status} onStatusChange={onStatusChange} compact />;
  }

  if (view.kind === "compose") {
    return (
      <div className="flex h-full flex-col gap-2 overflow-y-auto p-3">
        <div className="flex items-center gap-2">
          <button type="button" className="ps-btn-ghost p-1" onClick={() => setView({ kind: "list" })} aria-label="Back to inbox">
            <ArrowLeft className="size-3.5" aria-hidden />
          </button>
          <span className="ps-label">New message</span>
        </div>
        <input className="ps-input px-2.5 py-1.5 text-xs" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
        <input className="ps-input px-2.5 py-1.5 text-xs" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="ps-input min-h-[8rem] flex-1 resize-none px-2.5 py-1.5 text-xs" placeholder="Write your message…" value={body} onChange={(e) => setBody(e.target.value)} />
        {error ? <p className="text-[11px] text-ps-danger">{error}</p> : null}
        {sentNote ? <p className="text-[11px] text-ps-success">{sentNote}</p> : null}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="ps-btn" disabled={sending || !to.trim()} onClick={() => void sendMail(true)}>
            Save draft
          </button>
          <button type="button" className="ps-btn-primary" disabled={sending || !to.trim()} onClick={() => void sendMail(false)}>
            {sending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
            Send
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === "read") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-ps-border px-3 py-2">
          <button type="button" className="ps-btn-ghost p-1" onClick={() => setView({ kind: "list" })} aria-label="Back to inbox">
            <ArrowLeft className="size-3.5" aria-hidden />
          </button>
          <span className="min-w-0 truncate text-xs font-semibold text-ps-ink">
            {message?.subject || "Loading…"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? <p className="text-xs text-ps-danger">{error}</p> : null}
          {message ? (
            <>
              <p className="text-[11px] text-ps-muted">
                <strong className="text-ps-ink">{message.from}</strong>
                <br />
                {message.date}
              </p>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-ps-ink">
                {message.body}
              </pre>
            </>
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
      <div className="flex shrink-0 items-center gap-2 border-b border-ps-border px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ps-faint" aria-hidden />
          <input
            className="ps-input w-full py-1 pl-7 pr-2 text-[11px]"
            placeholder="Search mail (from:, subject:, is:unread…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadList(query);
            }}
          />
        </div>
        <button type="button" className="ps-btn-ghost p-1.5" onClick={() => void loadList(query)} title="Refresh" aria-label="Refresh inbox">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </button>
        <button type="button" className="ps-btn-ghost p-1.5" onClick={() => setView({ kind: "compose" })} title="Compose" aria-label="Compose email">
          <PenLine className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="px-3 py-2 text-xs text-ps-danger">{error}</p> : null}
        {loading && messages.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-ps-faint">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading inbox…
          </div>
        ) : messages.length === 0 && !error ? (
          <p className="px-3 py-4 text-xs text-ps-faint">No messages found.</p>
        ) : (
          <ul>
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => void openMessage(m.id)}
                  className="flex w-full flex-col gap-0.5 border-b border-ps-border/60 px-3 py-2 text-left transition-colors hover:bg-ps-accent-soft"
                >
                  <span className={`truncate text-xs ${m.unread ? "font-semibold text-ps-ink" : "text-ps-muted"}`}>
                    {m.from.replace(/<.*>/, "").trim() || m.from}
                  </span>
                  <span className={`truncate text-xs ${m.unread ? "font-medium text-ps-ink" : "text-ps-muted"}`}>
                    {m.subject || "(no subject)"}
                  </span>
                  <span className="truncate text-[11px] text-ps-faint">{m.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
