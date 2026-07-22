import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Calendar,
  FileText,
  FolderKanban,
  LayoutGrid,
  LogOut,
  Mail,
  Plus,
  StickyNote,
} from "lucide-react";
import { AppModeSwitcher } from "@/components/layout/AppModeSwitcher";
import { AppHelpButton } from "@/components/help/AppHelpButton";
import { DonateFooter } from "@/components/support/DonateFooter";
import { WidgetFrame } from "@/components/productivity/WidgetFrame";
import { EmailWidget } from "@/components/productivity/EmailWidget";
import { CalendarWidget } from "@/components/productivity/CalendarWidget";
import { DocumentsWidget } from "@/components/productivity/DocumentsWidget";
import { NotepadWidget } from "@/components/productivity/NotepadWidget";
import { ProjectsWidget } from "@/components/productivity/ProjectsWidget";
import { GoogleConnectCard } from "@/components/productivity/GoogleConnectCard";
import type { GoogleStatus } from "@/lib/googleTypes";
import type { AppMode } from "@/lib/appMode";
import {
  defaultLayout,
  loadLayout,
  nextZ,
  saveLayout,
  WIDGET_LABELS,
  type WidgetKind,
  type WidgetLayout,
} from "@/lib/widgetLayout";

type Props = {
  activeConversationId: string | null;
  onModeChange: (mode: AppMode) => void;
};

const WIDGET_ICONS: Record<WidgetKind, React.ReactNode> = {
  email: <Mail className="size-3.5" aria-hidden />,
  calendar: <Calendar className="size-3.5" aria-hidden />,
  documents: <FileText className="size-3.5" aria-hidden />,
  notepad: <StickyNote className="size-3.5" aria-hidden />,
  projects: <FolderKanban className="size-3.5" aria-hidden />,
};

const ALL_WIDGETS: WidgetKind[] = ["email", "calendar", "documents", "notepad", "projects"];

/** Productivity mode — a customizable canvas of movable widgets backed by
 *  Google Workspace (Gmail / Calendar / Drive) plus local notepad and projects. */
