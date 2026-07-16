import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowBigUp,
  Globe,
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
      for (const key of ["posts", "comments"]) {
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
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : undefined,
    content: typeof raw.content === "string" ? raw.content : undefined,
    submolt,
    score: typeof raw.score === "number" ? raw.score : undefined,
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

/** Moltbook browser: profile, feed, search, upvotes, and comments (read-only for humans — only the agent posts). */
export function MoltbookPanel({ open, onClose }: Props) {
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [posts, setPosts] = useState<MoltbookPost[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("hot");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, MoltbookComment[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFeed = useCallback(
    async (nextSort: (typeof SORTS)[number] = sort) => {
      setLoading(true);
      setError(null);
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

  if (!open) return null;

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      void loadFeed();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await invoke<unknown>("moltbook_search", { query: q, limit: 30 });
      setPosts(extractArray(results).map(asPost));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const upvote = async (postId: string) => {
    setError(null);
    try {
      await invoke("moltbook_upvote_post", { postId });
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, score: (p.score ?? 0) + 1 } : p)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleComments = async (postId: string) => {
    if (expandedPost === postId) {
      setExpandedPost(null);
      return;
    }
    setExpandedPost(postId);
    setCommentDraft("");
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

  const sendComment = async (postId: string) => {
    const text = commentDraft.trim();
    if (!text) return;
    setCommentBusy(true);
    setError(null);
    try {
      await invoke("moltbook_create_comment", { postId, content: text });
      setCommentDraft("");
      setNotice("Comment posted.");
      const result = await invoke<unknown>("moltbook_post_comments", { postId });
      setComments((prev) => ({
        ...prev,
        [postId]: extractArray(result) as MoltbookComment[],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommentBusy(false);
    }
  };

  const profileName =
    (typeof profile?.name === "string" && profile.name) || null;
  const profileKarma =
    typeof profile?.karma === "number" ? (profile.karma as number) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Moltbook"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <Globe className="size-4 text-indigo-500" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Moltbook
          </h2>
          {profileName ? (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              {profileName}
              {profileKarma != null ? ` · ${profileKarma} karma` : ""}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadFeed()}
              disabled={loading}
              title="Refresh feed"
              className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Moltbook"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
          <div className="flex items-center gap-1">
            {SORTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSort(s);
                  void loadFeed(s);
                }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${
                  sort === s
                    ? "bg-indigo-500 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="ml-auto flex min-w-[14rem] flex-1 items-center gap-1 sm:flex-none">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              placeholder="Search Moltbook…"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              title="Search"
              className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Search className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>

        {notice ? (
          <div className="shrink-0 border-b border-emerald-300/50 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            {notice}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setNotice(null)}
            >
              dismiss
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="shrink-0 border-b border-red-300/50 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin text-indigo-400" aria-hidden />
              Loading Moltbook…
            </div>
          ) : posts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">
              Nothing here. Check your API key in Settings → Tools → Moltbook, then
              refresh.
            </p>
          ) : (
            <ul className="space-y-3">
              {posts.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => void upvote(p.id)}
                      title="Upvote"
                      className="flex shrink-0 flex-col items-center rounded-lg border border-slate-200 px-1.5 py-1 text-slate-500 hover:border-amber-300 hover:text-amber-500 dark:border-slate-700"
                    >
                      <ArrowBigUp className="size-4" aria-hidden />
                      <span className="text-[10px] font-bold">{p.score ?? 0}</span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        {p.title || "(untitled)"}
                      </h3>
                      <p className="text-[10px] text-slate-500">
                        m/{(p.submolt ?? "?").replace(/^m\//, "")} · by{" "}
                        {p.author?.name ?? "unknown"}
                        {p.author?.karma != null ? ` (${p.author.karma} karma)` : ""}
                      </p>
                      {p.content ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                          {p.content.length > 600
                            ? `${p.content.slice(0, 600)}…`
                            : p.content}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void toggleComments(p.id)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        <MessageSquare className="size-3" aria-hidden />
                        {p.comment_count ?? 0} comments
                      </button>
                      {expandedPost === p.id ? (
                        <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                          {(comments[p.id] ?? []).length === 0 ? (
                            <p className="text-[11px] italic text-slate-400">
                              No comments loaded yet.
                            </p>
                          ) : (
                            (comments[p.id] ?? []).slice(0, 12).map((c) => (
                              <div key={c.id} className="text-xs">
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                  {c.author?.name ?? "unknown"}
                                </span>{" "}
                                <span className="text-[10px] text-slate-400">
                                  [{c.score ?? 0}]
                                </span>
                                <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-400">
                                  {c.content ?? ""}
                                </p>
                              </div>
                            ))
                          )}
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={commentDraft}
                              onChange={(e) => setCommentDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void sendComment(p.id);
                              }}
                              placeholder="Add a comment…"
                              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() => void sendComment(p.id)}
                              disabled={commentBusy || !commentDraft.trim()}
                              className="rounded-lg bg-indigo-500 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                            >
                              {commentBusy ? "…" : "Reply"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
