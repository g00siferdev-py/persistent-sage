import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";

type Props = {
  text: string;
  label?: string;
  className?: string;
  size?: "xs" | "sm";
};

export function CopyButton({ text, label, className = "", size = "xs" }: Props) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    setFailed(false);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    }
  };

  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]";

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={label || "Copy to clipboard"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border font-medium transition ${pad} ${
 failed
 ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
 : "border-ps-border bg-white/80 text-ps-muted hover:bg-ps-elevated dark:border-ps-border dark:bg-ps-canvas dark:text-ps-muted dark:hover:bg-ps-elevated"
 } ${className}`}
      aria-label={label || "Copy to clipboard"}
    >
      {copied ? (
        <Check className="size-3 text-emerald-500" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
      {copied ? "Copied" : failed ? "Failed" : "Copy"}
    </button>
  );
}
