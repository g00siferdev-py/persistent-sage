import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Anchor,
  Brain,
  ChevronDown,
  ListRestart,
  ListX,
  Loader2,
  MessageSquare,
  PenLine,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { MemoryRecallBundle, StoredAnchor, StoredConversation } from "@/types/chat";
import { memoryRecall } from "@/hooks/useNovaMemory";

type Props = {
  conversations: StoredConversation[];
  /** Whether SQLite still has threads (for copy + restore when list is hidden). */
  hasThreadsInDatabase: boolean;
  /** UI-only: sidebar list cleared; database unchanged. */
  threadListHiddenFromSidebar: boolean;
  onClearThreadListFromView: () => void;
  onRestoreThreadListFromView: () => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Called when a conversation bound to coding mode is selected from a companion-mode list. */
  onSelectCoding?: (conversationId: string, repoId: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  listLoading: boolean;
  briefing: string;
  briefingLoading: boolean;
  anchors: StoredAnchor[];
  extractingAnchors?: boolean;
  onExtractAnchors: () => void;
  /** Active companion display name (nameplate). */
  companionName: string;
};

function formatUpdated(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(d));
}

const SIDEBAR_COLLAPSE_PREFIX = "persistent-sage:companion-sidebar:";

function readSidebarCollapse(key: string, defaultOpen: boolean): boolean {
  if (typeof window === "undefined") return defaultOpen;
  try {
    const stored = window.localStorage.getItem(`${SIDEBAR_COLLAPSE_PREFIX}${key}`);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* ignore */
  }
  return defaultOpen;
}

function writeSidebarCollapse(key: string, open: boolean) {
  try {
    window.localStorage.setItem(`${SIDEBAR_COLLAPSE_PREFIX}${key}`, String(open));
  } catch {
    /* ignore */
  }
}

type SidebarSectionProps = {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Shown on the header row when expanded (e.g. Clear view). Clicks do not collapse. */
  headerActions?: ReactNode;
  /** Always visible on the header row (e.g. quick action when collapsed). */
  trailingAction?: ReactNode;
  className?: string;
  bodyClassName?: string;
};

