import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Code2, MessageCircle } from "lucide-react";
import { appModeLabel, type AppMode } from "@/lib/appMode";
import packageJson from "../../../package.json";

type Props = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
};

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
    <div
      className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/60 p-0.5"
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
        active={mode === "coding"}
        label={appModeLabel("coding")}
        icon={<Code2 className="h-3.5 w-3.5" aria-hidden />}
        onClick={() => onModeChange("coding")}
      />
      <span className="ml-1 hidden rounded bg-violet-900/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-200/90 sm:inline">
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
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={label}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-slate-700 text-slate-100 shadow-sm"
          : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
