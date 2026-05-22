import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

/** Section heading used across Settings tabs. */
export function SettingsSection({
  title,
  description,
  info,
  children,
  className = "",
  compact = false,
}: {
  title: string;
  description?: ReactNode;
  info?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section className={`${compact ? "space-y-1.5" : "space-y-3"} ${className}`.trim()}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">{title}</h3>
          {description && !info ? (
            <p className={`mt-1 leading-relaxed text-slate-500 ${compact ? "text-[10px]" : "text-xs"}`}>
              {description}
            </p>
          ) : null}
        </div>
        {info ? <SettingsInfoTip label={title}>{info}</SettingsInfoTip> : null}
      </div>
      {children}
    </section>
  );
}

/** (i) control — click to read full tool / setting description. */
export function SettingsInfoTip({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={`relative inline-flex shrink-0 ${className}`.trim()}>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded-full border border-slate-300 dark:border-slate-600/80 bg-white dark:bg-slate-900/90 text-slate-600 dark:text-slate-400 transition hover:border-indigo-500/50 hover:bg-slate-200 dark:bg-slate-800 hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
        aria-label={`More about ${label}`}
        aria-expanded={open}
        aria-controls={open ? tipId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Info className="size-3" aria-hidden />
      </button>
      {open ? (
        <div
          id={tipId}
          role="tooltip"
          className="absolute right-0 top-full z-[120] mt-1.5 max-h-[min(16rem,50vh)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-300 dark:border-slate-700/90 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-[11px] leading-relaxed text-slate-700 dark:text-slate-300 shadow-xl ring-1 ring-slate-300/40 dark:ring-slate-600/40"
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}

export function SettingsToggleCard({
  id,
  title,
  description,
  info,
  checked,
  disabled,
  onChange,
  children,
  indent,
  nestDepth: nestDepthProp,
  compact = false,
  footnote,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  /** @deprecated Use nestDepth (1 = one level under parent toggle). */
  indent?: boolean;
  /** 0 = top-level tool setting; 1–2 = nested under the toggle above. */
  nestDepth?: 0 | 1 | 2;
  compact?: boolean;
  footnote?: ReactNode;
}) {
  const useInfo = Boolean(info);
  const showInlineDescription = Boolean(description) && !compact && !useInfo;
  const nestDepth = nestDepthProp ?? (indent ? 1 : 0);
  const nestWrap =
    nestDepth === 1
      ? "ml-3 border-l-2 border-indigo-500/35 pl-2.5 sm:ml-4"
      : nestDepth === 2
        ? "ml-6 border-l-2 border-indigo-500/25 pl-2.5 sm:ml-8"
        : "";

  return (
    <label
      htmlFor={id}
      className={`block cursor-pointer rounded-lg border border-slate-200 dark:border-slate-800/70 bg-slate-50 dark:bg-slate-950/40 transition hover:border-slate-300 dark:border-slate-700/80 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 ${nestWrap} ${
        compact ? "px-2.5 py-1.5" : "px-3 py-3"
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          className={`shrink-0 rounded border-slate-300 dark:border-slate-600 accent-indigo-500 ${compact ? "mt-0 size-3.5" : "mt-0.5 size-4"}`}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`min-w-0 flex-1 font-medium leading-snug text-slate-800 dark:text-slate-200 ${compact ? "text-xs" : "text-sm"}`}
        >
          {title}
        </span>
        {useInfo ? (
          <SettingsInfoTip label={typeof title === "string" ? title : id}>{info}</SettingsInfoTip>
        ) : null}
      </div>
      {footnote ? (
        <p className={`text-amber-400/90 ${compact ? "mt-0.5 pl-5 text-[10px]" : "mt-1.5 pl-7 text-[11px]"}`}>
          {footnote}
        </p>
      ) : null}
      {showInlineDescription ? (
        <p className={`leading-relaxed text-slate-600 dark:text-slate-400 ${compact ? "mt-1 pl-5 text-[10px]" : "mt-2 pl-7 text-xs"}`}>
          {description}
        </p>
      ) : null}
      {children ? (
        <div className={`space-y-2 ${compact ? "mt-1 pl-5" : "mt-2 pl-7"}`}>{children}</div>
      ) : null}
    </label>
  );
}
