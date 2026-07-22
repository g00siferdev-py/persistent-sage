import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Code2, LayoutGrid, MessageCircle } from "lucide-react";
import { appModeLabel, type AppMode } from "@/lib/appMode";
import packageJson from "../../../package.json";

type Props = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
};

/** Mode rail for Companion / Productivity / Coding. */
export function AppModeSwitcher({ mode, onModeChange }: Props) {
  const [versionLabel, setVersionLabel] = useState(`v${packageJson.version}`);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("app_version")
      .then((raw) => {
        const ver = raw.trim().split(/\s+/).pop();
        if (!cancelled && ver) setVersionLabel(`v${ver}`);
      })
      .catch(() => {
        /* browser preview — keep package.json version */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-w-0 items-end gap-5">
      <div className="hidden min-w-0 flex-col sm:flex">
        <span className="ps-label">Persistent Sage</span>
        <span className="font-display text-base font-semibold leading-none tracking-tight text-ps-ink">
          Workspace
        </span>
      </div>

      <div
        className="flex items-stretch gap-0 border-b border-ps-border"
        role="tablist"
        aria-label="Application mode"
      >
        <ModeButton
          active={mode === "companion"}
          label={appModeLabel("companion")}
          icon={<MessageCircle className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => onModeChange("companion")}
        />
        <ModeButton
          active={mode === "productivity"}
          label={appModeLabel("productivity")}
          icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => onModeChange("productivity")}
        />
        <ModeButton
          active={mode === "coding"}
          label={appModeLabel("coding")}
          icon={<Code2 className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => onModeChange("coding")}
          asymmetric
        />
      </div>

      <span className="mb-1 hidden font-mono text-[10px] tracking-wide text-ps-faint lg:inline">
        {versionLabel}
      </span>
    </div>
  );
}

function ModeButton({
  active,
  label,
  icon,
  onClick,
  asymmetric = false,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  asymmetric?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={label}
      onClick={onClick}
      className={`relative flex items-center gap-2 px-3 pb-2.5 pt-1 text-xs font-medium transition-colors ${
        asymmetric ? "pl-4 pr-2" : "pl-2 pr-3"
      } ${active ? "text-ps-ink" : "text-ps-faint hover:text-ps-muted"}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {active ? (
        <span
          className={`absolute -bottom-px h-[2px] bg-ps-accent ${
            asymmetric ? "left-3 right-0" : "left-0 right-2"
          }`}
          aria-hidden
        />
      ) : null}
    </button>
  );
}
