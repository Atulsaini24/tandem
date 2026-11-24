import { autoKpis, parseTable } from "./chart-data";
import type { ChartType } from "./charts";

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const TIMEY = (label: string): boolean => MONTHS.test(label) || /^(q[1-4]|w\d+|week|day|19\d\d|20\d\d|fy)/i.test(label) || /^\d{4}-\d{2}/.test(label) || /^\d{1,2}[/.-]\d{1,2}/.test(label);

/** Pick the chart that suits a table: time → line/area, parts → donut, long names → ranking. */
export function guessChartType(labels: readonly string[], series: ReadonlyArray<{ values: readonly number[] }>): ChartType {
  const timey = labels.filter(TIMEY).length >= Math.ceil(labels.length * 0.6);
  if (timey) return series.length === 1 ? "area" : "line";
  const first = series[0]?.values ?? [];
  const total = first.reduce((a, b) => a + b, 0);
  if (series.length === 1 && labels.length <= 7 && first.every((v) => v >= 0) && (Math.abs(total - 100) < 2 || labels.length <= 5)) return "donut";
  if (series.length === 1 && (labels.length > 6 || labels.some((l) => l.length > 12))) return "hbar";
  if (series.length >= 3 && labels.length <= 8) return "stacked";
  return "bar";
}

const titleFrom = (name: string): string =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase()) || "Imported data";

/** A chart spec from a pasted or dropped table, or undefined when it isn't a table. */
export function chartFromTable(text: string, fileName = "data.csv"): Record<string, unknown> | undefined {
  const table = parseTable(text);
  if (!table || table.series.every((s) => s.values.every((v) => v === 0))) return undefined;
  const type = guessChartType(table.labels, table.series);
  const unit = /(\$|usd|revenue|price|cost)/i.test(text.split(/\r?\n/)[0] ?? "") ? "$" : /%|percent|share/i.test(text.split(/\r?\n/)[0] ?? "") ? "%" : "";
  return {
    type,
    title: titleFrom(fileName),
    unit,
    note: `From ${fileName} · ${table.labels.length} rows`,
    labels: table.labels,
    series: table.series,
    kpis: autoKpis(table.labels, table.series, unit),
    insight: "",
  };
}
