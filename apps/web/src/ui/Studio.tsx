import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHART_PALETTE_NAMES, CHART_PALETTES, CHART_THEMES, CHART_TYPE_NAMES, CHART_TYPES, chartSvg, parseChart, type ChartPalette, type ChartType } from "../canvas/charts";
import type { Editor } from "../canvas/editor";
import { LAYOUT_INFO, parseSlide, SLIDE_LAYOUTS, SLIDE_THEMES, slideSvg, THEMES, type SlideLayout, type SlideThemeName } from "../canvas/slides";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd, spring } from "./kit";
import { useSceneVersion } from "./useScene";
import { autoKpis, parseTable } from "../canvas/chart-data";

type Raw = Record<string, unknown>;
type Item = { icon?: string; title?: string; text?: string; value?: string };
type Stat = { value?: string; label?: string; delta?: string };
type Series = { name?: string; values?: unknown[] };

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const input = "h-9 w-full rounded-xl border border-line bg-field px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent";
const area = "w-full resize-none rounded-xl border border-line bg-field px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors focus:border-accent";

function Group({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-edge px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{title}</p>
        {right}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, multiline, rows = 2, mono }: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number; mono?: boolean }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[11px] font-semibold text-muted">{label}</span>}
      {multiline ? (
        <textarea value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${area} ${mono ? "font-mono" : ""}`} />
      ) : (
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${input} ${mono ? "font-mono" : ""}`} />
      )}
    </label>
  );
}

