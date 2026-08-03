/** Persisted free-form widget layout for Productivity mode.
 *  Positions/sizes are in canvas pixels, snapped to an 8px grid. */

export type WidgetKind =
  | "email"
  | "calendar"
  | "documents"
  | "notepad"
  | "projects"
  | "weather"
  | "contacts"
  | "tasks"
  | "clock"
  | "links";

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
  weather: "Weather",
  contacts: "Contacts",
  tasks: "Tasks",
  clock: "Clock",
  links: "Quick Links",
};

export const ALL_WIDGET_KINDS: WidgetKind[] = [
  "email",
  "calendar",
  "documents",
  "notepad",
  "projects",
  "weather",
  "contacts",
  "tasks",
  "clock",
  "links",
];

export function defaultLayout(): WidgetLayout {
  return {
    email: { kind: "email", x: 16, y: 16, w: 520, h: 440, z: 1 },
    calendar: { kind: "calendar", x: 552, y: 16, w: 420, h: 440, z: 2 },
    notepad: { kind: "notepad", x: 988, y: 16, w: 340, h: 280, z: 3 },
    weather: { kind: "weather", x: 988, y: 312, w: 340, h: 280, z: 4 },
    projects: { kind: "projects", x: 16, y: 472, w: 420, h: 320, z: 5 },
    documents: { kind: "documents", x: 452, y: 472, w: 360, h: 320, z: 6 },
    contacts: { kind: "contacts", x: 828, y: 608, w: 340, h: 320, z: 7 },
    tasks: { kind: "tasks", x: 16, y: 808, w: 420, h: 300, z: 8 },
    clock: { kind: "clock", x: 452, y: 808, w: 280, h: 220, z: 9 },
    links: { kind: "links", x: 748, y: 808, w: 300, h: 300, z: 10 },
  };
}

export function loadLayout(): WidgetLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as WidgetLayout;
    if (!parsed || typeof parsed !== "object") return defaultLayout();
    // Customized canvases keep only what the user had open; new kinds via Add widget.
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
