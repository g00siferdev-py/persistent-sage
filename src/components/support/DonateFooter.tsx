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
    <div className="relative z-20 shrink-0 border-t border-slate-200/80 bg-slate-100/90 px-3 py-1 text-center dark:border-slate-800/80 dark:bg-slate-900/70">
      <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        Enjoying Persistent Sage? Help contribute to its development.{" "}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300"
        >
          Donate
        </button>
      </p>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Donate to Persistent Sage development"
          className="absolute bottom-full left-1/2 z-30 mb-2 w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:p-5"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Support development</p>
            <button
              type="button"
              onClick={close}
              aria-label="Close donate panel"
              className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
