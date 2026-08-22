import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Calendar,
  CheckSquare,
  Clock,
  CloudSun,
  Contact,
  FileText,
  FolderKanban,
  LayoutGrid,
  Link2,
  LogOut,
  LogIn,
  Mail,
  Plus,
  SlidersHorizontal,
  StickyNote,
} from "lucide-react";
import { AppModeSwitcher } from "@/components/layout/AppModeSwitcher";
import { AppHelpButton } from "@/components/help/AppHelpButton";
import { DonateFooter } from "@/components/support/DonateFooter";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { WidgetFrame } from "@/components/productivity/WidgetFrame";
import { EmailWidget } from "@/components/productivity/EmailWidget";
import { CalendarWidget } from "@/components/productivity/CalendarWidget";
import { DocumentsWidget } from "@/components/productivity/DocumentsWidget";
import { NotepadWidget } from "@/components/productivity/NotepadWidget";
import { ProjectsWidget } from "@/components/productivity/ProjectsWidget";
import { WeatherWidget } from "@/components/productivity/WeatherWidget";
import { ContactsWidget } from "@/components/productivity/ContactsWidget";
import { TasksWidget } from "@/components/productivity/TasksWidget";
import { ClockWidget } from "@/components/productivity/ClockWidget";
import { QuickLinksWidget } from "@/components/productivity/QuickLinksWidget";
import { GoogleConnectCard } from "@/components/productivity/GoogleConnectCard";
import type { GoogleStatus } from "@/lib/googleTypes";
import type { AppMode } from "@/lib/appMode";
import {
  cycleSettingsLayoutMode,
  loadSettingsLayoutMode,
  saveSettingsLayoutMode,
  type SettingsLayoutMode,
} from "@/lib/settingsLayout";
import {
  ALL_WIDGET_KINDS,
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
  weather: <CloudSun className="size-3.5" aria-hidden />,
  contacts: <Contact className="size-3.5" aria-hidden />,
  tasks: <CheckSquare className="size-3.5" aria-hidden />,
  clock: <Clock className="size-3.5" aria-hidden />,
  links: <Link2 className="size-3.5" aria-hidden />,
};

/** Productivity mode — customizable canvas of movable widgets. */
export function ProductivityLayout({ activeConversationId, onModeChange }: Props) {
  const [layout, setLayout] = useState<WidgetLayout>(() => loadLayout());
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const [settingsLayoutMode, setSettingsLayoutMode] = useState<SettingsLayoutMode>(() =>
    loadSettingsLayoutMode(),
  );

  const setSettingsLayout = useCallback((mode: SettingsLayoutMode) => {
    setSettingsLayoutMode(mode);
    saveSettingsLayoutMode(mode);
  }, []);

  const cycleSettingsLayout = useCallback(() => {
    setSettingsLayout(cycleSettingsLayoutMode(settingsLayoutMode));
  }, [settingsLayoutMode, setSettingsLayout]);

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

  const updatePlacement = useCallback(
    (kind: WidgetKind, patch: Partial<{ x: number; y: number; w: number; h: number; z: number }>) => {
      setLayout((prev) => {
        const current = prev[kind];
        if (!current) return prev;
        return { ...prev, [kind]: { ...current, ...patch } };
      });
    },
    [],
  );

  const focusWidget = useCallback((kind: WidgetKind) => {
    setLayout((prev) => {
      const current = prev[kind];
      if (!current) return prev;
      const top = nextZ(prev);
      if (current.z >= top - 1) return prev;
      return { ...prev, [kind]: { ...current, z: top } };
    });
  }, []);

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
      const s = await invoke<GoogleStatus>("google_disconnect", { account: "user" });
      setGoogleStatus(s);
    } catch {
      /* ignore */
    }
  }, []);

  const openWidgets = ALL_WIDGET_KINDS.filter((k) => layout[k]);
  const closedWidgets = ALL_WIDGET_KINDS.filter((k) => !layout[k]);
  const needsGoogle = googleStatus != null && !googleStatus.connected;
  const showConnectHero = needsGoogle && openWidgets.length === 0;

  const signIn = useCallback(async () => {
    try {
      const s = await invoke<GoogleStatus>("google_auth_start", { account: "user" });
      setGoogleStatus(s);
    } catch (e) {
      console.error(e);
    }
  }, []);

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
      case "weather":
        return <WeatherWidget />;
      case "contacts":
        return <ContactsWidget status={googleStatus} onStatusChange={setGoogleStatus} />;
      case "tasks":
        return <TasksWidget status={googleStatus} onStatusChange={setGoogleStatus} />;
      case "clock":
        return <ClockWidget />;
      case "links":
        return <QuickLinksWidget />;
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
                : "Widgets for email, calendar, weather, tasks, and more — arranged your way."}
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 self-center">
          {googleStatus?.connected ? (
            <button
              type="button"
              onClick={() => void disconnect()}
              className="ps-btn-ghost"
              title={`Disconnect ${googleStatus.accountEmail}`}
            >
              <LogOut className="size-3.5" aria-hidden />
              <span className="hidden lg:inline">Disconnect Google</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void signIn()}
              className="ps-btn-primary"
              title="Sign in with Google for Productivity widgets"
            >
              <LogIn className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Sign in with Google</span>
            </button>
          )}
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
              <div role="menu" className="ps-menu absolute right-0 top-full mt-1 max-h-72 overflow-y-auto">
                {closedWidgets.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    className="ps-menu-item"
                    onClick={() => addWidget(kind)}
                  >
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
          <button
            type="button"
            onClick={() => void cycleSettingsLayout()}
            aria-expanded={settingsLayoutMode !== "hidden"}
            aria-controls="nova-settings-panel"
            title={`Settings: ${settingsLayoutMode === "hidden" ? "Hidden" : settingsLayoutMode === "compact" ? "Compact" : "Full"} — click to cycle`}
            className="ps-btn"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Settings
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">
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
                lay out email, calendar, weather, tasks, and more however you like.
              </p>
            </div>
          ) : null}
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
        <SettingsPanel
          layoutMode={settingsLayoutMode}
          onLayoutModeChange={setSettingsLayout}
          activeConversationId={activeConversationId}
        />
      </div>
      <DonateFooter />
    </div>
  );
}
