import { useMemo, useState } from "react";
import { addEmbed, addPoll } from "../canvas/features";
import { embedFromUrl } from "../canvas/widgets";
import { CHART_THEMES, CHART_TYPE_NAMES, CHART_TYPES, chartSvg, parseChart, type ChartType } from "../canvas/charts";
import type { Editor } from "../canvas/editor";
import { sampleChart, SAMPLE_SLIDES } from "../canvas/samples";
import { SCENE_PRESETS } from "../canvas/scene-presets";
import { LAYOUT_INFO, parseSlide, SLIDE_H, SLIDE_LAYOUTS, SLIDE_THEMES, SLIDE_W, slideSvg, THEMES, type SlideLayout, type SlideThemeName } from "../canvas/slides";
import { useUiStore } from "../state/ui-store";

const Title = ({ children }: { children: string }) => <p className="px-1 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{children}</p>;

/**
 * Insert designed things by hand: a slide in any layout and theme, a chart of any type, a
 * ready-made 3D scene. Each lands in free space, selected, and builds in; double-click it
 * to edit in Studio.
 */
export function InsertPanel({ editor }: { editor: Editor | null }) {
  const dark = useUiStore((s) => s.theme === "dark");
  const [theme, setTheme] = useState<SlideThemeName>("midnight");
  const slides = useMemo(
    () =>
      SLIDE_LAYOUTS.map((l) => {
        const spec = parseSlide(JSON.stringify({ ...SAMPLE_SLIDES[l], layout: l, theme, index: 0, total: 0 }));
        return { l, svg: spec ? slideSvg(spec, 220, 124) : "" };
      }),
    [theme],
  );
  const charts = useMemo(
    () =>
      CHART_TYPES.map((t) => {
        const spec = parseChart(JSON.stringify({ ...sampleChart(t), title: "", note: "", kpis: [], insight: "" }));
        return { t, svg: spec ? chartSvg(spec, 200, 140, CHART_THEMES[dark ? "dark" : "light"]) : "" };
      }),
    [dark],
  );
  if (!editor) return null;

  const place = (w: number, h: number): { x: number; y: number } => {
    const c = editor.freeSpotCenter(w, h);
    return { x: c.x - w / 2, y: c.y - h / 2 };
  };
  const done = (id: string): void => {
    editor.select([id]);
    useUiStore.getState().reveal([id]);
  };
  const addSlide = (l: SlideLayout): void => {
    const { x, y } = place(SLIDE_W, SLIDE_H);
    const group = editor.beginGroup();
    editor.aiCreate({ kind: "frame", x, y, w: SLIDE_W, h: SLIDE_H, fill: 0x2f63ff, label: LAYOUT_INFO[l].name }, group);
    const sample = SAMPLE_SLIDES[l];
    const id = editor.aiCreate({ kind: "slide", x, y, w: SLIDE_W, h: SLIDE_H, fill: 0x111318, label: String(sample.title ?? "").replace(/\*/g, ""), data: JSON.stringify({ ...sample, layout: l, theme, deck: "", index: 0, total: 0 }) }, group);
    editor.renderer.fitTo({ x: x - 60, y: y - 80, w: SLIDE_W + 120, h: SLIDE_H + 140 }, 40, 0, 1, 700, true);
    done(id);
  };
  const addChart = (t: ChartType): void => {
    const data = sampleChart(t);
    const h = Array.isArray(data.kpis) && data.kpis.length > 0 ? 600 : 520;
    const { x, y } = place(860, h);
    const id = editor.aiCreate({ kind: "chart", x, y, w: 860, h, fill: 0x2f63ff, label: String(data.title), data: JSON.stringify(data) }, editor.beginGroup());
    editor.renderer.fitTo({ x: x - 60, y: y - 60, w: 980, h: h + 120 }, 40, 0, 1, 700, true);
    done(id);
  };
  const addScene = (presetId: string): void => {
    const preset = SCENE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const { x, y } = place(960, 600);
    const id = editor.aiCreate({ kind: "scene3d", x, y, w: 960, h: 600, fill: 0x111318, label: preset.spec.title, data: JSON.stringify(preset.spec) }, editor.beginGroup());
    editor.renderer.fitTo({ x: x - 60, y: y - 60, w: 1080, h: 720 }, 40, 0, 1, 700, true);
    editor.select([id]);
  };

  return (
    <div>
      <p className="px-1 pb-1 pt-1 text-[11px] leading-relaxed text-muted">Click to add. Double-click anything you add to edit it in Studio.</p>
      <Title>Slides</Title>
      <div className="mb-2 flex flex-wrap gap-1 px-1">
        {SLIDE_THEMES.map((n) => {
          const t = THEMES[n];
          return <button key={n} type="button" title={n} onClick={() => setTheme(n)} className={`h-6 w-6 rounded-full border-2 ${theme === n ? "border-accent" : "border-transparent"}`} style={{ background: `linear-gradient(135deg, ${t.bg2}, ${t.accent})` }} />;
        })}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {slides.map(({ l, svg }) => (
          <button key={l} type="button" onClick={() => addSlide(l)} title={LAYOUT_INFO[l].hint} className="group overflow-hidden rounded-lg border border-line text-left transition-all hover:-translate-y-0.5 hover:border-accent">
            <span className="showcase-art block aspect-video overflow-hidden" dangerouslySetInnerHTML={{ __html: svg }} />
            <span className="block px-1.5 py-1 text-[10px] font-semibold text-ink">{LAYOUT_INFO[l].name}</span>
          </button>
        ))}
      </div>
      <Title>Charts</Title>
      <div className="grid grid-cols-3 gap-1.5">
        {charts.map(({ t, svg }) => (
          <button key={t} type="button" onClick={() => addChart(t)} className="overflow-hidden rounded-lg border border-line bg-field text-left transition-all hover:-translate-y-0.5 hover:border-accent">
            <span className="showcase-art block aspect-[10/7] overflow-hidden" dangerouslySetInnerHTML={{ __html: svg }} />
            <span className="block px-1.5 py-1 text-[10px] font-semibold text-ink">{CHART_TYPE_NAMES[t]}</span>
          </button>
        ))}
      </div>
      <Title>Embeds & widgets</Title>
      <Widgets editor={editor} />
      <Title>3D scenes</Title>
      <div className="grid grid-cols-2 gap-1.5 pb-3">
        {SCENE_PRESETS.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => addScene(p.id)}
            className="relative h-20 overflow-hidden rounded-lg border border-line p-2 text-left text-white transition-all hover:-translate-y-0.5 hover:border-accent"
            style={{ background: ["linear-gradient(135deg,#05060f,#1d2440)", "linear-gradient(135deg,#060a18,#2b3a55)", "linear-gradient(135deg,#f0a37a,#6b5a4a)", "linear-gradient(135deg,#14171f,#3a3f4f)", "linear-gradient(135deg,#0b0f18,#194b74)", "linear-gradient(135deg,#9ec9ff,#7a8f6a)"][i % 6] }}
          >
            <span className="absolute right-1.5 top-1 text-[22px]">{["🪐", "🌃", "🏔️", "💎", "🖥️", "🚀"][i % 6]}</span>
            <span className="absolute bottom-1.5 left-2 right-2">
              <span className="block text-[11px] font-bold leading-tight drop-shadow">{p.name}</span>
              <span className="block truncate text-[9px] text-white/75">{p.blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const SAMPLE_CODE = [
  "// Run fn once the calls stop for `wait` ms",
  "export function debounce<T extends unknown[]>(fn: (...args: T) => void, wait = 200) {",
  "  let timer: ReturnType<typeof setTimeout> | undefined;",
  "  return (...args: T) => {",
  "    clearTimeout(timer);",
  "    timer = setTimeout(() => fn(...args), wait);",
  "  };",
  "}",
].join("\n");

/** Links (YouTube, Figma, any https page), code blocks and live polls. */
function Widgets({ editor }: { editor: Editor }) {
  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("Which launch date works best?");
  const [options, setOptions] = useState(["June 3", "June 17", "July 1"].join("\n"));
  const field = "h-8 w-full rounded-lg border border-line bg-field px-2 text-[12px] text-ink outline-none focus:border-accent";
  return (
    <div className="space-y-2.5 px-1">
      <div className="rounded-xl border border-line p-2">
        <p className="mb-1.5 text-[11px] font-bold text-ink">🔗 Embed a link</p>
        <div className="flex gap-1">
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="YouTube, Figma or any https link" className={field} />
          <button
            type="button"
            onClick={() => {
              const spec = embedFromUrl(url);
              if (spec) {
                addEmbed(editor, spec);
                setUrl("");
              } else useUiStore.getState().setNotice("Paste a full https:// link");
            }}
            className="shrink-0 rounded-lg bg-ink px-2.5 text-[11px] font-bold text-paper"
          >
            Add
          </button>
        </div>
        <p className="mt-1 text-[10px] text-muted">Tip: paste a link straight onto the board.</p>
      </div>
      <button
        type="button"
        onClick={() => addEmbed(editor, { type: "code", url: "", title: "debounce.ts", code: SAMPLE_CODE, language: "ts" })}
        className="flex w-full items-center gap-2 rounded-xl border border-line p-2 text-left hover:border-accent"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#0f1220] font-mono text-[11px] font-bold text-[#c792ea]">{"</>"}</span>
        <span>
          <span className="block text-[11px] font-bold text-ink">Code block</span>
          <span className="block text-[10px] text-muted">Syntax highlighted · double-click to edit</span>
        </span>
      </button>
      <div className="rounded-xl border border-line p-2">
        <p className="mb-1.5 text-[11px] font-bold text-ink">📊 Live poll</p>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={field} />
        <textarea value={options} onChange={(e) => setOptions(e.target.value)} onKeyDown={(e) => e.stopPropagation()} rows={3} className="mt-1 w-full resize-none rounded-lg border border-line bg-field p-2 text-[12px] text-ink outline-none focus:border-accent" />
        <button type="button" onClick={() => addPoll(editor, question, options.split("\n"))} className="mt-1 h-8 w-full rounded-lg bg-gradient-to-r from-[#5b8cff] to-[#b36bff] text-[11px] font-bold text-white">
          Add poll · everyone votes live
        </button>
      </div>
    </div>
  );
}
