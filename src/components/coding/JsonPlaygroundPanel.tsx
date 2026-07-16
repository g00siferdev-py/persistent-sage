import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Minimize2,
  Sparkles,
} from "lucide-react";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { CopyButton } from "@/components/ui/CopyButton";

const DEFAULT_JSON = `{
  "name": "Persistent Sage",
  "version": "2.1.0",
  "features": ["favorites", "moltbook", "json-validator"],
  "localFirst": true,
  "stats": { "conversations": 42, "anchors": 128 }
}`;

type Validation =
  | { state: "empty" }
  | { state: "valid"; keys: number; depth: number; kind: string }
  | { state: "invalid"; message: string; line?: number; column?: number };

function describeValue(v: unknown): string {
  if (Array.isArray(v)) return `array (${v.length} items)`;
  if (v === null) return "null";
  if (typeof v === "object") return `object (${Object.keys(v as object).length} keys)`;
  return typeof v;
}

function countStats(v: unknown): { keys: number; depth: number } {
  if (v === null || typeof v !== "object") return { keys: 0, depth: 0 };
  let keys = 0;
  let depth = 0;
  const walk = (node: unknown, level: number) => {
    if (node === null || typeof node !== "object") return;
    depth = Math.max(depth, level);
    const entries = Array.isArray(node) ? node : Object.values(node as object);
    if (!Array.isArray(node)) keys += Object.keys(node as object).length;
    for (const child of entries) walk(child, level + 1);
  };
  walk(v, 1);
  return { keys, depth };
}

/** Map a `JSON.parse` "position N" error to a line/column in the source. */
function locateJsonError(text: string, message: string): { line?: number; column?: number } {
  const posMatch = /position (\d+)/i.exec(message);
  const lineColMatch = /line (\d+) column (\d+)/i.exec(message);
  if (lineColMatch) {
    return { line: Number(lineColMatch[1]), column: Number(lineColMatch[2]) };
  }
  if (!posMatch) return {};
  const pos = Math.min(Number(posMatch[1]), text.length);
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const column = pos - before.lastIndexOf("\n");
  return { line, column };
}

/** JSON editor with live validation, error locations, and format/minify tools. */
export function JsonPlaygroundPanel() {
  const [text, setText] = useState(DEFAULT_JSON);
  const [indent, setIndent] = useState(2);

  const validation: Validation = useMemo(() => {
    if (!text.trim()) return { state: "empty" };
    try {
      const parsed = JSON.parse(text) as unknown;
      const { keys, depth } = countStats(parsed);
      return { state: "valid", keys, depth, kind: describeValue(parsed) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { state: "invalid", message, ...locateJsonError(text, message) };
    }
  }, [text]);

  const format = () => {
    try {
      setText(JSON.stringify(JSON.parse(text), null, indent));
    } catch {
      // invalid JSON — the status bar already shows why
    }
  };

  const minify = () => {
    try {
      setText(JSON.stringify(JSON.parse(text)));
    } catch {
      // invalid JSON — the status bar already shows why
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={format}
            disabled={validation.state !== "valid"}
            title="Pretty-print with the selected indent"
            className="flex items-center gap-1 rounded bg-violet-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            Format
          </button>
          <button
            type="button"
            onClick={minify}
            disabled={validation.state !== "valid"}
            title="Remove all whitespace"
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            <Minimize2 className="h-3 w-3" aria-hidden />
            Minify
          </button>
          <select
            value={indent}
            onChange={(e) => setIndent(Number(e.target.value))}
            title="Indent width for Format"
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-500"
          >
            <option value={2}>2 spaces</option>
            <option value={4}>4 spaces</option>
            <option value={8}>8 spaces</option>
          </select>
        </div>
        <CopyButton text={text} label="Copy JSON" size="sm" />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CodeEditor
          value={text}
          onChange={setText}
          language="json"
          placeholder="Paste or type JSON here…"
        />
      </div>

      <div
        className={`flex shrink-0 items-start gap-2 border-t px-3 py-2 text-xs ${
          validation.state === "invalid"
            ? "border-red-900/60 bg-red-950/30 text-red-300"
            : validation.state === "valid"
              ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-300"
              : "border-slate-800 bg-slate-900/60 text-slate-500"
        }`}
        role="status"
      >
        {validation.state === "valid" ? (
          <>
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Valid JSON — {validation.kind}, {validation.keys} keys total, max depth{" "}
              {validation.depth}.
            </span>
          </>
        ) : validation.state === "invalid" ? (
          <>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Invalid JSON
              {validation.line != null
                ? ` at line ${validation.line}${validation.column != null ? `, column ${validation.column}` : ""}`
                : ""}
              : {validation.message}
            </span>
          </>
        ) : (
          <>
            <Braces className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Paste or type JSON — validation runs live as you edit.</span>
          </>
        )}
      </div>
    </div>
  );
}
