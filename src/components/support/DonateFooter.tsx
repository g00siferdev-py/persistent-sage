import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { DonateOptions } from "@/components/support/DonateOptions";

export function DonateFooter() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open, close]);

  return (
    <div className="relative z-20 shrink-0 border-t border-ps-border bg-ps-elevated/90 px-4 py-1.5 text-center">
      <p className="text-[10px] leading-relaxed text-ps-faint">
        Enjoying Persistent Sage? Help contribute to its development.{" "}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="font-medium text-ps-accent underline-offset-2 hover:underline dark:text-ps-accent"
        >
          Donate
        </button>
      </p>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Donate to Persistent Sage development"
          className="ps-menu absolute bottom-full left-1/2 z-30 mb-2 w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 p-4 text-left sm:p-5"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-ps-ink">Support development</p>
            <button
              type="button"
              onClick={close}
              aria-label="Close donate panel"
              className="rounded p-0.5 text-ps-faint hover:bg-ps-elevated hover:text-ps-muted dark:hover:bg-ps-surface dark:hover:text-ps-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <DonateOptions showQr qrProminent />
        </div>
      ) : null}
    </div>
  );
}
