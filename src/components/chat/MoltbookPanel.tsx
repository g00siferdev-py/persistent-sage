import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

type MoltbookAuthor = {
  name?: string;
  karma?: number;
};

type MoltbookPost = {
  id: string;
  title?: string;
  content?: string;
  submolt?: string;
  score?: number;
  comment_count?: number;
  created_at?: string;
  author?: MoltbookAuthor;
};

type MoltbookComment = {
  id: string;
  content?: string;
  score?: number;
  author?: MoltbookAuthor;
  replies?: MoltbookComment[];
};

type SchedulerEvent = {
  ok: boolean;
  at: string;
  action: string;
  summary?: string;
  error?: string;
};

function extractArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["posts", "comments", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    const data = obj.data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (data && typeof data === "object") {
      const nested = data as Record<string, unknown>;
      for (const key of ["posts", "comments", "results"]) {
        if (Array.isArray(nested[key])) return nested[key] as Record<string, unknown>[];
      }
    }
  }
  return [];
}

function asPost(raw: Record<string, unknown>, index: number): MoltbookPost {
  const authorRaw = raw.author;
  const author =
    authorRaw && typeof authorRaw === "object"
      ? (authorRaw as MoltbookAuthor)
      : undefined;
  const id =
    typeof raw.id === "string"
      ? raw.id
      : typeof raw.id === "number"
        ? String(raw.id)
        : `post-${index}`;
  let submolt: string | undefined;
  if (typeof raw.submolt === "string") {
    submolt = raw.submolt;
  } else if (raw.submolt && typeof raw.submolt === "object") {
    const name = (raw.submolt as Record<string, unknown>).name;
    if (typeof name === "string") submolt = name;
  }
  const score =
    typeof raw.score === "number"
      ? raw.score
      : typeof raw.upvotes === "number"
        ? raw.upvotes
        : undefined;
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : undefined,
    content: typeof raw.content === "string" ? raw.content : undefined,
    submolt,
    score,
    comment_count:
      typeof raw.comment_count === "number"
        ? raw.comment_count
        : typeof raw.commentCount === "number"
          ? raw.commentCount
          : undefined,
    created_at:
      typeof raw.created_at === "string"
        ? raw.created_at
        : typeof raw.createdAt === "string"
          ? raw.createdAt
          : undefined,
    author,
  };
}

const SORTS = ["hot", "new", "top", "rising"] as const;

/**
 * Read-only Moltbook browser for humans.
 * Writing (posts, comments, upvotes, DMs) is agent-only via tools / scheduler.
 */
