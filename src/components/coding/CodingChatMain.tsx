import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Send } from "lucide-react";
import { ToolActivityPanel } from "@/components/coding/ToolActivityPanel";
import type { CodingStreamState } from "@/hooks/useCodingChat";
import type { ChatMessage } from "@/types/chat";

type Props = {
  repoName: string;
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  streamAssistant: CodingStreamState;
  error: string | null;
  onSendMessage: (text: string) => void;
};

export function CodingChatMain({
  repoName,
  messages,
  loading,
  sending,
  streamAssistant,
  error,
  onSendMessage,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, streamAssistant, streamAssistant?.toolActivity?.output, streamAssistant?.statusDetail]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || loading) return;
    setDraft("");
    onSendMessage(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-semibold text-slate-100">{repoName}</h2>
        <p className="text-[11px] text-slate-500">
          Enable Coding tools in Settings → Tools → Coding mode (v2)
        </p>
      </div>

      <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && messages.length === 0 && !streamAssistant ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading chat…
          </div>
        ) : messages.length === 0 && !streamAssistant ? (
          <p className="text-sm text-slate-500">
            Ask about this codebase — read files, suggest changes, or explain structure. Enable
            workspace tools in Settings → Tools for file access.
          </p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-8 bg-violet-950/40 text-violet-50"
                    : "mr-8 bg-slate-900/80 text-slate-200"
                }`}
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {m.role === "user" ? "You" : "Agent"}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </li>
            ))}
            {streamAssistant ? (
              <li className="mr-8 rounded-lg bg-slate-900/80 px-3 py-2 text-sm text-slate-200">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Agent
                </div>
                {streamAssistant.toolActivity ? (
                  <ToolActivityPanel activity={streamAssistant.toolActivity} />
                ) : null}
                {streamAssistant.text ? (
                  <div className="whitespace-pre-wrap break-words">{streamAssistant.text}</div>
                ) : streamAssistant.statusDetail ? (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {streamAssistant.statusDetail}
                  </div>
                ) : !streamAssistant.toolActivity ? (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Thinking…
                  </div>
                ) : null}
              </li>
            ) : null}
            <div ref={bottomRef} aria-hidden className="h-px shrink-0" />
          </ul>
        )}
      </div>

      {error ? (
        <div className="shrink-0 border-t border-red-900/50 bg-red-950/30 px-4 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      <form onSubmit={submit} className="shrink-0 border-t border-slate-800 p-3">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Ask the coding agent…"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-600 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={sending || loading || !draft.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-700 text-white hover:bg-violet-600 disabled:opacity-40"
            title="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
