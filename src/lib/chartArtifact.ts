/**
 * Polished HTML/SVG charts from vegaLite `data.values` or raw row arrays.
 */

type ChartRow = Record<string, unknown>;

type ChartDataset = {
  rows: ChartRow[];
  numericKey: string;
  categoryKey: string;
  seriesKey?: string;
};

type ChartKind = "groupedBar" | "bar" | "line";

const SERIES_COLORS = [
  "#4f46e5",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
];

const CHART_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 14px;
    font-family: "Segoe UI", system-ui, sans-serif;
    color: #0f172a;
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  }
  .card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
    padding: 16px 16px 12px;
  }
  h1 {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0 0 2px;
    letter-spacing: -0.01em;
  }
  .subtitle {
    font-size: 11px;
    color: #64748b;
    margin: 0 0 12px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    margin-top: 10px;
    font-size: 11px;
    color: #475569;
  }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  table.data {
    width: 100%;
    border-collapse: collapse;
    margin-top: 14px;
    font-size: 11px;
  }
  table.data th, table.data td {
    border: 1px solid #e2e8f0;
    padding: 6px 8px;
    text-align: left;
  }
  table.data th {
    background: #f1f5f9;
    font-weight: 600;
    color: #334155;
  }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; }
  svg text { font-family: "Segoe UI", system-ui, sans-serif; }