function SidebarSection({
  title,
  icon,
  open,
  onToggle,
  children,
  headerActions,
  trailingAction,
  className = "",
  bodyClassName = "",
}: SidebarSectionProps) {
  return (
    <section className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex shrink-0 items-center gap-1 px-1 pb-1 pt-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ps-faint transition hover:bg-ps-accent-soft hover:text-ps-muted dark:hover:text-ps-muted"
        >
          <ChevronDown
            className={`size-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
          <span className="flex shrink-0 items-center">{icon}</span>
          <span className="truncate">{title}</span>
        </button>
        {open && headerActions ? (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerActions}
          </div>
        ) : null}
        {trailingAction ? (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {trailingAction}
          </div>
        ) : null}
      </div>
      {open ? <div className={`min-h-0 ${bodyClassName}`}>{children}</div> : null}
    </section>
  );
}

export function ConversationSidebar({
  conversations,
  hasThreadsInDatabase,
  threadListHiddenFromSidebar,
  onClearThreadListFromView,
  onRestoreThreadListFromView,
  activeId,
  onSelect,
  onSelectCoding,
  onNewChat,
  onRename,
  onDelete,
  listLoading,
  briefing,
  briefingLoading,
  anchors,
  extractingAnchors = false,
  onExtractAnchors,
  companionName,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [recallQuery, setRecallQuery] = useState("");
  const [recallBusy, setRecallBusy] = useState(false);
  const [recallBundle, setRecallBundle] = useState<MemoryRecallBundle | null>(null);
  const [recallError, setRecallError] = useState<string | null>(null);

  const [newChatOpen, setNewChatOpen] = useState(() => readSidebarCollapse("new-chat", true));
  const [conversationsOpen, setConversationsOpen] = useState(() =>
    readSidebarCollapse("conversations", true),
  );
  const [memoryOpen, setMemoryOpen] = useState(() => readSidebarCollapse("memory-anchor", false));

  useEffect(() => {
    writeSidebarCollapse("new-chat", newChatOpen);
  }, [newChatOpen]);

  useEffect(() => {
    writeSidebarCollapse("conversations", conversationsOpen);
  }, [conversationsOpen]);

  useEffect(() => {
    writeSidebarCollapse("memory-anchor", memoryOpen);
  }, [memoryOpen]);

  const recentAnchorsByDate = [...anchors].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    setRecallBundle(null);
    setRecallError(null);
    setRecallQuery("");
  }, [activeId]);

  const startEditMouseDown = (c: StoredConversation, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(c.id);
    setEditValue(c.title);
  };

  const commitRename = (id: string) => {
    const t = editValue.trim();
    if (t) onRename(id, t);
    setEditingId(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const runRecall = async () => {
    const q = recallQuery.trim();
    if (!q) {
      setRecallBundle(null);
      setRecallError(null);
      return;
    }
    setRecallBusy(true);
    setRecallError(null);
    try {
      // Global search across all threads for this companion (matches chat auto-recall).
      const bundle = await memoryRecall(q, null, 16, 8);
      setRecallBundle(bundle);
    } catch (e) {
      setRecallBundle(null);
      setRecallError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecallBusy(false);
    }
  };

  return (
    <aside className="ps-aside w-[19.5rem] border-r pl-1">
      <div className="flex shrink-0 items-start gap-3 border-b border-ps-border px-4 pb-4 pt-5">
        <img
          src="/persistent-sage-plate.png"
          alt="Persistent Sage"
          className="mt-0.5 size-11 shrink-0 object-contain"
        />
        <div className="min-w-0 pt-0.5">
          <p className="ps-label truncate">Persistent Sage</p>
          <p className="font-display truncate text-lg font-semibold leading-tight tracking-tight text-ps-ink">
            {companionName}
          </p>
          <p className="mt-0.5 truncate text-xs text-ps-muted">Companion mode</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto overscroll-contain px-2 pb-2">
        <SidebarSection
          title="New chat"
          icon={<Plus className="size-3.5" aria-hidden />}
          open={newChatOpen}
          onToggle={() => setNewChatOpen((v) => !v)}
          className="shrink-0"
          bodyClassName="px-1 pb-2"
          trailingAction={
            !newChatOpen ? (
              <button
                type="button"
                onClick={() => onNewChat()}
                aria-label="New chat"
                title="New chat"
                className="ps-btn-primary p-1.5"
              >
                <Plus className="size-3.5" aria-hidden />
              </button>
            ) : null
          }
        >
          <button
            type="button"
            onClick={() => onNewChat()}
            className="ps-btn-primary w-full px-3 py-2.5 text-sm"
          >
            <Plus className="size-4" aria-hidden />
            New chat
          </button>
        </SidebarSection>

        <SidebarSection
          title="Conversations"
          icon={<MessageSquare className="size-3.5" aria-hidden />}
          open={conversationsOpen}
          onToggle={() => setConversationsOpen((v) => !v)}
          className="shrink-0"
          bodyClassName=""
          headerActions={
            !threadListHiddenFromSidebar && hasThreadsInDatabase ? (
              <button
                type="button"
                title="Hide thread list from this sidebar only — does not delete SQLite data"
                onClick={() => onClearThreadListFromView()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ps-border bg-ps-elevated px-2 py-1 text-[10px] font-medium normal-case tracking-normal text-ps-muted transition hover:border-ps-border hover:bg-ps-elevated dark:bg-ps-surface hover:text-ps-ink"
              >
                <ListX className="size-3.5" aria-hidden />
                Clear view
              </button>
            ) : null
          }
        >
        <nav className="max-h-[min(40vh,260px)] space-y-0.5 overflow-y-auto overscroll-contain pr-1">
          {listLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-ps-faint">
              <Loader2 className="size-4 animate-spin text-ps-accent" aria-hidden />
              Loading…
            </div>
          ) : threadListHiddenFromSidebar && hasThreadsInDatabase ? (
            <div className="space-y-3 px-2 py-4">
              <p className="text-center text-xs leading-relaxed text-ps-muted">
                Thread list is hidden from this panel only. Nothing was removed from your database.
              </p>
              <button
                type="button"
                onClick={() => onRestoreThreadListFromView()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-surface px-3 py-2 text-xs font-medium text-ps-ink transition hover:bg-ps-elevated dark:bg-ps-surface"
              >
                <ListRestart className="size-3.5" aria-hidden />
                Show threads from database
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-ps-faint">
              No conversations yet. Start one with New chat.
            </p>
          ) : (
            conversations.map((c) => {
              const active = c.id === activeId;
              const editing = editingId === c.id;
              return (
                <div
                  key={c.id}
                  className={
                    active
                      ? "flex items-start gap-1 rounded-lg bg-ps-elevated dark:bg-ps-surface px-2 py-2 ring-1 ring-ps-accent/40"
                      : "flex items-start gap-1 rounded-lg px-2 py-2 transition hover:bg-ps-elevated dark:bg-ps-surface"
                  }
                >
                  {editing ? (
                    <input
                      ref={inputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(c.id);
                        }
                        if (e.key === "Escape") cancelEdit();
                      }}
                      onBlur={(e) => {
                        const next = e.relatedTarget as Node | null;
                        if (next && e.currentTarget.parentElement?.contains(next)) return;
                        commitRename(c.id);
                      }}
                      className="min-w-0 flex-1 rounded border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-2 py-1 text-sm text-ps-ink outline-none focus:ring-1 focus:ring-ps-accent"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          // Unified context: open the shared thread in the current mode.
                          if (c.appMode === "coding" && c.codingRepoId && onSelectCoding) {
                            onSelectCoding(c.id, c.codingRepoId);
                          } else {
                            onSelect(c.id);
                          }
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        {c.appMode === "coding" && c.codingRepoId ? (
                          <span className="mb-0.5 inline-flex items-center border border-ps-border bg-ps-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ps-muted">
                            Coding
                          </span>
                        ) : null}
                        <span className="block truncate text-sm font-medium text-ps-ink">
                          {c.title}
                        </span>
                        <span
                          className="block text-xs text-ps-faint"
                          title={`Created ${formatUpdated(c.createdAt)}`}
                        >
                          {formatUpdated(c.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Rename ${c.title}`}
                        onMouseDown={(e) => startEditMouseDown(c, e)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setEditingId(c.id);
                            setEditValue(c.title);
                          }
                        }}
                        className="shrink-0 rounded p-1 text-ps-faint transition hover:bg-ps-accent-soft dark:hover:bg-ps-surface hover:text-ps-muted"
                      >
                        <PenLine className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${c.title}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingId(null);
                          setEditValue("");
                          onDelete(c.id);
                        }}
                        className="shrink-0 rounded p-1 text-ps-faint transition hover:bg-red-950/60 hover:text-red-300"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </nav>
        </SidebarSection>

        <SidebarSection
          title="Memory Anchor"
          icon={<Brain className="size-3.5" aria-hidden />}
          open={memoryOpen}
          onToggle={() => setMemoryOpen((v) => !v)}
          className="shrink-0 border-t border-ps-border pt-1"
          bodyClassName=""
        >
          <div className="flex max-h-[min(55vh,460px)] flex-col gap-2 overflow-hidden px-1 pb-1">
            <details className="shrink-0 rounded-md border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-2 py-1 text-[10px] leading-snug text-ps-faint">
              <summary className="cursor-pointer select-none font-medium text-ps-muted">
                About Memory Anchor
              </summary>
              <p className="mt-1.5 flex items-center gap-1.5">
                <span>Raw + curated layers · local only</span>
              </p>
              <p className="mt-1">
                Chat messages live in the main transcript (SQLite). <strong className="text-ps-muted">Recent anchors</strong>{" "}
                lists extracted snippets only — use <strong className="text-ps-muted">Extract raw anchors</strong> or recall
                search below; they are not auto-filled from every reply.
              </p>
            </details>

            <div className="max-h-24 shrink-0 overflow-y-auto rounded-lg border border-ps-border bg-ps-elevated px-2.5 py-2">
              {briefingLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-ps-faint">
                  <Loader2 className="size-4 animate-spin text-ps-accent" aria-hidden />
                  Loading briefing…
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-ps-muted">
                  {briefing.trim() || "Open a chat to load the enriched startup briefing."}
                </pre>
              )}
            </div>

            <div className="flex min-h-[120px] min-w-0 flex-1 flex-col overflow-hidden">
              <p className="mb-1 shrink-0 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-ps-muted">
                Recent anchors
              </p>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5">
                {anchors.length === 0 ? (
                  <li className="px-1 text-[11px] text-ps-muted">
                    No anchors for this thread.
                  </li>
                ) : (
                  recentAnchorsByDate.slice(0, 10).map((a) => (
                    <li
                      key={a.id}
                      className="rounded border border-ps-border bg-ps-elevated px-2 py-1 text-[11px] text-ps-muted"
                    >
                      <span className="mr-1 text-[9px] text-ps-muted">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(
                          new Date(a.createdAt),
                        )}
                      </span>
                      <span className="mr-1 rounded bg-ps-elevated dark:bg-ps-surface px-1 text-[9px] uppercase text-ps-accent">
                        {a.anchorType}
                      </span>
                      <span className="text-ps-faint">·{a.importance}</span>
                      <span className="mt-0.5 block text-ps-muted">{a.content}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={!activeId || briefingLoading || extractingAnchors}
                onClick={() => onExtractAnchors()}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-surface px-2 py-1.5 text-[11px] font-medium text-ps-ink transition hover:bg-ps-elevated dark:bg-ps-surface disabled:opacity-40"
              >
                {extractingAnchors ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Anchor className="size-3.5" aria-hidden />
                )}
                {extractingAnchors ? "Extracting…" : "Extract raw anchors"}
              </button>
            </div>

            <div className="shrink-0">
              <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-ps-muted">
                Hybrid recall (FTS + keywords)
              </p>
              <div className="flex gap-1">
                <input
                  value={recallQuery}
                  onChange={(e) => setRecallQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runRecall();
                  }}
                  placeholder="Search anchors & messages…"
                  className="min-w-0 flex-1 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-2 py-1 text-[11px] text-ps-ink placeholder:text-ps-faint dark:placeholder:text-ps-muted outline-none focus:border-ps-accent/40"
                />
                <button
                  type="button"
                  onClick={() => void runRecall()}
                  disabled={recallBusy}
                  className="shrink-0 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-surface p-1.5 text-ps-muted hover:bg-ps-elevated dark:bg-ps-surface"
                  aria-label="Search"
                >
                  {recallBusy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Search className="size-3.5" aria-hidden />
                  )}
                </button>
              </div>
              {recallError ? (
                <p className="mt-1 text-[10px] text-amber-400/90">{recallError}</p>
              ) : null}
              {recallBundle &&
              (recallBundle.anchors.length > 0 || recallBundle.messages.length > 0) ? (
                <div className="mt-2 space-y-2">
                  {recallBundle.anchors.length > 0 ? (
                    <ul className="space-y-1">
                      {recallBundle.anchors.map((a) => (
                        <li
                          key={a.id}
                          className="rounded bg-ps-elevated dark:bg-ps-elevated px-2 py-0.5 text-[10px] text-ps-muted"
                        >
                          <span className="text-ps-accent">{a.anchorType}</span> · {a.content}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {recallBundle.messages.length > 0 ? (
                    <ul className="space-y-1 border-t border-ps-border pt-1">
                      {recallBundle.messages.map((m) => (
                        <li
                          key={m.id}
                          className="rounded bg-ps-elevated px-2 py-0.5 text-[10px] text-ps-faint"
                        >
                          <span className="font-medium text-ps-muted">{m.role}</span>:{" "}
                          {m.content.length > 160 ? `${m.content.slice(0, 160)}…` : m.content}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : recallBundle &&
                recallBundle.anchors.length === 0 &&
                recallBundle.messages.length === 0 &&
                recallQuery.trim() ? (
                <p className="mt-1 text-[10px] text-ps-muted">No matches.</p>
              ) : null}
            </div>
          </div>
        </SidebarSection>
      </div>
    </aside>
  );
}
