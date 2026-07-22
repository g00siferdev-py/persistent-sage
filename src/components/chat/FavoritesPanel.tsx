import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Star, StarOff, X } from "lucide-react";
import type { StoredMessage } from "@/types/chat";
import { CopyButton } from "@/components/ui/CopyButton";
import { MessageContent } from "@/components/chat/MessageContent";
import { formatChatHeader } from "@/lib/chatTimestamp";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Optional: jump to the conversation containing a favorite. */
  onOpenConversation?: (conversationId: string) => void;
};

/** Modal listing every starred message for the active companion, newest first. */
export function FavoritesPanel({ open, onClose, onOpenConversation }: Props) {
  const [favorites, setFavorites] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await invoke<StoredMessage[]>("memory_list_favorites", {
        limit: 200,
      });
      setFavorites(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const unfavorite = async (messageId: number) => {
    try {
      await invoke("memory_set_message_favorite", {
        messageId,
        favorite: false,
      });
      setFavorites((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="ps-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Favorites"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ps-modal max-h-[85vh] w-full max-w-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-ps-border px-4 py-3 dark:border-ps-border">
          <div className="flex items-center gap-2">
            <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
            <h2 className="text-sm font-semibold text-ps-ink">
              Favorites
            </h2>
            <span className="rounded-md bg-ps-elevated px-2 py-0.5 text-[10px] font-semibold text-ps-faint dark:bg-ps-surface dark:text-ps-faint">
              {favorites.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close favorites"
            className="rounded-lg p-1.5 text-ps-faint hover:bg-ps-elevated hover:text-ps-ink dark:hover:bg-ps-surface dark:hover:text-ps-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error ? (
            <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ps-faint">
              <Loader2 className="size-4 animate-spin text-ps-accent" aria-hidden />
              Loading favorites…
            </div>
          ) : favorites.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ps-border px-4 py-10 text-center text-sm text-ps-faint dark:border-ps-border">
              No favorites yet. Hover a message and click the{" "}
              <Star className="inline size-3.5 text-amber-400" aria-hidden /> star to
              save it here.
            </p>
          ) : (
            <ul className="space-y-3">
              {favorites.map((m) => (
                <li
                  key={m.id}
                  className="rounded-xl border border-ps-border bg-ps-elevated px-3 py-2.5 dark:border-ps-border dark:bg-ps-elevated"
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
                      {formatChatHeader(
                        m.role === "user" ? "You" : "Companion",
                        m.createdAt,
                      )}
                      {m.conversationTitle ? (
                        <span className="ml-2 normal-case tracking-normal text-ps-faint">
                          in “{m.conversationTitle}”
                        </span>
                      ) : null}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {m.conversationId && onOpenConversation ? (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenConversation(m.conversationId!);
                            onClose();
                          }}
                          className="rounded-md border border-ps-border bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-ps-muted hover:bg-ps-elevated dark:border-ps-border dark:bg-ps-canvas dark:text-ps-muted dark:hover:bg-ps-elevated"
                        >
                          Open chat
                        </button>
                      ) : null}
                      <CopyButton text={m.content} label="Copy favorite" />
                      <button
                        type="button"
                        onClick={() => void unfavorite(m.id)}
                        title="Remove from Favorites"
                        className="inline-flex items-center gap-1 rounded-md border border-ps-border bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-ps-muted hover:bg-ps-elevated dark:border-ps-border dark:bg-ps-canvas dark:text-ps-muted dark:hover:bg-ps-elevated"
                      >
                        <StarOff className="size-3" aria-hidden />
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="text-sm leading-relaxed text-ps-ink">
                    <MessageContent text={m.content} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
