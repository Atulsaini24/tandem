import type { ShapeView } from "@canvas/doc";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { CHART_TYPE_NAMES, CHART_TYPES, parseChart, type ChartType } from "../canvas/charts";
import { parseSlide, SLIDE_THEMES, THEMES, type SlideThemeName } from "../canvas/slides";
import { PALETTE, type Editor } from "../canvas/editor";
import { NOTE_COLORS } from "../canvas/templates";
import { hex } from "../canvas/theme";
import { useUiStore } from "../state/ui-store";
import { AiAssistant } from "./AiPanel";
import { Icon, IconButton, MOD, spring } from "./kit";
import { useSceneVersion } from "./useScene";

const SWATCHES = [...Object.values(NOTE_COLORS), ...PALETTE];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-edge px-3 py-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">{title}</p>
      {children}
    </section>
  );
}

/** A number field that commits on Enter/blur (not every keystroke). */
function NumberField({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (v: number) => void; suffix?: string }) {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  const commit = (): void => {
    const v = Number(text);
    if (Number.isFinite(v) && Math.round(v) !== Math.round(value)) onCommit(v);
    else setText(String(Math.round(value)));
  };
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-field px-2 focus-within:border-accent">
      <span className="w-3 text-[10px] font-bold text-muted">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        inputMode="numeric"
        className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none"
      />
      {suffix && <span className="text-[10px] text-muted">{suffix}</span>}
    </label>
  );
}

