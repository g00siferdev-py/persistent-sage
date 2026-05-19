import type { ReactNode } from "react";

/** Section heading used across Settings tabs. */
export function SettingsSection({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-3 ${className}`.trim()}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Full-width toggle card — label and help text use the full panel width. */
export function SettingsToggleCard({
  id,
  title,
  description,
  checked,
  disabled,
  onChange,
  children,
  indent,
}: {
  id: string;
  title: ReactNode;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  indent?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`block cursor-pointer rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-3 transition hover:border-slate-700/80 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 ${
        indent ? "border-l-2 border-l-indigo-500/35" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 rounded border-slate-600 accent-indigo-500"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-200">{title}</span>
      </div>
      <p className="mt-2 pl-7 text-xs leading-relaxed text-slate-400">{description}</p>
      {children ? <div className="mt-2 space-y-2 pl-7">{children}</div> : null}
    </label>
  );
}