`;

function humanizeFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizeVegaRows(rows: unknown[]): ChartRow[] {
  return rows
    .filter((r): r is ChartRow => r !== null && typeof r === "object")
    .map((row) => {
      const out: ChartRow = { ...row };
      for (const [k, v] of Object.entries(out)) {
        const n = toNumber(v);
        if (n !== null && typeof v === "string") out[k] = n;
      }
      return out;
    });
}

function extractVegaLiteValues(spec: Record<string, unknown>): ChartRow[] | null {
  const data = spec.data;
  if (data && typeof data === "object") {
    const values = (data as { values?: unknown }).values;
    if (Array.isArray(values) && values.length > 0) {
      return normalizeVegaRows(values);
    }
  }
  const layers = spec.layer;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (layer && typeof layer === "object") {
        const nested = extractVegaLiteValues(layer as Record<string, unknown>);
        if (nested?.length) return nested;
      }
    }
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const match = cleaned.match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function formatChartValue(n: number, numericKey: string): string {
  const k = numericKey.toLowerCase();
  if (k.includes("gdp") || k.includes("trillion") || k.includes("billion")) {
    return n.toFixed(1);
  }
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function seriesColor(name: string, index: number): string {
  const lower = name.toLowerCase();
  if (lower.includes("china")) return "#dc2626";
  if (lower.includes("usa") || lower.includes("u.s.") || lower === "us") return "#2563eb";
  return SERIES_COLORS[index % SERIES_COLORS.length]!;
}

function inferDataset(values: ChartRow[]): ChartDataset | null {
  if (!values.length) return null;
  const sample = values[0]!;
  const keys = Object.keys(sample);
  const numericKey = keys.find((k) => toNumber(sample[k]) !== null);
  if (!numericKey) return null;

  const categoryKeys = keys.filter((k) => k !== numericKey);
  const categoryKey =
    categoryKeys.find((k) => /year|date|day|month|week|period|time/i.test(k)) ??
    categoryKeys.find((k) => typeof sample[k] === "string") ??
    categoryKeys[0] ??
    "category";

  const seriesKey = categoryKeys.find(
    (k) =>
      k !== categoryKey &&
      /country|series|name|group|region|category|type|label/i.test(k),
  );

  return {
    rows: values,
    numericKey,
    categoryKey,
    seriesKey: seriesKey && seriesKey !== categoryKey ? seriesKey : undefined,
  };
}

function inferChartKind(
  spec: Record<string, unknown>,
  dataset: ChartDataset,
): ChartKind {
  const mark = spec.mark;
  const markType =
    typeof mark === "string"
      ? mark
      : mark && typeof mark === "object"
        ? String((mark as { type?: string }).type ?? "")
        : "";

  if (markType === "line" || markType === "area") return "line";
  if (dataset.seriesKey && dataset.categoryKey) return "groupedBar";
  if (markType === "bar") return "bar";

  const categories = new Set(dataset.rows.map((r) => String(r[dataset.categoryKey] ?? "")));
  if (categories.size >= 3 && !dataset.seriesKey) return "line";
  return "bar";
}

function niceTicks(max: number, count = 5): number[] {
  if (max <= 0) return [0];
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const err = max / step;
  let niceStep = step;
  if (err <= 1) niceStep = step / 5;
  else if (err <= 2) niceStep = step / 2;
  else if (err <= 5) niceStep = step;
  else niceStep = step * 2;

  const ticks: number[] = [];
  for (let v = 0; v <= max * 1.05; v += niceStep) {
    ticks.push(Math.round(v * 1000) / 1000);
    if (ticks.length > count + 1) break;
  }
  if (ticks[ticks.length - 1]! < max) ticks.push(Math.ceil(max / niceStep) * niceStep);
  return ticks;
}

function buildDataTable(dataset: ChartDataset): string {
  const cols = [
    dataset.categoryKey,
    ...(dataset.seriesKey ? [dataset.seriesKey] : []),
    dataset.numericKey,
  ];
  const header = cols.map((c) => `<th>${escapeHtml(humanizeFieldName(c))}</th>`).join("");
  const body = dataset.rows
    .map((row) => {
      const cells = cols
        .map((c) => {
          const raw = row[c];
          const isNum = c === dataset.numericKey;
          const n = toNumber(raw);
          const text = isNum && n !== null ? formatChartValue(n, dataset.numericKey) : String(raw ?? "");
          const cls = isNum ? ' class="num"' : "";
          return `<td${cls}>${escapeHtml(text)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table class="data"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildLegend(seriesNames: string[]): string {
  if (seriesNames.length <= 1) return "";
  return `<div class="legend">${seriesNames
    .map(
      (name, i) =>
        `<span class="legend-item"><span class="swatch" style="background:${seriesColor(name, i)}"></span>${escapeHtml(name)}</span>`,
    )
    .join("")}</div>`;
}

function buildSvgGroupedBarChart(dataset: ChartDataset, yLabel: string): string {
  const W = 400;
  const H = 220;
  const pad = { top: 16, right: 12, bottom: 36, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const categories = [...new Set(dataset.rows.map((r) => String(r[dataset.categoryKey] ?? "")))];
  const seriesNames = [
    ...new Set(
      dataset.rows.map((r) =>
        dataset.seriesKey ? String(r[dataset.seriesKey] ?? "") : "Value",
      ),
    ),
  ].filter(Boolean);

  const maxVal = Math.max(...dataset.rows.map((r) => toNumber(r[dataset.numericKey]) ?? 0), 1);
  const ticks = niceTicks(maxVal);
  const yMax = ticks[ticks.length - 1] ?? maxVal;

  const groupW = innerW / Math.max(categories.length, 1);
  const barW = Math.min(22, (groupW / Math.max(seriesNames.length, 1)) * 0.72);

  const gridAndY: string[] = [];
  for (const tick of ticks) {
    const y = pad.top + innerH - (tick / yMax) * innerH;
    gridAndY.push(
      `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`,
    );
    gridAndY.push(
      `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="#64748b">${escapeHtml(formatChartValue(tick, dataset.numericKey))}</text>`,
    );
  }

  const bars: string[] = [];
  categories.forEach((cat, ci) => {
    const gx = pad.left + ci * groupW + groupW / 2;
    seriesNames.forEach((series, si) => {
      const row = dataset.rows.find(
        (r) =>
          String(r[dataset.categoryKey] ?? "") === cat &&
          (!dataset.seriesKey || String(r[dataset.seriesKey!] ?? "") === series),
      );
      const val = row ? (toNumber(row[dataset.numericKey]) ?? 0) : 0;
      const h = Math.max(2, (val / yMax) * innerH);
      const x = gx - (seriesNames.length * barW) / 2 + si * barW + barW * 0.12;
      const y = pad.top + innerH - h;
      const color = seriesColor(series, si);
      bars.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}" opacity="0.92"/>`,
      );
      bars.push(
        `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="600" fill="#334155">${escapeHtml(formatChartValue(val, dataset.numericKey))}</text>`,
      );
    });
    const lx = pad.left + ci * groupW + groupW / 2;
    bars.push(
      `<text x="${lx}" y="${H - 12}" text-anchor="middle" font-size="9" font-weight="600" fill="#475569">${escapeHtml(cat)}</text>`,
    );
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${escapeHtml(yLabel)} chart">
    ${gridAndY.join("")}
    <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="#94a3b8" stroke-width="1.5"/>
    ${bars.join("")}
  </svg>`;
}

function buildSvgBarChart(dataset: ChartDataset, yLabel: string): string {
  const W = 400;
  const H = 220;
  const pad = { top: 16, right: 12, bottom: 40, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const categories = [...new Set(dataset.rows.map((r) => String(r[dataset.categoryKey] ?? "")))];
  const maxVal = Math.max(...dataset.rows.map((r) => toNumber(r[dataset.numericKey]) ?? 0), 1);
  const ticks = niceTicks(maxVal);
  const yMax = ticks[ticks.length - 1] ?? maxVal;
  const barW = Math.min(36, (innerW / Math.max(categories.length, 1)) * 0.55);

  const parts: string[] = [];
  for (const tick of ticks) {
    const y = pad.top + innerH - (tick / yMax) * innerH;
    parts.push(
      `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="#64748b">${escapeHtml(formatChartValue(tick, dataset.numericKey))}</text>`,
    );
  }

  categories.forEach((cat, i) => {
    const row = dataset.rows.find((r) => String(r[dataset.categoryKey] ?? "") === cat);
    const val = row ? (toNumber(row[dataset.numericKey]) ?? 0) : 0;
    const h = Math.max(2, (val / yMax) * innerH);
    const cx = pad.left + (i + 0.5) * (innerW / categories.length);
    const x = cx - barW / 2;
    const y = pad.top + innerH - h;
    const color = seriesColor(cat, i);
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="4" fill="${color}" opacity="0.9"/>`,
    );
    parts.push(
      `<text x="${cx}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="600" fill="#334155">${escapeHtml(formatChartValue(val, dataset.numericKey))}</text>`,
    );
    parts.push(
      `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="9" font-weight="600" fill="#475569">${escapeHtml(cat)}</text>`,
    );
  });

  parts.push(
    `<line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="#94a3b8" stroke-width="1.5"/>`,
  );

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${escapeHtml(yLabel)} chart">${parts.join("")}</svg>`;
}

