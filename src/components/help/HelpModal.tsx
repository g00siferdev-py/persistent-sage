import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, X } from "lucide-react";
import { HelpContent } from "@/components/help/HelpContent";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HelpModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Portal to <body>: the topbar uses backdrop-filter, which traps fixed
  // descendants in its own stacking context (the "help behind chat" bug).
  return createPortal(
    <div
      className="ps-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ps-modal max-h-[min(40rem,90vh)] w-full max-w-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-ps-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ps-ink">
            <CircleHelp className="size-4 text-ps-accent" aria-hidden />
            <span id="help-modal-title" className="font-display">Help</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ps-btn-ghost p-1.5"
            aria-label="Close help"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <HelpContent />
        </div>
      </div>
    </div>,
    document.body,
  );
}
