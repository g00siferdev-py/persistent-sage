import { useCallback, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  snap,
  WIDGET_MIN_H,
  WIDGET_MIN_W,
  type WidgetPlacement,
} from "@/lib/widgetLayout";

type Props = {
  placement: WidgetPlacement;
  title: string;
  icon: ReactNode;
  /** Extra header controls (e.g. refresh). */
  headerExtra?: ReactNode;
  children: ReactNode;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onFocus: () => void;
  onClose: () => void;
};

/** Movable, resizable widget card. Drag the header to move; drag the corner to resize. */
export function WidgetFrame({
  placement,
  title,
  icon,
  headerExtra,
  children,
  onMove,
  onResize,
  onFocus,
  onClose,
}: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      // Only the header background drags — not its buttons.
      if ((e.target as HTMLElement).closest("button, select, input")) return;
      e.preventDefault();
      onFocus();
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = placement.x;
      const origY = placement.y;

      const onPointerMove = (ev: PointerEvent) => {
        onMove(
          Math.max(0, snap(origX + ev.clientX - startX)),
          Math.max(0, snap(origY + ev.clientY - startY)),
        );
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [onFocus, onMove, placement.x, placement.y],
  );

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus();
      const startX = e.clientX;
      const startY = e.clientY;
      const origW = placement.w;
      const origH = placement.h;

      const onPointerMove = (ev: PointerEvent) => {
        onResize(
          Math.max(WIDGET_MIN_W, snap(origW + ev.clientX - startX)),
          Math.max(WIDGET_MIN_H, snap(origH + ev.clientY - startY)),
        );
      };
      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [onFocus, onResize, placement.w, placement.h],
  );

  return (
    <section
      ref={frameRef}
      className="ps-panel absolute flex flex-col overflow-hidden"
      style={{
        left: placement.x,
        top: placement.y,
        width: placement.w,
        height: placement.h,
        zIndex: placement.z,
      }}
      onPointerDown={onFocus}
      aria-label={title}
    >
      <header
        className="flex shrink-0 cursor-grab select-none items-center gap-2 border-b border-ps-border bg-ps-elevated/80 px-3 py-2 active:cursor-grabbing"
        onPointerDown={startDrag}
        title="Drag to move"
      >
        <span className="text-ps-accent">{icon}</span>
        <h2 className="font-display min-w-0 flex-1 truncate text-xs font-semibold tracking-tight text-ps-ink">
          {title}
        </h2>
        {headerExtra}
        <button
          type="button"
          onClick={onClose}
          className="ps-btn-ghost p-1"
          aria-label={`Close ${title} widget`}
          title="Close widget"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        onPointerDown={startResize}
        title="Drag to resize"
        aria-hidden
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-ps-faint">
          <path
            d="M14 8 L8 14 M14 12 L12 14"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </div>
    </section>
  );
}
