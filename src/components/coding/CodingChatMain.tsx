import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Loader2, OctagonX, Send } from "lucide-react";
import { ToolActivityPanel } from "@/components/coding/ToolActivityPanel";
import { ArtifactRenderer } from "@/components/chat/ArtifactRenderer";
import { MessageContent } from "@/components/chat/MessageContent";
import { formatChatHeader } from "@/lib/chatTimestamp";
import { prepareAssistantMessage } from "@/lib/artifacts";
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
  onAbortTurn?: () => void;
};

export function CodingChatMain({
  repoName,
  messages,
  loading,
  sending,
  streamAssistant,
  error,
  onSendMessage,
  onAbortTurn,
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
    if (!text || sending) return;
    setDraft("");
    onSendMessage(text);
  };

  const preparedStream = useMemo(() => {
    if (!streamAssistant?.text) return null;
    return prepareAssistantMessage(streamAssistant.text);
  }, [streamAssistant?.text]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-950/20">
      <div className="shrink-0 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{repoName}</h2>
        <p className="text-[11px] text-slate-500">
          Enable Coding tools in Settings → Tools → Coding mode (v2)
        </p>
      </div>

      <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && messages.length === 0 && !streamAssistant ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
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
            {messages.map((m) => {
              const prepared =
                m.role === "assistant"
                  ? prepareAssistantMessage(m.content, m.artifactJson)
                  : { content: m.content, artifactJson: undefined };
              return (
                <li
                  key={m.id}
                  className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "ml-8 bg-violet-100 text-violet-950 dark:bg-violet-950/40 dark:text-violet-50"
                      : "mr-8 bg-white text-slate-800 shadow-sm dark:bg-slate-900/80 dark:text-slate-200 dark:shadow-none"
                  }`}
                >
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {formatChatHeader(m.role === "user" ? "You" : "Agent", m.createdAt)}
                  </div>
                  {prepared.artifactJson ? (
                    <ArtifactRenderer artifactJson={prepared.artifactJson} />
                  ) : null}
                  {prepared.content ? <MessageContent text={prepared.content} /> : null}
                </li>
              );
            })}
            {streamAssistant ? (
              <li className="mr-8 rounded-lg bg-white px-3 py-2 text-sm text-slate-800 shadow-sm dark:bg-slate-900/80 dark:text-slate-200 dark:shadow-none">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {formatChatHeader("Agent", new Date().toISOString())}
                </div>
                {streamAssistant.toolActivity ? (
                  <ToolActivityPanel activity={streamAssistant.toolActivity} />
                ) : null}
                {preparedStream ? (
                  <>
                    {preparedStream.artifactJson ? (
                      <ArtifactRenderer artifactJson={preparedStream.artifactJson} />
                    ) : null}
                    {preparedStream.content ? (
                      <MessageContent text={preparedStream.content} />
                    ) : null}
                  </>
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

      <form onSubmit={submit} className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Ask the coding agent…"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-600"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                submit(e);
              }
            }}
          />
          <button
            type="button"
            onClick={() => onAbortTurn?.()}
            disabled={!sending}
            title="Abort the current agent turn"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-400/50 bg-red-500/20 text-red-700 hover:bg-red-500/30 disabled:pointer-events-none disabled:opacity-30 dark:text-red-200"
            aria-label="Abort turn"
          >
            <OctagonX className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="submit"
            disabled={sending || !draft.trim()}
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