function SmallButton({ children, onClick, title, tone = "plain", disabled }: { children: ReactNode; onClick: () => void; title?: string; tone?: "plain" | "accent" | "danger"; disabled?: boolean }) {
  const cls = tone === "accent" ? "bg-accent text-white hover:brightness-110" : tone === "danger" ? "text-muted hover:bg-bad/10 hover:text-bad" : "border border-line text-ink hover:bg-hover";
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-40 ${cls}`}>
      {children}
    </button>
  );
}

/** Move, delete controls for one row in a list. */
function RowTools({ index, count, onMove, onDelete }: { index: number; count: number; onMove: (to: number) => void; onDelete: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" title="Move up" disabled={index === 0} onClick={() => onMove(index - 1)} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-hover disabled:opacity-30">
        <Icon name="back2" className="h-3.5 w-3.5 rotate-90" />
      </button>
      <button type="button" title="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-hover disabled:opacity-30">
        <Icon name="back2" className="h-3.5 w-3.5 -rotate-90" />
      </button>
      <button type="button" title="Remove" onClick={onDelete} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad">
        <Icon name="trash" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [x] = next.splice(from, 1);
  if (x !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
};

/**
 * Studio: the editor for designed slides and charts. A big live preview on the left, every
 * field on the right, changes saved as you type (shared with everyone on the board), and
 * the AI one instruction away. Opened by double-clicking a slide or chart.
 */
export function Studio({ editor }: { editor: Editor | null }) {
  const id = useUiStore((s) => s.studio);
  return <AnimatePresence>{editor && id && <StudioPanel key={id} editor={editor} id={id} />}</AnimatePresence>;
}

function StudioPanel({ editor, id }: { editor: Editor; id: string }) {
  const version = useSceneVersion(editor, 200);
  const shape = editor.scene.get(id);
  const kind = shape?.kind;
  const [draft, setDraft] = useState<Raw>(() => {
    try {
      return JSON.parse(shape?.data ?? "{}") as Raw;
    } catch {
      return {};
    }
  });
  const committed = useRef(shape?.data ?? "");
  const group = useRef(editor.beginGroup());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [replay, setReplay] = useState(0);
  const close = (): void => useUiStore.getState().setStudio(undefined);

  // Someone else (or the AI) changed it: take their version.
  useEffect(() => {
    const data = editor.scene.get(id)?.data;
    if (data && data !== committed.current) {
      committed.current = data;
      try {
        setDraft(JSON.parse(data) as Raw);
      } catch {
        // keep ours
      }
    }
    if (!editor.scene.get(id)) close();
  }, [version]);

  const save = (next: Raw): void => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const data = JSON.stringify(next);
      committed.current = data;
      const label = str(next.title).replace(/\*/g, "").slice(0, 120);
      editor.updateShapes([{ id, patch: { data, ...(label ? { label } : {}) } }], group.current);
    }, 220);
  };
  const update = (patch: Raw): void => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      save(next);
      return next;
    });
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!shape || (kind !== "slide" && kind !== "chart")) return null;
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm md:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <motion.div
        initial={{ y: 30, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.98, opacity: 0 }}
        transition={spring}
        className="flex h-[100dvh] w-screen flex-col overflow-hidden border-edge bg-paper shadow-[0_40px_120px_rgba(0,0,0,0.45)] md:h-[min(860px,94vh)] md:w-[min(1500px,97vw)] md:flex-row md:rounded-[28px] md:border"
      >
        <Preview kind={kind} draft={draft} replay={replay} onReplay={() => setReplay((n) => n + 1)} />
        <div className="flex min-h-0 w-full flex-1 flex-col border-t border-edge md:w-[440px] md:flex-none md:shrink-0 md:border-l md:border-t-0">
          <header className="flex items-center gap-3 border-b border-edge px-5 py-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#5b8cff] to-[#b36bff] text-white">
              <Icon name={kind === "slide" ? "slides" : "chart"} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-extrabold text-ink">{kind === "slide" ? "Slide studio" : "Chart studio"}</p>
              <p className="truncate text-[11px] text-muted">Changes save as you type · everyone sees them live</p>
            </div>
            <button type="button" onClick={close} className="flex h-9 items-center gap-2 rounded-xl px-3 text-[12px] font-bold text-muted hover:bg-hover">
              Done <Kbd>Esc</Kbd>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {kind === "slide" ? <SlideForm editor={editor} id={id} draft={draft} update={update} /> : <ChartForm editor={editor} id={id} draft={draft} update={update} />}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Preview({ kind, draft, replay, onReplay }: { kind: string; draft: Raw; replay: number; onReplay: () => void }) {
  const dark = useUiStore((s) => s.theme === "dark");
  // Build-in animation on open and on Replay; edits while typing show instantly.
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    setPlaying(true);
    const t = setTimeout(() => setPlaying(false), 3000);
    return () => clearTimeout(t);
  }, [replay]);
  const svg = useMemo(() => {
    const data = JSON.stringify(draft);
    if (kind === "slide") {
      const spec = parseSlide(data);
      return spec ? slideSvg(spec, 960, 540) : "";
    }
    const spec = parseChart(data);
    return spec ? chartSvg(spec, 860, 600, CHART_THEMES[dark ? "dark" : "light"]) : "";
  }, [draft, kind, dark]);
  return (
    <div className="relative flex h-[34%] min-w-0 shrink-0 flex-col md:h-auto md:flex-1 md:shrink bg-[radial-gradient(circle_at_30%_20%,rgba(91,140,255,0.12),transparent_60%),radial-gradient(circle,var(--color-line)_1px,transparent_1px)] [background-size:auto,18px_18px]">
      <div className="flex items-center justify-between px-4 pt-3 md:px-6 md:pt-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Live preview</p>
        <button type="button" onClick={onReplay} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-[12px] font-semibold text-ink hover:bg-hover">
          <Icon name="sparkle" className="h-3.5 w-3.5 text-accent" /> Replay animation
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 md:p-6">
        {svg ? (
          <div key={replay} className={`${playing ? "reveal" : ""} showcase-art w-full overflow-hidden rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.35)]`} style={{ aspectRatio: kind === "slide" ? "960 / 540" : "860 / 600", maxHeight: "100%", ["--base" as string]: "100ms" }} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="text-[13px] text-muted">Add a title to see the {kind}.</p>
        )}
      </div>
    </div>
  );
}

// --- slides -------------------------------------------------------------------------

function SlideForm({ editor, id, draft, update }: { editor: Editor; id: string; draft: Raw; update: (patch: Raw) => void }) {
  const spec = useMemo(() => parseSlide(JSON.stringify({ ...draft, pending: false })), [draft]);
  const layout = (SLIDE_LAYOUTS.includes(draft.layout as SlideLayout) ? draft.layout : spec?.layout ?? "cards") as SlideLayout;
  const items = arr<Item>(draft.items);
  const stats = arr<Stat>(draft.stats);
  const columns = arr<{ title?: string; items?: string[] }>(draft.columns);
  const quote = (typeof draft.quote === "object" && draft.quote !== null ? draft.quote : {}) as { text?: string; author?: string };
  const axes = arr<string>(draft.axes);
  const usesItems = ["agenda", "cards", "chart", "timeline", "closing", "team", "pricing", "process", "matrix"].includes(layout);
  const [wholeDeck, setWholeDeck] = useState(true);

  const setTheme = (theme: SlideThemeName): void => {
    update({ theme });
    if (!wholeDeck || !draft.deck) return;
    const others = editor.scene.ordered().filter((s) => s.kind === "slide" && s.id !== id && parseSlide(s.data)?.deck === draft.deck);
    const updates = others.flatMap((s) => {
      try {
        return [{ id: s.id, patch: { data: JSON.stringify({ ...(JSON.parse(s.data ?? "{}") as Raw), theme }) } }];
      } catch {
        return [];
      }
    });
    if (updates.length > 0) editor.updateShapes(updates, editor.beginGroup());
  };

  return (
    <>
      <AiRow kind="slide" editor={editor} id={id} />
      <Group title="Layout">
        <LayoutPicker draft={draft} current={layout} onPick={(l) => update({ layout: l })} />
      </Group>
      <Group
        title="Theme"
        right={
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
            <input type="checkbox" checked={wholeDeck} onChange={(e) => setWholeDeck(e.target.checked)} className="accent-[var(--color-accent)]" /> Whole deck
          </label>
        }
      >
        <div className="grid grid-cols-5 gap-2">
          {SLIDE_THEMES.map((name) => {
            const t = THEMES[name];
            const on = (spec?.theme ?? draft.theme) === name;
            return (
              <button key={name} type="button" title={name} onClick={() => setTheme(name)} className={`overflow-hidden rounded-xl border text-left transition-transform hover:-translate-y-0.5 ${on ? "border-accent ring-2 ring-accent/40" : "border-line"}`}>
                <span className="block h-10" style={{ background: `linear-gradient(135deg, ${t.bg1}, ${t.bg2})` }}>
                  <span className="ml-1.5 mt-2 inline-block h-1.5 w-7 rounded-full" style={{ background: `linear-gradient(90deg, ${t.accent}, ${t.accent2})` }} />
                </span>
                <span className="block px-1.5 py-1 text-[10px] font-semibold capitalize text-ink">{name}</span>
              </button>
            );
          })}
        </div>
      </Group>
      <Group title="Text">
        <div className="space-y-2.5">
          <Field label="Kicker" value={str(draft.kicker)} onChange={(v) => update({ kicker: v })} placeholder="Problem, Market, Seed round…" />
          <Field label={layout === "statement" ? "Statement — wrap key words in *asterisks*" : "Title"} value={str(draft.title)} onChange={(v) => update({ title: v })} multiline rows={2} />
          <Field label="Subtitle" value={str(draft.subtitle)} onChange={(v) => update({ subtitle: v })} multiline rows={2} />
          <Field label="Deck name (footer)" value={str(draft.deck)} onChange={(v) => update({ deck: v })} />
        </div>
      </Group>
      {usesItems && (
        <Group title={layout === "team" ? "People" : layout === "pricing" ? "Plans" : layout === "matrix" ? "Quadrants (first = best)" : layout === "process" || layout === "timeline" ? "Steps" : "Items"} right={<SmallButton onClick={() => update({ items: [...items, { icon: "✨", title: "New item", text: "" }] })} disabled={items.length >= 6}><Icon name="plus" className="h-3.5 w-3.5" /> Add</SmallButton>}>
          <div className="space-y-2.5">
            {items.map((it, i) => (
              <div key={i} className="rounded-2xl border border-line bg-field/60 p-2.5">
                <div className="flex items-center gap-2">
                  <input value={str(it.icon)} onChange={(e) => update({ items: items.map((x, k) => (k === i ? { ...x, icon: e.target.value } : x)) })} className="h-9 w-11 rounded-xl border border-line bg-paper text-center text-[16px] outline-none focus:border-accent" title="Emoji icon" />
                  <input value={str(it.title)} onChange={(e) => update({ items: items.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} placeholder={layout === "team" ? "Name" : layout === "pricing" ? "Plan name" : "Title"} className={`${input} font-semibold`} />
                  <RowTools index={i} count={items.length} onMove={(to) => update({ items: move(items, i, to) })} onDelete={() => update({ items: items.filter((_, k) => k !== i) })} />
                </div>
                {(layout === "pricing" || layout === "team" || layout === "process") && (
                  <input value={str(it.value)} onChange={(e) => update({ items: items.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} placeholder={layout === "pricing" ? "Price, e.g. ₹299/mo" : layout === "team" ? "Role" : "Label, e.g. Week 1"} className={`${input} mt-2`} />
                )}
                <textarea value={str(it.text)} rows={2} onChange={(e) => update({ items: items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} placeholder={layout === "pricing" ? "Features separated by ;" : "Details"} className={`${area} mt-2`} />
              </div>
            ))}
            {items.length === 0 && <p className="text-[12px] text-muted">No items yet: add one, or ask the AI above.</p>}
          </div>
        </Group>
      )}
      {layout === "matrix" && (
        <Group title="Axes">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Horizontal" value={str(axes[0])} onChange={(v) => update({ axes: [v, str(axes[1])] })} placeholder="Effort" />
            <Field label="Vertical" value={str(axes[1])} onChange={(v) => update({ axes: [str(axes[0]), v] })} placeholder="Impact" />
          </div>
        </Group>
      )}
      {layout === "stats" && (
        <Group title="Big numbers" right={<SmallButton onClick={() => update({ stats: [...stats, { value: "42%", label: "What it measures", delta: "+5%" }] })} disabled={stats.length >= 4}><Icon name="plus" className="h-3.5 w-3.5" /> Add</SmallButton>}>
          <div className="space-y-2">
            {stats.map((st, i) => (
              <div key={i} className="flex items-start gap-2 rounded-2xl border border-line bg-field/60 p-2.5">
                <div className="grid flex-1 grid-cols-[1fr_1fr] gap-2">
                  <input value={str(st.value)} onChange={(e) => update({ stats: stats.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} placeholder="$4.2B" className={`${input} font-bold`} />
                  <input value={str(st.delta)} onChange={(e) => update({ stats: stats.map((x, k) => (k === i ? { ...x, delta: e.target.value } : x)) })} placeholder="+18% YoY" className={input} />
                  <input value={str(st.label)} onChange={(e) => update({ stats: stats.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} placeholder="What it measures" className={`${input} col-span-2`} />
                </div>
                <RowTools index={i} count={stats.length} onMove={(to) => update({ stats: move(stats, i, to) })} onDelete={() => update({ stats: stats.filter((_, k) => k !== i) })} />
              </div>
            ))}
          </div>
        </Group>
      )}
      {layout === "quote" && (
        <Group title="Quote">
          <div className="space-y-2.5">
            <Field label="Quote" value={str(quote.text)} onChange={(v) => update({ quote: { ...quote, text: v } })} multiline rows={3} />
            <Field label="Who said it" value={str(quote.author)} onChange={(v) => update({ quote: { ...quote, author: v } })} />
          </div>
        </Group>
      )}
      {layout === "compare" && (
        <Group title="Comparison">
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((k) => {
              const col = columns[k] ?? {};
              const set = (patch: { title?: string; items?: string[] }): void => {
                const next = [columns[0] ?? { title: "Before", items: [] }, columns[1] ?? { title: "After", items: [] }];
                next[k] = { ...next[k], ...patch };
                update({ columns: next });
              };
              return (
                <div key={k} className="space-y-2">
                  <Field label={k === 0 ? "Old way" : "Our way"} value={str(col.title)} onChange={(v) => set({ title: v })} />
                  <Field label="One point per line" value={arr<string>(col.items).join("\n")} onChange={(v) => set({ items: v.split("\n").slice(0, 5) })} multiline rows={5} />
                </div>
              );
            })}
          </div>
        </Group>
      )}
      {layout === "chart" && (
        <Group title="Chart data">
          <ChartData
            draft={typeof draft.chart === "object" && draft.chart !== null ? (draft.chart as Raw) : { type: "bar", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "Value", values: [12, 19, 27, 34] }] }}
            update={(patch) => update({ chart: { ...(typeof draft.chart === "object" && draft.chart !== null ? (draft.chart as Raw) : {}), ...patch } })}
            compact
          />
        </Group>
      )}
    </>
  );
}

/** Live thumbnails of this slide's own content in every layout. */
function LayoutPicker({ draft, current, onPick }: { draft: Raw; current: SlideLayout; onPick: (l: SlideLayout) => void }) {
  const thumbs = useMemo(
    () =>
      SLIDE_LAYOUTS.map((l) => {
        const spec = parseSlide(JSON.stringify({ ...draft, layout: l, pending: false }));
        return { l, svg: spec ? slideSvg(spec, 192, 108) : "", fits: spec?.layout === l };
      }),
    [draft],
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      {thumbs.map(({ l, svg, fits }) => (
        <button key={l} type="button" onClick={() => onPick(l)} title={LAYOUT_INFO[l].hint} className={`group overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5 ${current === l ? "border-accent ring-2 ring-accent/40" : "border-line"}`}>
          <span className={`showcase-art block aspect-video overflow-hidden ${fits ? "" : "opacity-45 grayscale"}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <span className="flex items-center justify-between px-1.5 py-1">
            <span className="text-[10px] font-semibold text-ink">{LAYOUT_INFO[l].name}</span>
            {!fits && <span className="text-[9px] text-muted">needs content</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** "Ask the AI to change it" row, for slides and charts. */
function AiRow({ kind, editor, id }: { kind: "slide" | "chart"; editor: Editor; id: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const ideas = kind === "slide" ? ["Make it punchier", "Add real numbers", "Turn it into a timeline", "Shorter text"] : ["Show it as a donut", "Add last year to compare", "Make the numbers more realistic", "Rank from highest to lowest"];
  const run = async (instruction: string): Promise<void> => {
    if (!instruction.trim()) return;
    setState("busy");
    const ok = kind === "slide" ? await editor.ai.rewriteSlide(id, instruction) : await editor.ai.rewriteChart(id, instruction);
    setState(ok ? "idle" : "failed");
    if (ok) setText("");
  };
  return (
    <section className="border-b border-edge bg-gradient-to-br from-[#5b8cff]/10 via-transparent to-[#b36bff]/10 px-5 py-4">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
        <Icon name="sparkle" className="h-3.5 w-3.5" /> Ask the AI to change it
      </p>
      <div className="flex gap-2">
        <input
          value={text}
          disabled={state === "busy"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run(text);
          }}
          placeholder={kind === "slide" ? "e.g. focus on Indian SMEs, add a price" : "e.g. split by region"}
          className={input}
        />
        <SmallButton tone="accent" onClick={() => void run(text)} disabled={state === "busy" || !text.trim()}>
          {state === "busy" ? "Working…" : "Apply"}
        </SmallButton>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ideas.map((idea) => (
          <button key={idea} type="button" disabled={state === "busy"} onClick={() => void run(idea)} className="rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-accent disabled:opacity-40">
            {idea}
          </button>
        ))}
      </div>
      {state === "failed" && <p className="mt-2 text-[11px] text-bad">That didn't work — is Ollama running? Try again or rephrase.</p>}
    </section>
  );
}

// --- charts -------------------------------------------------------------------------

function ChartForm({ editor, id, draft, update }: { editor: Editor; id: string; draft: Raw; update: (patch: Raw) => void }) {
  const spec = useMemo(() => parseChart(JSON.stringify(draft)), [draft]);
  const kpis = arr<{ label?: string; value?: string; delta?: string }>(draft.kpis);
  return (
    <>
      <AiRow kind="chart" editor={editor} id={id} />
      <Group title="Text">
        <div className="space-y-2.5">
          <Field label="Title" value={str(draft.title)} onChange={(v) => update({ title: v })} />
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Note (source)" value={str(draft.note)} onChange={(v) => update({ note: v })} />
            <Field label="Unit" value={str(draft.unit)} onChange={(v) => update({ unit: v })} placeholder="$, %, k" />
          </div>
          <Field label="Insight" value={str(draft.insight)} onChange={(v) => update({ insight: v })} multiline rows={2} />
        </div>
      </Group>
      <Group title="Data">
        <ChartData draft={draft} update={update} />
      </Group>
      <Group
        title="Headline numbers"
        right={
          <div className="flex gap-1.5">
            <SmallButton
              title="Work them out from the data"
              onClick={() => spec && update({ kpis: autoKpis(spec.labels, spec.series, spec.unit) })}
              disabled={!spec}
            >
              <Icon name="sparkle" className="h-3.5 w-3.5" /> Auto
            </SmallButton>
            <SmallButton onClick={() => update({ kpis: [...kpis, { label: "Metric", value: "0", delta: "" }] })} disabled={kpis.length >= 4}>
              <Icon name="plus" className="h-3.5 w-3.5" />
            </SmallButton>
          </div>
        }
      >
        <div className="space-y-2">
          {kpis.map((k, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={str(k.value)} onChange={(e) => update({ kpis: kpis.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder="$4.2M" className={`${input} w-24 shrink-0 font-bold`} />
              <input value={str(k.label)} onChange={(e) => update({ kpis: kpis.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Label" className={input} />
              <input value={str(k.delta)} onChange={(e) => update({ kpis: kpis.map((x, j) => (j === i ? { ...x, delta: e.target.value } : x)) })} placeholder="+12%" className={`${input} w-20 shrink-0`} />
              <button type="button" onClick={() => update({ kpis: kpis.filter((_, j) => j !== i) })} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad">
                <Icon name="trash" className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {kpis.length === 0 && <p className="text-[12px] text-muted">None: the plot gets the space. Press Auto to work them out.</p>}
        </div>
      </Group>
    </>
  );
}

/** Type, palette and a spreadsheet-like grid: rows are labels, columns are series. */
function ChartData({ draft, update, compact }: { draft: Raw; update: (patch: Raw) => void; compact?: boolean }) {
  const labels = arr<string>(draft.labels).map(str);
  const series = arr<Series>(draft.series).map((s) => ({ name: str(s.name) || "Series", values: arr<unknown>(s.values).map((v) => (typeof v === "number" ? v : Number(v) || 0)) }));
  const type = (CHART_TYPES.includes(draft.type as ChartType) ? draft.type : "bar") as ChartType;
  const palette = (CHART_PALETTE_NAMES.includes(draft.palette as ChartPalette) ? draft.palette : "vivid") as ChartPalette;
  const [paste, setPaste] = useState<string | undefined>(undefined);
  const rows = Math.max(labels.length, ...series.map((s) => s.values.length));
  const setCell = (r: number, k: number, v: number): void => update({ series: series.map((s, j) => (j === k ? { ...s, values: Array.from({ length: rows }, (_, i) => (i === r ? v : (s.values[i] ?? 0))) } : s)) });
  const setLabel = (r: number, v: string): void => update({ labels: Array.from({ length: rows }, (_, i) => (i === r ? v : (labels[i] ?? ""))) });
  const addRow = (): void => update({ labels: [...Array.from({ length: rows }, (_, i) => labels[i] ?? ""), `#${rows + 1}`], series: series.map((s) => ({ ...s, values: [...Array.from({ length: rows }, (_, i) => s.values[i] ?? 0), s.values[rows - 1] ?? 0] })) });
  const removeRow = (r: number): void => update({ labels: labels.filter((_, i) => i !== r), series: series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== r) })) });
  const addSeries = (): void => update({ series: [...series, { name: `Series ${series.length + 1}`, values: Array.from({ length: rows }, (_, i) => Math.round((series[0]?.values[i] ?? 10) * 0.7)) }] });
  const sort = (): void => {
    const order = Array.from({ length: rows }, (_, i) => i).sort((a, b) => (series[0]?.values[b] ?? 0) - (series[0]?.values[a] ?? 0));
    update({ labels: order.map((i) => labels[i] ?? ""), series: series.map((s) => ({ ...s, values: order.map((i) => s.values[i] ?? 0) })) });
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {CHART_TYPES.map((t) => (
          <button key={t} type="button" onClick={() => update({ type: t })} className={`h-8 rounded-lg text-[12px] font-semibold ${type === t ? "bg-ink text-paper" : "border border-line text-ink hover:bg-hover"}`}>
            {CHART_TYPE_NAMES[t]}
          </button>
        ))}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {CHART_PALETTE_NAMES.map((p) => (
            <button key={p} type="button" title={p} onClick={() => update({ palette: p })} className={`flex items-center gap-0.5 rounded-full border px-1.5 py-1 ${palette === p ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
              {(CHART_PALETTES[p] ?? []).slice(0, 4).map((c) => (
                <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} />
              ))}
              <span className="ml-1 text-[10px] font-semibold capitalize text-ink">{p}</span>
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-field">
              <th className="w-[34%] px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted">Label</th>
              {series.map((s, k) => (
                <th key={k} className="border-l border-line px-1 py-1">
                  <div className="flex items-center gap-1">
                    <input value={s.name} onChange={(e) => update({ series: series.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} className="w-full min-w-0 bg-transparent px-1 text-[11px] font-bold text-ink outline-none" />
                    {series.length > 1 && (
                      <button type="button" title="Remove series" onClick={() => update({ series: series.filter((_, j) => j !== k) })} className="text-muted hover:text-bad">
                        <Icon name="close" className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r} className="border-t border-line">
                <td className="px-1">
                  <input value={labels[r] ?? ""} onChange={(e) => setLabel(r, e.target.value)} className="h-8 w-full bg-transparent px-1 text-ink outline-none" />
                </td>
                {series.map((s, k) => (
                  <td key={k} className="border-l border-line px-1">
                    <input
                      type="number"
                      value={s.values[r] ?? 0}
                      onChange={(e) => setCell(r, k, Number(e.target.value) || 0)}
                      className="h-8 w-full bg-transparent px-1 text-right font-mono tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </td>
                ))}
                <td>
                  <button type="button" title="Remove row" onClick={() => removeRow(r)} className="grid h-8 w-7 place-items-center text-muted hover:text-bad">
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <SmallButton onClick={addRow} disabled={rows >= 12}>
          <Icon name="plus" className="h-3.5 w-3.5" /> Row
        </SmallButton>
        <SmallButton onClick={addSeries} disabled={series.length >= 4}>
          <Icon name="plus" className="h-3.5 w-3.5" /> Series
        </SmallButton>
        <SmallButton onClick={sort} title="Sort by the first series, highest first">
          Sort ↓
        </SmallButton>
        <SmallButton onClick={() => setPaste("")} title="Paste rows from Excel, Sheets or a CSV">
          <Icon name="copy" className="h-3.5 w-3.5" /> Paste table
        </SmallButton>
      </div>
      {paste !== undefined && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-2.5">
          <p className="mb-1.5 text-[11px] text-muted">Paste from Excel, Google Sheets or CSV. First column = labels; a header row names the series.</p>
          <textarea autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} className={`${area} font-mono`} placeholder={"Month\tRevenue\tCosts\nJan\t212\t318\nFeb\t228\t322"} />
          <div className="mt-2 flex justify-end gap-1.5">
            <SmallButton onClick={() => setPaste(undefined)}>Cancel</SmallButton>
            <SmallButton
              tone="accent"
              onClick={() => {
                const table = parseTable(paste);
                if (table) update({ labels: table.labels, series: table.series });
                setPaste(undefined);
              }}
            >
              Use this data
            </SmallButton>
          </div>
        </div>
      )}
    </div>
  );
}
