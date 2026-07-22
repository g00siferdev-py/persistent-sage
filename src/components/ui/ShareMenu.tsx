import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Globe, Mail, Share2 } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";

type Props = {
  /** Text to share (message content). */
  text: string;
  size?: "xs" | "sm";
  className?: string;
};

/** Networks that accept prefilled text via a share intent URL. */
const SHARE_TARGETS: { id: string; label: string; buildUrl: (text: string) => string }[] = [
  {
    id: "x",
    label: "X (Twitter)",
    buildUrl: (t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(clip(t, 4000))}`,
  },
  {
    id: "reddit",
    label: "Reddit",
    buildUrl: (t) =>
      `https://www.reddit.com/submit?title=${encodeURIComponent(clip(t, 250))}&selftext=true&text=${encodeURIComponent(clip(t, 8000))}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    buildUrl: (t) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent("https://github.com/g00siferdev-py/persistent-sage")}&quote=${encodeURIComponent(clip(t, 4000))}`,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    buildUrl: (t) =>
      `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(clip(t, 2900))}`,
  },
  {
    id: "bluesky",
    label: "Bluesky",
    buildUrl: (t) =>
      `https://bsky.app/intent/compose?text=${encodeURIComponent(clip(t, 280))}`,
  },
  {
    id: "telegram",
    label: "Telegram",
    buildUrl: (t) =>
      `https://t.me/share/url?url=${encodeURIComponent("https://github.com/g00siferdev-py/persistent-sage")}&text=${encodeURIComponent(clip(t, 4000))}`,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    buildUrl: (t) => `https://wa.me/?text=${encodeURIComponent(clip(t, 4000))}`,
  },
];

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function ShareMenu({
  text,
  size = "xs",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moltbookBusy, setMoltbookBusy] = useState(false);
  const [moltbookOk, setMoltbookOk] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const openTarget = async (buildUrl: (text: string) => string) => {
    setError(null);
    try {
      await invoke("open_share_url", { url: buildUrl(text) });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyForEmail = async () => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  /** Humans never post — ask the companion agent to publish as itself. */
  const askAgentMoltbook = async () => {
    setError(null);
    setMoltbookBusy(true);
    setMoltbookOk(false);
    try {
      await invoke("moltbook_scheduler_ask_share", { text });
      setMoltbookOk(true);
      setTimeout(() => {
        setMoltbookOk(false);
        setOpen(false);
      }, 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoltbookBusy(false);
    }
  };

  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]";

  return (
    <div className={`relative inline-flex ${className}`} ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Share this message"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`ps-btn ${pad}`}
      >
        <Share2 className="size-3" aria-hidden />
        Share
      </button>
      {open ? (
        <div
          role="menu"
          className="ps-menu absolute bottom-full right-0 z-30 mb-1 min-w-[14rem]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={moltbookBusy}
            className="ps-menu-item"
            onClick={() => void askAgentMoltbook()}
            title="Your companion posts as the agent — humans never post on Moltbook"
          >
            <Globe className="size-3.5 shrink-0 text-ps-accent" aria-hidden />
            {moltbookBusy
              ? "Asking companion…"
              : moltbookOk
                ? "Agent is posting…"
                : "Ask companion to post on Moltbook"}
          </button>
          <div className="ps-menu-sep" />
          {SHARE_TARGETS.map((target) => (
            <button
              key={target.id}
              type="button"
              role="menuitem"
              className="ps-menu-item"
              onClick={() => void openTarget(target.buildUrl)}
            >
              <Share2 className="size-3.5 shrink-0 text-ps-faint" aria-hidden />
              {target.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="ps-menu-item"
            onClick={() => void copyForEmail()}
            title="Copies the text so you can paste it into an email or anywhere else"
          >
            {copied ? (
              <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
            ) : (
              <Mail className="size-3.5 shrink-0 text-ps-faint" aria-hidden />
            )}
            {copied ? "Copied for email" : "Copy for email"}
          </button>
          {error ? (
            <p className="px-3 py-1.5 text-[10px] text-red-500">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
