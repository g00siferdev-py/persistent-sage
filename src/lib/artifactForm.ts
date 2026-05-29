/** Form artifact field definitions (mirrors OpenSage backend validation). */

export type FormFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "select"
  | "radio";

export type FormFieldDef = {
  id: string;
  label: string;
  kind?: FormFieldKind;
  default?: string | number | boolean;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export type FormArtifactBody = {
  submitLabel?: string;
  fields: FormFieldDef[];
};

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
    fields.push({
      id,
      label,
      kind,
      default: o.default as string | number | boolean | undefined,
      required: Boolean(o.required),
      placeholder: o.placeholder ? String(o.placeholder) : undefined,
      options: Array.isArray(o.options) ? o.options.map(String) : undefined,
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
