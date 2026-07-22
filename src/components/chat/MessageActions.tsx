import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Star } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { ShareMenu } from "@/components/ui/ShareMenu";

type Props = {
  /** Numeric message row id (string in UI). Non-numeric ids (streaming) cannot be starred. */
  messageId: string;
  content: string;
  favorite?: boolean;
  className?: string;
};

/** Copy / favorite / share row shown under every prompt and response. */
export function MessageActions({
  messageId,
  content,
  favorite = false,
  className = "",
}: Props) {
  const [starred, setStarred] = useState(favorite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStarred(favorite);
  }, [favorite, messageId]);

  const numericId = Number(messageId);
  const canStar = Number.isInteger(numericId) && numericId > 0;

  const toggleStar = async () => {
    if (!canStar || busy) return;
    setBusy(true);
    setError(null);
    const next = !starred;
    setStarred(next);
    try {
      await invoke("memory_set_message_favorite", {
        messageId: numericId,
        favorite: next,
      });
    } catch (e) {
      setStarred(!next);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-1.5 opacity-70 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 ${className}`}
    >
      <CopyButton text={content} label="Copy message" />
      {canStar ? (
        <button
          type="button"
          onClick={() => void toggleStar()}
          disabled={busy}
          title={starred ? "Remove from Favorites" : "Add to Favorites"}
          aria-pressed={starred}
          className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
 starred
 ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300"
 : "border-ps-border bg-white/80 text-ps-muted hover:bg-ps-elevated dark:border-ps-border dark:bg-ps-canvas dark:text-ps-muted dark:hover:bg-ps-elevated"
 }`}
        >
          <Star
            className={`size-3 ${starred ? "fill-amber-400 text-amber-400" : ""}`}
            aria-hidden
          />
          {starred ? "Favorited" : "Favorite"}
        </button>
      ) : null}
      <ShareMenu text={content} />
      {error ? (
        <span className="w-full text-[10px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
