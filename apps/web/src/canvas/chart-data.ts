import { fmt } from "./charts";

/** Spreadsheet paste: tab- or comma-separated, first row may be headers. */
export function parseTable(text: string): { labels: string[]; series: Array<{ name: string; values: number[] }> } | undefined {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(line.includes("\t") ? "\t" : ",").map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
  if (rows.length === 0) return undefined;
  const num = (c: string): number => Number(c.replace(/[^0-9.\-eE]/g, ""));
  const first = rows[0] ?? [];
  const header = first.slice(1).some((c) => c !== "" && !Number.isFinite(num(c)));
  const body = header ? rows.slice(1) : rows;
  const width = Math.max(2, ...rows.map((r) => r.length));
  const names = header ? first.slice(1) : Array.from({ length: width - 1 }, (_, i) => `Series ${i + 1}`);
  const series = names.slice(0, 4).map((name, k) => ({ name: name || `Series ${k + 1}`, values: body.map((r) => (Number.isFinite(num(r[k + 1] ?? "")) ? num(r[k + 1] ?? "") : 0)) }));
  const labels = body.map((r, i) => r[0] || `#${i + 1}`).slice(0, 12);
  if (labels.length === 0 || series.length === 0) return undefined;
  return { labels, series: series.map((s) => ({ ...s, values: s.values.slice(0, 12) })) };
}

/** Headline numbers worked out from the data: total, best label, growth first → last. */
export function autoKpis(labels: readonly string[], series: ReadonlyArray<{ name: string; values: readonly number[] }>, unit: string): Array<{ label: string; value: string; delta: string }> {
  const s = series[0];
  if (!s || s.values.length === 0) return [];
  const total = s.values.reduce((a, b) => a + b, 0);
  const max = Math.max(...s.values);
  const best = s.values.indexOf(max);
  const first = s.values[0] ?? 0;
  const last = s.values[s.values.length - 1] ?? 0;
  const growth = first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 100) : 0;
  return [
    { label: `Total ${s.name}`.slice(0, 32), value: fmt(total, unit), delta: `${s.values.length} points` },
    { label: "Best", value: labels[best] ?? "—", delta: fmt(max, unit) },
    { label: `${labels[0] ?? "Start"} → ${labels[labels.length - 1] ?? "end"}`.slice(0, 32), value: `${growth >= 0 ? "+" : ""}${growth}%`, delta: `${growth >= 0 ? "+" : ""}${fmt(last - first, unit)}` },
  ];
}