function DesignTab({ editor }: { editor: Editor }) {
  const selection = useUiStore((s) => s.selection);
  const version = useSceneVersion(editor);
  const selected: ShapeView[] = [...selection].flatMap((id) => {
    const s = editor.scene.get(id);
    return s ? [s] : [];
  });
  void version;
  const one = selected.length === 1 ? selected[0] : undefined;
  const [text, setText] = useState(one?.label ?? "");
  useEffect(() => setText(one?.label ?? ""), [one?.id, one?.label]);

  if (selected.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-dashed border-line p-4 text-center">
          <Icon name="select" className="mx-auto h-6 w-6 text-muted" />
          <p className="mt-2 text-[13px] font-semibold text-ink">Nothing selected</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">Click a shape to edit its color, size, text and more. Drag on empty space to select several.</p>
        </div>
        <div className="mt-4 space-y-2 text-[12px] text-muted">
          <p className="font-bold uppercase tracking-[0.12em] text-[10px]">Shortcuts</p>
          {[
            ["N", "Sticky note"],
            ["A", "Connector"],
            ["F", "Frame (a page)"],
            ["/", "Cursor chat"],
            [`${MOD}K`, "Every command"],
            ["Right-click", "Radial menu"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span>{v}</span>
              <kbd className="rounded-md border border-line bg-field px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const chart = one?.kind === "chart" ? parseChart(one.data) : undefined;
  const slide = one?.kind === "slide" ? parseSlide(one.data) : undefined;
  const patchData = (patch: Record<string, unknown>): void => {
    if (!one?.data) return;
    try {
      const data = JSON.parse(one.data) as Record<string, unknown>;
      editor.updateShapes([{ id: one.id, patch: { data: JSON.stringify({ ...data, ...patch }) } }]);
      useUiStore.getState().reveal([one.id]);
    } catch {
      // unparseable: leave it
    }
  };
  const setChartType = (type: ChartType): void => patchData({ type });
  /** A deck shares one theme: restyle every slide of the same deck. */
  const setSlideTheme = (theme: SlideThemeName): void => {
    if (!slide) return;
    const same = editor.scene.ordered().filter((s) => s.kind === "slide" && parseSlide(s.data)?.deck === slide.deck);
    const updates = same.flatMap((s) => {
      try {
        return [{ id: s.id, patch: { data: JSON.stringify({ ...(JSON.parse(s.data ?? "{}") as Record<string, unknown>), theme }) } }];
      } catch {
        return [];
      }
    });
    editor.updateShapes(updates, editor.beginGroup());
    useUiStore.getState().reveal(updates.map((u) => u.id));
  };

  return (
    <div>
      <Section title={one ? one.kind : `${selected.length} selected`}>
        <div className="grid grid-cols-8 gap-1.5">
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              title={hex(color)}
              onClick={() => editor.setFillOfSelection(color)}
              className="aspect-square rounded-lg border border-edge transition-transform hover:scale-110"
              style={{ backgroundColor: hex(color), boxShadow: one?.fill === color ? `0 0 0 2px var(--color-paper), 0 0 0 4px ${hex(color)}` : undefined }}
            />
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
          Custom
          <input type="color" value={hex(one?.fill ?? 0x2f63ff)} onChange={(e) => editor.setFillOfSelection(parseInt(e.target.value.slice(1), 16))} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />
        </label>
      </Section>

      {one && one.kind !== "arrow" && (
        <Section title="Position & size">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="X" value={one.x} onCommit={(x) => editor.updateShapes([{ id: one.id, patch: { x } }])} />
            <NumberField label="Y" value={one.y} onCommit={(y) => editor.updateShapes([{ id: one.id, patch: { y } }])} />
            <NumberField label="W" value={one.w} onCommit={(w) => w > 4 && editor.updateShapes([{ id: one.id, patch: { w } }])} />
            <NumberField label="H" value={one.h} onCommit={(h) => h > 4 && editor.updateShapes([{ id: one.id, patch: { h } }])} />
            <NumberField label="R" suffix="°" value={((one.rotation ?? 0) * 180) / Math.PI} onCommit={(deg) => editor.updateShapes([{ id: one.id, patch: { rotation: (deg * Math.PI) / 180 } }])} />
          </div>
        </Section>
      )}

      {one && one.kind !== "path" && one.kind !== "chart" && one.kind !== "scene3d" && one.kind !== "slide" && (
        <Section title="Text">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => editor.setLabel(one.id, text)}
            onKeyDown={(e) => e.stopPropagation()}
            rows={3}
            maxLength={500}
            placeholder="Add text"
            className="w-full resize-none rounded-lg border border-line bg-field p-2 text-[12px] text-ink outline-none focus:border-accent"
          />
        </Section>
      )}

      {one && (one.kind === "slide" || one.kind === "chart") && (
        <section className="border-b border-edge px-3 py-3">
          <button type="button" onClick={() => useUiStore.getState().setStudio(one.id)} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5b8cff] to-[#b36bff] text-[13px] font-bold text-white shadow-[0_8px_24px_rgba(91,140,255,0.35)] transition-transform hover:-translate-y-0.5">
            <Icon name="sparkle" className="h-4 w-4" /> Edit in Studio
          </button>
          <p className="mt-1.5 text-center text-[11px] text-muted">or double-click it on the board</p>
        </section>
      )}

      {chart && one && (
        <Section title="Chart">
          <div className="grid grid-cols-3 gap-1.5">
            {CHART_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setChartType(t)} className={`h-8 rounded-lg text-[12px] font-semibold ${chart.type === t ? "bg-ink text-paper" : "border border-line text-ink hover:bg-hover"}`}>
                {CHART_TYPE_NAMES[t]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {chart.series.length} series · {chart.labels.length} points{chart.unit ? ` · ${chart.unit}` : ""}
          </p>
        </Section>
      )}

      {slide && one && (
        <Section title="Slide theme">
          <div className="grid grid-cols-3 gap-1.5">
            {SLIDE_THEMES.map((name) => {
              const t = THEMES[name];
              return (
                <button
                  key={name}
                  type="button"
                  title={`Apply ${name} to the whole deck`}
                  onClick={() => setSlideTheme(name)}
                  className={`overflow-hidden rounded-lg border text-left ${slide.theme === name ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-ink/30"}`}
                >
                  <span className="block h-9" style={{ background: `linear-gradient(135deg, ${t.bg1}, ${t.bg2})` }}>
                    <span className="ml-2 mt-2 inline-block h-1.5 w-8 rounded-full" style={{ background: `linear-gradient(90deg, ${t.accent}, ${t.accent2})` }} />
                  </span>
                  <span className="block px-1.5 py-1 text-[10px] font-semibold capitalize text-ink">{name}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {slide.layout} layout{slide.deck ? ` · ${slide.deck}` : ""}
          </p>
        </Section>
      )}

      <Section title="Arrange">
        <div className="flex flex-wrap gap-1">
          <IconButton icon="front" title="Bring to front (])" onClick={() => editor.bringSelectionToFront()} />
          <IconButton icon="back" title="Send to back ([)" onClick={() => editor.sendSelectionToBack()} />
          <IconButton icon="rotate" title="Rotate 90°" onClick={() => editor.rotateSelection(Math.PI / 2)} />
          {selected.length >= 2 && (
            <>
              <IconButton icon="alignLeft" title="Align left" onClick={() => editor.align("left")} />
              <IconButton icon="alignCenter" title="Align centers" onClick={() => editor.align("center")} />
              <IconButton icon="alignRight" title="Align right" onClick={() => editor.align("right")} />
              <IconButton icon="alignTop" title="Align top" onClick={() => editor.align("top")} />
              <IconButton icon="alignMiddle" title="Align middles" onClick={() => editor.align("middle")} />
              <IconButton icon="alignBottom" title="Align bottom" onClick={() => editor.align("bottom")} />
            </>
          )}
          {selected.length >= 3 && (
            <>
              <IconButton icon="distributeX" title="Distribute horizontally" onClick={() => editor.distribute("x")} />
              <IconButton icon="distributeY" title="Distribute vertically" onClick={() => editor.distribute("y")} />
            </>
          )}
        </div>
      </Section>

      <Section title="Actions">
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => editor.duplicate()} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-semibold text-ink hover:bg-hover">
            <Icon name="copy" className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button type="button" onClick={() => editor.frameSelection()} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-semibold text-ink hover:bg-hover">
            <Icon name="group" className="h-3.5 w-3.5" /> Frame it
          </button>
          <button type="button" onClick={() => editor.zoomToSelection()} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-semibold text-ink hover:bg-hover">
            <Icon name="fit" className="h-3.5 w-3.5" /> Zoom to
          </button>
          <button type="button" onClick={() => editor.deleteSelection()} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-semibold text-ink hover:border-bad hover:text-bad">
            <Icon name="trash" className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
        {selected.some((s) => s.label) && (
          <button
            type="button"
            onClick={() => {
              useUiStore.getState().setAiOpen(true);
              void editor.ai.insight("");
            }}
            className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#2f63ff] to-[#7b6cff] text-[12px] font-bold text-white"
          >
            <Icon name="sparkle" className="h-3.5 w-3.5" /> Summarize the selection with AI
          </button>
        )}
      </Section>
    </div>
  );
}

/** The Pro editor's right panel: Design (the selection) and AI (the assistant). */
export function Inspector({ editor, open, onToggle }: { editor: Editor | null; open: boolean; onToggle: () => void }) {
  const aiTab = useUiStore((s) => s.aiOpen);
  const setAiTab = useUiStore((s) => s.setAiOpen);
  return (
    <>
      <AnimatePresence initial={false}>
        {open && editor && (
          <motion.aside
            key="right"
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 320, opacity: 0 }}
            transition={spring}
            className="pointer-events-auto absolute bottom-0 right-0 top-14 z-10 flex w-[300px] flex-col border-l border-edge bg-paper/90 backdrop-blur-xl"
          >
            <div className="grid grid-cols-2 gap-1 border-b border-edge p-2">
              {[
                { id: false, label: "Design", icon: "inspect" as const },
                { id: true, label: "AI", icon: "sparkle" as const },
              ].map((t) => (
                <button key={t.label} type="button" data-tour={t.id ? "ai" : undefined} onClick={() => setAiTab(t.id)} className="relative flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold">
                  {aiTab === t.id && <motion.span layoutId="right-tab" transition={spring} className="absolute inset-0 rounded-lg bg-hover" />}
                  <Icon name={t.icon} className={`relative h-3.5 w-3.5 ${aiTab === t.id ? "text-ink" : "text-muted"}`} />
                  <span className={`relative ${aiTab === t.id ? "text-ink" : "text-muted"}`}>{t.label}</span>
                </button>
              ))}
            </div>
            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{aiTab ? <AiAssistant editor={editor} /> : <DesignTab editor={editor} />}</div>
          </motion.aside>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={onToggle}
        title={open ? "Hide panel" : "Show design and AI panel"}
        className={`pointer-events-auto absolute top-[68px] z-10 grid h-8 w-8 place-items-center rounded-lg border border-edge bg-paper/90 text-muted shadow-sm backdrop-blur hover:text-ink ${open ? "right-[308px]" : "right-3"}`}
      >
        <Icon name="back2" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </>
  );
}
