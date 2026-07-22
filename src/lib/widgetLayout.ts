/** Persisted free-form widget layout for Productivity mode.
 *  Positions/sizes are in canvas pixels, snapped to an 8px grid. */

export type WidgetKind = "email" | "calendar" | "documents" | "notepad" | "projects";

export type WidgetPlacement = {
  kind: WidgetKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order — highest is front. */
  z: number;
};

export type WidgetLayout = Record<string, WidgetPlacement>;

const LAYOUT_KEY = "persistent-sage.productivity.layout.v1";
export const GRID = 8;

export const WIDGET_MIN_W = 280;
export const WIDGET_MIN_H = 200;

export const WIDGET_LABELS: Record<WidgetKind, string> = {
  email: "Email",
  calendar: "Calendar",
  documents: "Documents",
  notepad: "Notepad",
  projects: "Projects",
};

export function defaultLayout(): WidgetLayout {
  return {
    email: { kind: "email", x: 16, y: 16, w: 520, h: 440, z: 1 },
    calendar: { kind: "calendar", x: 552, y: 16, w: 420, h: 440, z: 2 },
    notepad: { kind: "notepad", x: 988, y: 16, w: 340, h: 440, z: 3 },
    projects: { kind: "projects", x: 16, y: 472, w: 520, h: 320, z: 4 },
    documents: { kind: "documents", x: 552, y: 472, w: 420, h: 320, z: 5 },
  };
}

export function loadLayout(): WidgetLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as WidgetLayout;
    if (!parsed || typeof parsed !== "object") return defaultLayout();
    return parsed;
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: WidgetLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export function nextZ(layout: WidgetLayout): number {
  return Math.max(0, ...Object.values(layout).map((p) => p.z)) + 1;
}