function buildSvgLineChart(dataset: ChartDataset, yLabel: string): string {
  const W = 400;
  const H = 220;
  const pad = { top: 16, right: 12, bottom: 40, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const categories = [...new Set(dataset.rows.map((r) => String(r[dataset.categoryKey] ?? "")))];
  const seriesNames = dataset.seriesKey
    ? [...new Set(dataset.rows.map((r) => String(r[dataset.seriesKey!] ?? "")))].filter(Boolean)
    : ["Value"];

  const maxVal = Math.max(...dataset.rows.map((r) => toNumber(r[dataset.numericKey]) ?? 0), 1);
  const ticks = niceTicks(maxVal);
  const yMax = ticks[ticks.length - 1] ?? maxVal;

  const parts: string[] = [];
  for (const tick of ticks) {
    const y = pad.top + innerH - (tick / yMax) * innerH;
    parts.push(
      `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${pad.left - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="#64748b">${escapeHtml(formatChartValue(tick, dataset.numericKey))}</text>`,
    );
  }

  const xStep = innerW / Math.max(categories.length - 1, 1);

  seriesNames.forEach((series, si) => {
    const color = seriesColor(series, si);
    const points: { x: number; y: number; val: number; cat: string }[] = [];
    categories.forEach((cat, ci) => {
      const row = dataset.rows.find(
        (r) =>
          String(r[dataset.categoryKey] ?? "") === cat &&
          (!dataset.seriesKey || String(r[dataset.seriesKey!] ?? "") === series),
      );
      const val = row ? (toNumber(row[dataset.numericKey]) ?? 0) : 0;
      const x = pad.left + ci * xStep;
      const y = pad.top + innerH - (val / yMax) * innerH;
      points.push({ x, y, val, cat });
    });
    if (points.length < 2) return;
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    for (const p of points) {
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#fff" stroke="${color}" stroke-width="2"/>`);
      parts.push(
        `<text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="600" fill="#334155">${escapeHtml(formatChartValue(p.val, dataset.numericKey))}</text>`,
      );
    }
  });

  categories.forEach((cat, ci) => {
    const x = pad.left + ci * xStep;
    parts.push(
      `<text x="${x}" y="${H - 10}" text-anchor="middle" font-size="9" font-weight="600" fill="#475569">${escapeHtml(cat)}</text>`,
    );
  });

  parts.push(
    `<line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="#94a3b8" stroke-width="1.5"/>`,
  );

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${escapeHtml(yLabel)} chart">${parts.join("")}</svg>`;
}

export function buildChartHtmlDocument(
  spec: Record<string, unknown>,
  title: string,
): string | null {
  const values = extractVegaLiteValues(spec);
  if (!values?.length) return null;

  const dataset = inferDataset(values);
  if (!dataset) return null;

  const yLabel = humanizeFieldName(dataset.numericKey);
  const xLabel = humanizeFieldName(dataset.categoryKey);
  const kind = inferChartKind(spec, dataset);

  const seriesNames = dataset.seriesKey
    ? [...new Set(dataset.rows.map((r) => String(r[dataset.seriesKey!] ?? "")))].filter(Boolean)
    : [];

  let svg = "";
  if (kind === "line") svg = buildSvgLineChart(dataset, yLabel);
  else if (kind === "groupedBar" && dataset.seriesKey) svg = buildSvgGroupedBarChart(dataset, yLabel);
  else svg = buildSvgBarChart(dataset, yLabel);

  const table = buildDataTable(dataset);
  const legend = buildLegend(seriesNames);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CHART_STYLES}</style></head><body>
<div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${escapeHtml(yLabel)} by ${escapeHtml(xLabel)}</p>
  ${svg}
  ${legend}
  ${table}
</div>
</body></html>`;
}
