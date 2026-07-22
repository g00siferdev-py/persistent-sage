import { CircleHelp, X } from "lucide-react";
import { HelpContent } from "@/components/help/HelpContent";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HelpModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-ps-canvas p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div className="flex max-h-[min(40rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ps-border bg-white shadow-2xl dark:bg-ps-elevated">
        <div className="flex shrink-0 items-center justify-between border-b border-ps-border px-4 py-3 dark:border-ps-border">
          <div className="flex items-center gap-2 text-sm font-semibold text-ps-ink">
            <CircleHelp className="size-4 text-ps-accent" aria-hidden />
            <span id="help-modal-title">Help</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ps-faint hover:bg-ps-elevated hover:text-ps-ink dark:hover:bg-ps-surface dark:hover:text-ps-ink"
            aria-label="Close help"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <HelpContent />
        </div>
      </div>
    </div>
  );
}
