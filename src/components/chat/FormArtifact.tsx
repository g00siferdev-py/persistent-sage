import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import {
  initialFormValues,
  parseFormArtifactBody,
  type FormFieldDef,
} from "@/lib/artifactForm";

type Props = {
  title: string;
  body: unknown;
  projectId?: string;
  /** Companion display name for the submit button (e.g. "Sage", "Nova"). */
  companionName: string;
  disabled?: boolean;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
};

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const kind = field.kind ?? "text";
  const id = `artifact-field-${field.id}`;
  const base =
    "w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950/50 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-50";

  if (kind === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 rounded border-slate-400"
        />
        {field.label}
      </label>
    );
  }

  if (kind === "textarea") {
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {field.label}
          {field.required ? <span className="text-rose-500"> *</span> : null}
        </label>
        <textarea
          id={id}
          rows={3}
          disabled={disabled}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        />
      </div>
    );
  }

  if (kind === "select" || kind === "radio") {
    const options = field.options ?? [];
    if (kind === "radio") {
      return (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {field.label}
            {field.required ? <span className="text-rose-500"> *</span> : null}
          </legend>
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={id}
                value={opt}
                checked={value === opt}
                disabled={disabled}
                onChange={() => onChange(opt)}
              />
              {opt}
            </label>
          ))}
        </fieldset>
      );
    }
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {field.label}
          {field.required ? <span className="text-rose-500"> *</span> : null}
        </label>
        <select
          id={id}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        >
          <option value="">—</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {field.label}
        {field.required ? <span className="text-rose-500"> *</span> : null}
      </label>
      <input
        id={id}
        type={kind === "number" ? "number" : "text"}
        disabled={disabled}
        placeholder={field.placeholder}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) =>
          onChange(kind === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)
        }
        className={base}
      />
    </div>
  );
}

export function FormArtifact({
  title,
  body,
  projectId,
  companionName,
  disabled,
  onSubmit,
}: Props) {
  const parsed = useMemo(() => parseFormArtifactBody(body), [body]);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    parsed ? initialFormValues(parsed.fields) : {},
  );
  const [submittedFlash, setSubmittedFlash] = useState(false);

  const name = companionName.trim() || "Agent";
  const defaultSendLabel = `Send to ${name}`;

  useEffect(() => {
    if (!submittedFlash) return;
    const t = window.setTimeout(() => setSubmittedFlash(false), 2000);
    return () => window.clearTimeout(t);
  }, [submittedFlash]);

  if (!parsed) {
    return (
      <p className="text-xs text-rose-500">Could not render form artifact (invalid body).</p>
    );
  }

  // Always use the active companion name — models often hardcode "Sage" in submitLabel.
  const buttonLabel = submittedFlash ? "Submitted" : defaultSendLabel;

  const handleSubmit = () => {
    for (const f of parsed.fields) {
      if (!f.required) continue;
      const v = values[f.id];
      if (v === "" || v === undefined || v === null) {
        return;
      }
    }
    setSubmittedFlash(true);
    void Promise.resolve(onSubmit(values));
  };

  return (
    <div className="space-y-3 rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        {projectId ? (
          <span className="rounded-full bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-600 dark:text-slate-400">
            project:{projectId}
          </span>
        ) : null}
      </div>
      <div className="space-y-3">
        {parsed.fields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            disabled={disabled}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={handleSubmit}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="size-3.5" aria-hidden />
        {buttonLabel}
      </button>
    </div>
  );
}