export function MoltbookPanel({ open, onClose }: Props) {
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [homeHint, setHomeHint] = useState<string | null>(null);
  const [posts, setPosts] = useState<MoltbookPost[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("hot");
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, MoltbookComment[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState<string | null>(null);

  const loadFeed = useCallback(
    async (nextSort: (typeof SORTS)[number] = sort) => {
      setLoading(true);
      setError(null);
      setSearchMode(false);
      try {
        const feed = await invoke<unknown>("moltbook_feed", {
          sort: nextSort,
          limit: 30,
          submolt: null,
        });
        setPosts(extractArray(feed).map(asPost));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [sort],
  );

  useEffect(() => {
    if (!open) return;
    void loadFeed();
    invoke<Record<string, unknown>>("moltbook_me")
      .then(setProfile)
      .catch(() => setProfile(null));
    invoke<Record<string, unknown>>("moltbook_home")
      .then((home) => {
        const unread =
          (home as { your_account?: { unread_notification_count?: number } })?.your_account
            ?.unread_notification_count ??
          (typeof home.unread_notification_count === "number"
            ? home.unread_notification_count
            : null);
        if (typeof unread === "number") {
          setHomeHint(`${unread} unread notification${unread === 1 ? "" : "s"}`);
        }
      })
      .catch(() => setHomeHint(null));
    invoke<Record<string, unknown>>("moltbook_agent_status")
      .then((status) => {
        const claimUrl =
          (typeof status.claim_url === "string" && status.claim_url) ||
          (typeof status.claimUrl === "string" && status.claimUrl) ||
          null;
        const verified =
          status.verified === true ||
          status.status === "claimed" ||
          status.status === "active";
        if (claimUrl && !verified) {
          setNotice(
            `This agent still needs to be claimed on Moltbook before posting works. Open: ${claimUrl}`,
          );
        }
      })
      .catch(() => {
        /* status endpoint is optional */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | undefined;
    void listen<SchedulerEvent>("moltbook:scheduler", (ev) => {
      const p = ev.payload;
      const when = p.at ? new Date(p.at).toLocaleString() : "just now";
      if (p.ok) {
        setLastActivity(`${p.action} · ${when}`);
      } else if (p.error) {
        setLastActivity(`${p.action} failed · ${when}`);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [open]);

  if (!open) return null;

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      void loadFeed();
      return;
    }
    setLoading(true);
    setError(null);
    setSearchMode(true);
    try {
      const results = await invoke<{ posts?: unknown }>("moltbook_search", {
        query: q,
        limit: 30,
        searchType: "posts",
      });
      const list = extractArray(results).map(asPost);
      setPosts(list);
      if (list.length === 0) {
        setError(null);
        setNotice(`No posts matched “${q}”. Try a more descriptive natural-language query.`);
      } else {
        setNotice(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setNotice(null);
    void loadFeed();
  };

  const toggleComments = async (postId: string) => {
    if (expandedPost === postId) {
      setExpandedPost(null);
      return;
    }
    setExpandedPost(postId);
    if (!comments[postId]) {
      try {
        const result = await invoke<unknown>("moltbook_post_comments", { postId });
        setComments((prev) => ({
          ...prev,
          [postId]: extractArray(result) as MoltbookComment[],
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const profileName =
    (typeof profile?.name === "string" && profile.name) || null;
  const profileKarma =
    typeof profile?.karma === "number" ? (profile.karma as number) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#041a1c]/70 p-4 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label="Moltbook"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#2a6b6e]/50 shadow-2xl shadow-[#0a3d40]/40"
        style={{
          background:
            "linear-gradient(165deg, #0b2f32 0%, #0f3d42 42%, #123a3e 70%, #0c282c 100%)",
        }}
      >
        <header
          className="relative flex shrink-0 flex-wrap items-end gap-2 border-b border-[#3d8b8f]/35 px-5 pb-3 pt-4"
          style={{
            background:
              "radial-gradient(120% 80% at 0% 0%, rgba(232, 109, 74, 0.22), transparent 55%), linear-gradient(90deg, #0d383c, #0f4549)",
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7ec8c4]">
              Social network for AI agents
            </p>
            <h2
              className="mt-0.5 text-[1.65rem] font-bold leading-none tracking-tight text-[#f3f7f6]"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              Moltbook
            </h2>
          </div>
          <span className="rounded border border-[#e86d4a]/50 bg-[#e86d4a]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#ffb39a]">
            Browse only
          </span>
          {profileName ? (
            <span className="rounded border border-[#3d8b8f]/50 bg-[#13484c]/80 px-2 py-0.5 text-[10px] font-semibold text-[#b8e6e2]">
              {profileName}
              {profileKarma != null ? ` · ${profileKarma} karma` : ""}
            </span>
          ) : null}
          {homeHint ? (
            <span className="w-full text-[10px] text-[#8ebdb9]">{homeHint}</span>
          ) : null}
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void loadFeed()}
              disabled={loading}
              title="Refresh feed"
              className="rounded-lg border border-[#3d8b8f]/45 bg-[#0d383c]/60 p-1.5 text-[#b8e6e2] hover:bg-[#164f54] disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Moltbook"
              className="rounded-lg p-1.5 text-[#8ebdb9] hover:bg-[#164f54] hover:text-[#f3f7f6]"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        <p className="shrink-0 border-b border-[#3d8b8f]/25 px-5 py-2 text-[10px] leading-relaxed text-[#8ebdb9]">
          Humans browse the reef. Your agent posts, comments, and upvotes — configure it in Settings → Tools →
          Moltbook.
          {lastActivity ? (
            <span className="ml-2 font-medium text-[#ffb39a]">Last agent activity: {lastActivity}</span>
          ) : null}
        </p>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#3d8b8f]/25 px-4 py-2">
          <div className="flex items-center gap-1">
            {SORTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSort(s);
                  setQuery("");
                  void loadFeed(s);
                }}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
                  !searchMode && sort === s
                    ? "bg-[#e86d4a] text-[#1a100c]"
                    : "text-[#a8d4d0] hover:bg-[#164f54]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {searchMode ? (
            <span className="rounded border border-[#e86d4a]/40 bg-[#e86d4a]/15 px-2 py-0.5 text-[10px] font-semibold text-[#ffb39a]">
              Search results
            </span>
          ) : null}
          <div className="ml-auto flex min-w-[12rem] flex-1 items-center gap-1 sm:max-w-xs">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              placeholder="Search the reef…"
              className="min-w-0 flex-1 rounded-lg border border-[#3d8b8f]/45 bg-[#0a2a2d]/80 px-2 py-1.5 text-xs text-[#e8f4f3] outline-none placeholder:text-[#6fa8a4] focus:border-[#e86d4a]/70"
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={loading}
              className="rounded-lg bg-[#e86d4a] p-1.5 text-[#1a100c] hover:bg-[#f0835f] disabled:opacity-50"
              title="Search"
            >
              <Search className="size-3.5" aria-hidden />
            </button>
            {searchMode ? (
              <button
                type="button"
                onClick={clearSearch}
                className="rounded-lg border border-[#3d8b8f]/45 px-2 py-1 text-[10px] font-semibold text-[#a8d4d0] hover:bg-[#164f54]"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 20% 0%, rgba(62, 160, 155, 0.08), transparent 50%), radial-gradient(ellipse at 90% 40%, rgba(232, 109, 74, 0.06), transparent 45%)",
          }}
        >
          {error ? (
            <p className="mb-2 rounded border border-red-400/40 bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mb-2 rounded border border-[#e86d4a]/35 bg-[#e86d4a]/10 px-2 py-1.5 text-xs text-[#ffb39a]">
              {notice}
            </p>
          ) : null}
          {loading && posts.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-[#8ebdb9]">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading the reef…
            </div>
          ) : posts.length === 0 ? (
            <p className="text-xs text-[#8ebdb9]">
              {searchMode
                ? "No matching posts."
                : "Nothing in this feed yet. Check your API key in Settings if this persists."}
            </p>
          ) : (
            <ul className="space-y-3">
              {posts.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border border-[#3d8b8f]/30 bg-[#0a2a2d]/55 p-3 backdrop-blur-[1px]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#f3f7f6]">
                        {p.title || "(untitled)"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#7ec8c4]">
                        {p.author?.name ?? "unknown"}
                        {p.submolt ? ` · m/${p.submolt}` : ""}
                        {p.score != null ? ` · ${p.score}↑` : ""}
                      </p>
                    </div>
                  </div>
                  {p.content ? (
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#c5dedc]">
                      {p.content.length > 500 ? `${p.content.slice(0, 499)}…` : p.content}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void toggleComments(p.id)}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#ffb39a] hover:text-[#ffc9b5]"
                  >
                    <MessageSquare className="size-3" aria-hidden />
                    {expandedPost === p.id ? "Hide comments" : "View comments"}
                    {p.comment_count != null ? ` (${p.comment_count})` : ""}
                  </button>
                  {expandedPost === p.id ? (
                    <ul className="mt-2 space-y-2 border-t border-[#3d8b8f]/25 pt-2">
                      {(comments[p.id] ?? []).length === 0 ? (
                        <li className="text-[11px] text-[#8ebdb9]">No comments loaded.</li>
                      ) : (
                        (comments[p.id] ?? []).map((c) => (
                          <li key={c.id} className="text-[11px] text-[#c5dedc]">
                            <span className="font-semibold text-[#7ec8c4]">
                              {c.author?.name ?? "anon"}:
                            </span>{" "}
                            {c.content}
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
