/**
 * Embeds (YouTube, Figma, any web page, code) and live polls. Both store a small JSON spec;
 * this module validates it (untrusted) and draws the card. Embeds go live as an iframe over
 * the card (see ui/Embeds.tsx); a poll's votes are per-voter keys on the shape, so everyone
 * votes at once without overwriting each other.
 */
import { esc, FONT, n1, textLines, wrapText } from "./svg-kit";

export type EmbedType = "youtube" | "figma" | "web" | "code";

export interface EmbedSpec {
  readonly type: EmbedType;
  readonly url: string;
  readonly title: string;
  readonly code: string;
  readonly language: string;
}

const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Only https pages (and a YouTube id) may load; everything else is shown, never framed. */
export function embedSrc(spec: EmbedSpec): string | undefined {
  if (spec.type === "code") return undefined;
  let u: URL;
  try {
    u = new URL(spec.url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:") return undefined;
  if (spec.type === "youtube") {
    const id = u.hostname.includes("youtu.be") ? u.pathname.slice(1) : (u.searchParams.get("v") ?? u.pathname.split("/").pop() ?? "");
    return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : undefined;
  }
  if (spec.type === "figma") return `https://www.figma.com/embed?embed_host=tandem&url=${encodeURIComponent(u.toString())}`;
  return u.toString();
}

/** Recognise what a pasted link is. */
export function embedFromUrl(url: string): EmbedSpec | undefined {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:") return undefined;
  const host = u.hostname.replace(/^www\./, "");
  const type: EmbedType = host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com" ? "youtube" : host === "figma.com" ? "figma" : "web";
  return { type, url: u.toString(), title: type === "youtube" ? "YouTube video" : type === "figma" ? "Figma file" : host, code: "", language: "" };
}

export function parseEmbed(data: string | undefined): EmbedSpec | undefined {
  if (!data) return undefined;
  try {
    const r = JSON.parse(data) as Record<string, unknown>;
    const type = (["youtube", "figma", "web", "code"] as const).includes(r.type as EmbedType) ? (r.type as EmbedType) : "web";
    return { type, url: clean(r.url, 600), title: clean(r.title, 80), code: clean(r.code, 6000), language: clean(r.language, 20).toLowerCase() };
  } catch {
    return undefined;
  }
}

// --- code highlighting --------------------------------------------------------------

const KEYWORDS = new Set(
  "abstract as async await break case catch class const continue def default del delete do elif else enum export extends false final finally for from fn func function go if impl import in interface is lambda let match mod mut new nil none not null of or package pass private protected pub public raise return self static struct super switch this throw true try type typeof use var void while with yield".split(" "),
);
const TOKEN = /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b|[^\sA-Za-z_\d"'`/#]+|\s+|\/)/g;

/** One line of code as coloured tspans. */
export function highlight(line: string): Array<{ text: string; color: string }> {
  const out: Array<{ text: string; color: string }> = [];
  for (const m of line.matchAll(TOKEN)) {
    const t = m[0];
    const color = /^(\/\/|#|\/\*)/.test(t) ? "#6b7590" : /^["'`]/.test(t) ? "#9ee493" : /^\d/.test(t) ? "#ffb547" : KEYWORDS.has(t) ? "#c792ea" : /^[A-Z]/.test(t) ? "#82aaff" : /^[A-Za-z_]/.test(t) ? "#e6e9f2" : "#89ddff";
    out.push({ text: t, color });
  }
  return out;
}

export function embedSvg(spec: EmbedSpec, w: number, h: number): string {
  const head = 40;
  if (spec.type === "code") {
    const lines = spec.code.replace(/\t/g, "  ").split("\n").slice(0, 60);
    const size = Math.max(10, Math.min(15, (h - head - 20) / Math.max(10, lines.length) / 1.45));
    const lh = size * 1.45;
    const rows = lines
      .map((line, i) => {
        const y = head + 18 + i * lh + size;
        if (y > h - 8) return "";
        const spans = highlight(line)
          .map((t) => `<tspan fill="${t.color}">${esc(t.text)}</tspan>`)
          .join("");
        return `<text x="${n1(16 + size * 2.4)}" y="${n1(y)}" font-family="Consolas, 'JetBrains Mono', monospace" font-size="${n1(size)}" xml:space="preserve">${spans}</text><text x="${n1(10 + size * 1.6)}" y="${n1(y)}" text-anchor="end" font-family="Consolas, monospace" font-size="${n1(size)}" fill="#4b5370">${i + 1}</text>`;
      })
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 ${n1(w)} ${n1(h)}"><rect width="${n1(w)}" height="${n1(h)}" rx="14" fill="#0f1220"/><rect width="${n1(w)}" height="${head}" rx="14" fill="#171b2e"/><rect y="${head - 14}" width="${n1(w)}" height="14" fill="#171b2e"/>${["#ff5f57", "#febc2e", "#28c840"].map((c, i) => `<circle cx="${18 + i * 18}" cy="20" r="6" fill="${c}"/>`).join("")}${textLines([spec.title || spec.language || "code"], w - 16, 25, { size: 12, fill: "#8b93b0", weight: 700, anchor: "end" })}${rows}</svg>`;
  }
  const brand = spec.type === "youtube" ? "#ff3d3d" : spec.type === "figma" ? "#a259ff" : "#2f63ff";
  const label = spec.type === "youtube" ? "YouTube" : spec.type === "figma" ? "Figma" : "Web page";
  const cx = w / 2;
  const cy = (h + head) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 ${n1(w)} ${n1(h)}"><defs><linearGradient id="eg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14182a"/><stop offset="1" stop-color="${brand}" stop-opacity="0.35"/></linearGradient></defs><rect width="${n1(w)}" height="${n1(h)}" rx="16" fill="url(#eg)"/><rect width="${n1(w)}" height="${head}" rx="16" fill="#0d1020" fill-opacity="0.7"/><circle cx="20" cy="20" r="7" fill="${brand}"/>${textLines([label], 34, 25, { size: 12, fill: "#ffffff", weight: 800 })}${textLines(wrapText(spec.title || spec.url, w - 140, 12, 500, 1), w - 14, 25, { size: 12, fill: "#aab2cf", anchor: "end" })}<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(Math.min(42, h / 6))}" fill="${brand}"/><polygon points="${n1(cx - 12)},${n1(cy - 16)} ${n1(cx + 18)},${n1(cy)} ${n1(cx - 12)},${n1(cy + 16)}" fill="#ffffff"/>${textLines(["Double-click to open"], cx, cy + Math.min(42, h / 6) + 26, { size: 13, fill: "#d6dbef", weight: 600, anchor: "middle" })}</svg>`;
}

// --- polls ---------------------------------------------------------------------------

export interface PollSpec {
  readonly question: string;
  readonly options: readonly string[];
}

export function parsePoll(data: string | undefined): PollSpec | undefined {
  if (!data) return undefined;
  try {
    const r = JSON.parse(data) as Record<string, unknown>;
    const options = (Array.isArray(r.options) ? r.options : []).slice(0, 6).flatMap((o) => (typeof o === "string" && o.trim() ? [o.trim().slice(0, 60)] : []));
    if (options.length < 2) return undefined;
    return { question: clean(r.question, 140) || "Quick poll", options };
  } catch {
    return undefined;
  }
}

/** Votes are voter keys "<clientId>#<option>"; each person's latest choice counts once. */
export function tally(spec: PollSpec, voters: readonly string[] | undefined): { counts: number[]; total: number; mine: (me: string) => number | undefined } {
  const counts = spec.options.map(() => 0);
  const byVoter = new Map<string, number>();
  for (const v of voters ?? []) {
    const at = v.lastIndexOf("#");
    const who = v.slice(0, at);
    const k = Number(v.slice(at + 1));
    if (at <= 0 || !Number.isInteger(k) || k < 0 || k >= counts.length) continue;
    // A voter's highest option wins if they somehow have two (switching is off-then-on).
    byVoter.set(who, Math.max(byVoter.get(who) ?? -1, k));
  }
  for (const k of byVoter.values()) counts[k] = (counts[k] ?? 0) + 1;
  return { counts, total: byVoter.size, mine: (me) => byVoter.get(me) };
}

const POLL_COLORS = ["#5b8cff", "#ff7a59", "#22c3a6", "#b36bff", "#ffb547", "#ff5c8a"];

export function pollSvg(spec: PollSpec, voters: readonly string[] | undefined, w: number, h: number): string {
  const { counts, total } = tally(spec, voters);
  const pad = 22;
  const qLines = wrapText(spec.question, w - pad * 2, 20, 800, 2);
  const top = pad + qLines.length * 24 + 26;
  const rowH = Math.min(58, (h - top - 40) / spec.options.length);
  const max = Math.max(1, ...counts);
  const rows = spec.options
    .map((o, i) => {
      const y = top + i * rowH;
      const c = counts[i] ?? 0;
      const pct = total ? Math.round((c / total) * 100) : 0;
      const bw = (w - pad * 2) * (c / max);
      const color = POLL_COLORS[i % POLL_COLORS.length] ?? "#5b8cff";
      return `<rect x="${pad}" y="${n1(y)}" width="${n1(w - pad * 2)}" height="${n1(rowH - 10)}" rx="12" fill="#ffffff" fill-opacity="0.06"/><rect x="${pad}" y="${n1(y)}" width="${n1(Math.max(c ? 12 : 0, bw))}" height="${n1(rowH - 10)}" rx="12" fill="${color}" fill-opacity="0.85" class="a-growx" style="--d:${i * 80}ms"/>${textLines(wrapText(o, w - pad * 2 - 90, 15, 700, 1), pad + 14, y + (rowH - 10) / 2 + 5, { size: 15, fill: "#ffffff", weight: 700 })}${textLines([`${pct}% · ${c}`], w - pad - 12, y + (rowH - 10) / 2 + 5, { size: 13, fill: "#ffffff", weight: 800, anchor: "end" })}`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n1(w)}" height="${n1(h)}" viewBox="0 0 ${n1(w)} ${n1(h)}" font-family="${FONT}"><defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151a35"/><stop offset="1" stop-color="#2a1745"/></linearGradient></defs><rect width="${n1(w)}" height="${n1(h)}" rx="18" fill="url(#pg)"/>${textLines(["LIVE POLL"], pad, pad + 10, { size: 11, fill: "#ff7a59", weight: 800, letterSpacing: 2 })}${textLines(qLines, pad, pad + 36, { size: 20, fill: "#ffffff", weight: 800, lineHeight: 24 })}${rows}${textLines([`${total} vote${total === 1 ? "" : "s"} · double-click to vote`], pad, h - 16, { size: 12, fill: "#aab2cf", weight: 600 })}</svg>`;
}
