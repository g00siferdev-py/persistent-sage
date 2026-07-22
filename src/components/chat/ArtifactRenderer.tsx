import { useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  artifactBodyString,
  buildChartHtmlFromArtifactBody,
  parseArtifactJson,
} from "@/lib/artifacts";
import { getStoredTheme } from "@/lib/theme";
import { FormArtifact } from "@/components/chat/FormArtifact";

export type ArtifactCitationsModel = {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  label?: string;
};

export type ArtifactRendererProps = {
  artifactJson: string;
  disabled?: boolean;
  companionName?: string;
  onSubmitArtifactForm?: (
    artifactTitle: string,
    projectId: string | undefined,
    values: Record<string, unknown>,
  ) => void;
};

function truncateArtifactCaption(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function sanitizeArtifactHtml(raw: string): string {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
  s = s.replace(/\s(href|src)\s*=\s*(['"])\s*https?:\/\/.*?\2/gi, "");
  return s;
}

function artifactIframeSrcDoc(title: string, html: string, theme: "light" | "dark"): string {
  const safe = sanitizeArtifactHtml(html);
  const isDark = theme === "dark";
  const bodyBg = isDark ? "#0f172a" : "#f8fafc";
  const bodyColor = isDark ? "#e2e8f0" : "#0f172a";
  const thBg = isDark ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.25)";
  const border = isDark ? "rgba(100,116,139,0.35)" : "rgba(148,163,184,0.55)";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/</g, "&lt;")}</title>
    <style>
      :root { color-scheme: ${theme}; }
      html, body { background: ${bodyBg}; color: ${bodyColor}; }
      body { margin: 0; padding: 12px; font: 13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif; }
      h1,h2,h3 { margin: 0.6rem 0 0.4rem; color: inherit; }
      p { margin: 0.4rem 0; }
      pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace; }
      pre { white-space: pre-wrap; background: ${isDark ? "#1e293b" : "#f1f5f9"}; padding: 8px; border-radius: 6px; }
      table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; font-size: 12px; color: inherit; }
      th, td { border: 1px solid ${border}; padding: 6px 8px; vertical-align: top; }
      th { background: ${thBg}; font-weight: 600; }
      svg { max-width: 100%; height: auto; display: block; margin: 0.75rem 0; }
      .chart, .chart-wrap, .card { margin: 0.5rem 0; }
      a { color: ${isDark ? "#93c5fd" : "#2563eb"}; }
    </style>
  </head>
  <body>${safe}</body>
</html>`;
}

/** @deprecated Use CopyButton from @/components/ui/CopyButton */
export function ArtifactCopyButton({ text, label }: { text: string; label?: string }) {
  return <CopyButton text={text} label={label} />;
}

function ChartArtifact({
  body,
  title,
  theme,
}: {
  body: unknown;
  title: string;
  theme: "light" | "dark";
}) {
  const chartHtml = useMemo(
    () => buildChartHtmlFromArtifactBody(body, title, theme),
    [body, title, theme],
  );
  const rawJson = useMemo(
    () =>
      typeof body === "string"
        ? body
        : JSON.stringify(body, null, 2),
    [body],
  );

  if (chartHtml) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <CopyButton text={rawJson || chartHtml} label="Copy chart data" />
        </div>
        <div className="overflow-hidden rounded-lg border border-ps-border bg-ps-surface">
          <iframe
            title={title}
            sandbox=""
            referrerPolicy="no-referrer"
            className="h-[22rem] w-full"
            srcDoc={chartHtml}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs text-amber-950 dark:text-amber-100">
      <p className="font-semibold">Chart could not be drawn</p>
      <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
        The assistant did not include readable chart data (numeric values in{" "}
        <code className="rounded bg-black/10 px-1">data.values</code>). Ask again and
        mention you want a chart with explicit numbers, or request an HTML report with an
        inline chart.
      </p>
    </div>
  );
}

function ArtifactCitations({ citations }: { citations: ArtifactCitationsModel[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {citations.slice(0, 8).map((c) => {
        const range =
          typeof c.lineStart === "number" && typeof c.lineEnd === "number"
            ? `:${c.lineStart}-${c.lineEnd}`
            : typeof c.lineStart === "number"
              ? `:${c.lineStart}`
              : "";
        const text = c.label?.trim() || `${c.path}${range}`;
        return (
          <button
            key={`${c.path}${range}${text}`}
            type="button"
            onClick={() => {
              void invoke("open_path", { path: c.path });
            }}
            className="rounded-md border border-ps-border bg-ps-surface px-2.5 py-1 text-[11px] font-semibold text-ps-ink hover:bg-ps-elevated"
            title={c.path}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function ArtifactRenderer({
  artifactJson,
  disabled,
  companionName,
  onSubmitArtifactForm,
}: ArtifactRendererProps) {
  const theme = getStoredTheme();
  const artifact = useMemo(() => parseArtifactJson(artifactJson), [artifactJson]);
  if (!artifact) return null;

  if (artifact.type === "form") {
    return (
      <div className="space-y-2">
        <FormArtifact
          title={artifact.title}
          body={artifact.body}
          projectId={artifact.projectId}
          companionName={companionName || "Agent"}
          disabled={disabled ?? false}
          onSubmit={(values) =>
            onSubmitArtifactForm?.(artifact.title, artifact.projectId, values)
          }
        />
      </div>
    );
  }

  if (
    artifact.type === "vegaLite" ||
    artifact.type.toLowerCase() === "vegalite" ||
    artifact.type === "chart"
  ) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ps-muted">
            {artifact.title}
          </p>
          {artifact.caption ? (
            <p className="text-[11px] text-ps-faint">
              {truncateArtifactCaption(artifact.caption, 80)}
            </p>
          ) : null}
        </div>
        <ChartArtifact body={artifact.body} title={artifact.title} theme={theme} />
        {artifact.citations?.length ? <ArtifactCitations citations={artifact.citations} /> : null}
      </div>
    );
  }

  if (artifact.type !== "html") {
    const rawBody = artifactBodyString(artifact.body);
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ps-muted">
            Artifact: {artifact.title}
          </p>
          <CopyButton text={rawBody} label={`Copy ${artifact.title}`} />
        </div>
        <pre className="whitespace-pre-wrap rounded-lg border border-ps-border bg-ps-elevated p-2 text-xs text-ps-ink">
          {rawBody}
        </pre>
        {artifact.citations?.length ? <ArtifactCitations citations={artifact.citations} /> : null}
      </div>
    );
  }

  const html =
    typeof artifact.body === "string" ? artifact.body : artifactBodyString(artifact.body);
  if (!html.trim()) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ps-muted">
          {artifact.title}
        </p>
        <div className="flex items-center gap-2">
          <CopyButton text={html} label={`Copy ${artifact.title}`} />
          {artifact.caption ? (
            <p className="text-[11px] text-ps-faint">
              {truncateArtifactCaption(artifact.caption, 80)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-ps-border bg-white dark:bg-ps-canvas">
        <iframe
          title={artifact.title}
          sandbox=""
          referrerPolicy="no-referrer"
          className="h-80 w-full"
          srcDoc={artifactIframeSrcDoc(artifact.title, html, theme)}
        />
      </div>
      {artifact.citations?.length ? <ArtifactCitations citations={artifact.citations} /> : null}
    </div>
  );
}
