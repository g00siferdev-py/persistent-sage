/** Form artifact field definitions (mirrors Persistent Sage backend validation). */

export type FormFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "select"
  | "radio";

export type FormOption = {
  value: string;
  label: string;
};

export type FormFieldDef = {
  id: string;
  label: string;
  kind?: FormFieldKind;
  default?: string | number | boolean;
  required?: boolean;
  placeholder?: string;
  /** Normalized select/radio choices (value + display label). */
  options?: FormOption[];
};

export type FormArtifactBody = {
  submitLabel?: string;
  fields: FormFieldDef[];
};

/** Accept strings or `{ label, value }` objects from the model. */
export function normalizeFormOptions(options: unknown[]): FormOption[] {
  const out: FormOption[] = [];
  for (let i = 0; i < options.length; i += 1) {
    const opt = options[i];
    if (typeof opt === "string" && opt.trim()) {
      const s = opt.trim();
      out.push({ value: s, label: s });
      continue;
    }
    if (typeof opt === "number" && !Number.isNaN(opt)) {
      const s = String(opt);
      out.push({ value: s, label: s });
      continue;
    }
    if (opt && typeof opt === "object") {
      const o = opt as Record<string, unknown>;
      const value = String(o.value ?? o.id ?? o.key ?? o.label ?? o.text ?? `option-${i + 1}`).trim();
      const label = String(
        o.label ?? o.text ?? o.title ?? o.name ?? o.value ?? value,
      ).trim();
      if (value && label) {
        out.push({ value, label });
      }
    }
  }
  return out;
}

export function parseFormArtifactBody(body: unknown): FormArtifactBody | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) return null;
  const fields: FormFieldDef[] = [];
  for (const f of raw.fields) {
    if (!f || typeof f !== "object") return null;
    const o = f as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const label = String(o.label ?? id).trim();
    if (!id) return null;
    const kind = (o.kind ? String(o.kind) : "text") as FormFieldKind;
    const options = Array.isArray(o.options) ? normalizeFormOptions(o.options) : undefined;
    if ((kind === "select" || kind === "radio") && (!options || options.length === 0)) {
      return null;
    }
    fields.push({
      id,
      label,
      kind,
      default: o.default as string | number | boolean | undefined,
      required: Boolean(o.required),
      placeholder: o.placeholder ? String(o.placeholder) : undefined,
      options,
    });
  }
  return {
    submitLabel: raw.submitLabel ? String(raw.submitLabel) : undefined,
    fields,
  };
}

export function initialFormValues(fields: FormFieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const kind = f.kind ?? "text";
    if (f.default !== undefined) {
      out[f.id] = f.default;
    } else if (kind === "checkbox") {
      out[f.id] = false;
    } else if (kind === "number") {
      out[f.id] = "";
    } else {
      out[f.id] = "";
    }
  }
  return out;
}