export function ProductivityLayout({ onModeChange }: Props) {
  const [layout, setLayout] = useState<WidgetLayout>(() => loadLayout());
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await invoke<GoogleStatus>("google_status");
      setGoogleStatus(s);
    } catch {
      setGoogleStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [addMenuOpen]);

  const updatePlacement = useCallback((kind: WidgetKind, patch: Partial<{ x: number; y: number; w: number; h: number; z: number }>) => {
    setLayout((prev) => {
      const current = prev[kind];
      if (!current) return prev;
      return { ...prev, [kind]: { ...current, ...patch } };
    });
  }, []);

  const focusWidget = useCallback(
    (kind: WidgetKind) => {
      setLayout((prev) => {
        const current = prev[kind];
        if (!current) return prev;
        const top = nextZ(prev);
        if (current.z >= top - 1) return prev;
        return { ...prev, [kind]: { ...current, z: top } };
      });
    },
    [],
  );

  const closeWidget = useCallback((kind: WidgetKind) => {
    setLayout((prev) => {
      const next = { ...prev };
      delete next[kind];
      return next;
    });
  }, []);

  const addWidget = useCallback((kind: WidgetKind) => {
    setLayout((prev) => {
      if (prev[kind]) return prev;
      const defaults = defaultLayout()[kind];
      return {
        ...prev,
        [kind]: { ...defaults, x: 32, y: 32, z: nextZ(prev) },
      };
    });
    setAddMenuOpen(false);
  }, []);

  const disconnect = useCallback(async () => {
    try {
      const s = await invoke<GoogleStatus>("google_disconnect");
      setGoogleStatus(s);
    } catch {
      /* ignore */
    }
  }, []);

  const openWidgets = ALL_WIDGETS.filter((k) => layout[k]);
  const closedWidgets = ALL_WIDGETS.filter((k) => !layout[k]);
  const showConnectHero =
    googleStatus != null && (!googleStatus.connected || !googleStatus.enabled) && openWidgets.length === 0;

  const renderWidget = (kind: WidgetKind) => {
    switch (kind) {
      case "email":
        return <EmailWidget status={googleStatus} onStatusChange={setGoogleStatus} />;
      case "calendar":
        return <CalendarWidget status={googleStatus} onStatusChange={setGoogleStatus} />;
      case "documents":
        return <DocumentsWidget status={googleStatus} onStatusChange={setGoogleStatus} />;
      case "notepad":
        return <NotepadWidget />;
      case "projects":
        return <ProjectsWidget />;
    }
  };

  return (
    <div className="ps-shell">
      <header className="ps-topbar">
        <div className="flex min-w-0 flex-1 items-end gap-4">
          <AppModeSwitcher mode="productivity" onModeChange={onModeChange} />
          <div className="hidden min-w-0 border-l border-ps-border pb-1 pl-4 lg:block">
            <p className="ps-label">Productivity</p>
            <p className="truncate text-xs text-ps-muted">
              {googleStatus?.connected
                ? `Google · ${googleStatus.accountEmail || "connected"}`
                : "Email, calendar, documents, and projects — arranged your way."}
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 self-center">
          {googleStatus?.connected ? (
            <button type="button" onClick={() => void disconnect()} className="ps-btn-ghost" title={`Disconnect ${googleStatus.accountEmail}`}>
              <LogOut className="size-3.5" aria-hidden />
              <span className="hidden lg:inline">Disconnect Google</span>
            </button>
          ) : null}
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              onClick={() => setAddMenuOpen((v) => !v)}
              className="ps-btn"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              disabled={closedWidgets.length === 0}
              title={closedWidgets.length ? "Add a widget to the canvas" : "All widgets are open"}
            >
              <Plus className="size-3.5" aria-hidden />
              Add widget
            </button>
            {addMenuOpen && closedWidgets.length ? (
              <div role="menu" className="ps-menu absolute right-0 top-full mt-1">
                {closedWidgets.map((kind) => (
                  <button key={kind} type="button" role="menuitem" className="ps-menu-item" onClick={() => addWidget(kind)}>
                    <span className="text-ps-accent">{WIDGET_ICONS[kind]}</span>
                    {WIDGET_LABELS[kind]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              setLayout(defaultLayout());
            }}
            className="ps-btn"
            title="Reset widget positions and sizes"
          >
            <LayoutGrid className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">Reset layout</span>
          </button>
          <AppHelpButton />
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {showConnectHero ? (
          <div className="mx-auto mt-16 max-w-md">
            <div className="ps-panel">
              <GoogleConnectCard status={googleStatus} onStatusChange={setGoogleStatus} />
            </div>
          </div>
        ) : null}
        {openWidgets.length === 0 && !showConnectHero ? (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-sm text-center text-sm text-ps-faint">
              The canvas is empty. Use <strong className="text-ps-muted">Add widget</strong> to
              lay out email, calendar, documents, notepad, or projects however you like.
            </p>
          </div>
        ) : null}
        {/* Canvas is larger than the viewport so widgets can spread out. */}
        <div className="relative h-[1600px] w-[2400px]">
          {openWidgets.map((kind) => (
            <WidgetFrame
              key={kind}
              placement={layout[kind]}
              title={WIDGET_LABELS[kind]}
              icon={WIDGET_ICONS[kind]}
              onMove={(x, y) => updatePlacement(kind, { x, y })}
              onResize={(w, h) => updatePlacement(kind, { w, h })}
              onFocus={() => focusWidget(kind)}
              onClose={() => closeWidget(kind)}
            >
              {renderWidget(kind)}
            </WidgetFrame>
          ))}
        </div>
      </div>
      <DonateFooter />
    </div>
  );
}
