import type { ShapeView } from "@canvas/doc";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toSvg } from "../canvas/export";
import { TEMPLATE_CATEGORIES, TEMPLATES, type Template, type TemplateCategory } from "../canvas/templates";
import { CANVAS_THEMES, hex } from "../canvas/theme";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd, spring } from "./kit";

const previews = new Map<string, string>();

/** A template drawn as an image, the same way it will look on the board (cached). */
export function templatePreview(t: Template, dark: boolean): string {
  const key = `${t.id}|${dark}`;
  const hit = previews.get(key);
  if (hit) return hit;
  const shapes: ShapeView[] = t.build().map((s) => ({ id: s.key, ...s.props }));
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const svg = toSvg(shapes, (id) => byId.get(id), { theme: dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light, padding: 60, background: false }).svg;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  previews.set(key, url);
  return url;
}

const ICONS: Record<TemplateCategory | "All", string> = {
  All: "✨",
  Presentations: "🎞️",
  Dashboards: "📊",
  Planning: "🗓️",
  Strategy: "♟️",
  Diagrams: "🔀",
  Workshops: "🧠",
  "3D": "🪐",
  Education: "🎓",
};

/**
 * The template library: every template with a live preview, by category, searchable.
 * `onPick` inserts it (on a board) or opens a new board with it (on the dashboard).
 */
export function TemplateGallery({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  return <AnimatePresence>{open && <Gallery onClose={onClose} onPick={onPick} />}</AnimatePresence>;
}

function Gallery({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const dark = useUiStore((s) => s.theme === "dark");
  const [category, setCategory] = useState<TemplateCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Template | undefined>(undefined);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);
  const counts = useMemo(() => new Map(TEMPLATE_CATEGORIES.map((c) => [c, TEMPLATES.filter((t) => t.category === c).length])), []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => (category === "All" || t.category === category) && (!q || `${t.name} ${t.blurb} ${t.category} ${t.tag ?? ""}`.toLowerCase().includes(q)));
  }, [category, query]);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm md:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <motion.div initial={{ y: 30, scale: 0.97, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 20, opacity: 0 }} transition={spring} className="flex h-[100dvh] w-screen overflow-hidden border-edge bg-paper shadow-[0_40px_120px_rgba(0,0,0,0.45)] md:h-[min(880px,94vh)] md:w-[min(1440px,97vw)] md:rounded-[28px] md:border">
        <nav className="hidden w-[230px] shrink-0 flex-col gap-1 border-r border-edge bg-field/50 p-3 md:flex">
          <p className="px-2 pb-2 pt-1 text-[18px] font-extrabold tracking-tight text-ink">Templates</p>
          {(["All", ...TEMPLATE_CATEGORIES] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={`flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-[13px] font-semibold transition-colors ${category === c ? "bg-ink text-paper" : "text-ink hover:bg-hover"}`}>
              <span className="text-[15px]">{ICONS[c]}</span>
              <span className="flex-1">{c}</span>
              <span className={`text-[11px] ${category === c ? "text-paper/60" : "text-muted"}`}>{c === "All" ? TEMPLATES.length : counts.get(c)}</span>
            </button>
          ))}
          <div className="mt-auto rounded-2xl bg-gradient-to-br from-[#5b8cff]/15 to-[#b36bff]/15 p-3 text-[12px] leading-relaxed text-ink">
            <p className="font-bold">Need something else?</p>
            <p className="mt-1 text-muted">Ask the AI for a deck, chart, plan or 3D scene on any topic.</p>
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-edge px-3 py-3 md:gap-3 md:px-5 md:py-3.5">
            <label className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-line bg-field px-3 focus-within:border-accent">
              <Icon name="search" className="h-4 w-4 text-muted" />
              <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${TEMPLATES.length} templates — pitch, OKR, dashboard, 3D…`} className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none" />
            </label>
            <button type="button" onClick={onClose} className="flex h-10 items-center gap-2 rounded-xl px-3 text-[12px] font-bold text-muted hover:bg-hover">
              Close <Kbd>Esc</Kbd>
            </button>
          </header>
          <div className="scroll-quiet flex gap-1.5 overflow-x-auto border-b border-edge px-3 py-2 md:hidden">
            {(["All", ...TEMPLATE_CATEGORIES] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ${category === c ? "bg-ink text-paper" : "border border-line text-ink"}`}>
                <span>{ICONS[c]}</span>
                {c}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-5">
            <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {shown.map((t, i) => (
                  <motion.button
                    layout
                    key={t.id}
                    type="button"
                    initial={{ opacity: 0, y: 16, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ ...spring, delay: Math.min(i, 12) * 0.025 }}
                    onClick={() => onPick(t.id)}
                    onPointerEnter={() => setHover(t)}
                    onPointerLeave={() => setHover(undefined)}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-paper text-left transition-shadow hover:shadow-[0_18px_44px_rgba(25,29,37,0.16)]"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden" style={{ background: `linear-gradient(135deg, ${hex(t.color)}1c, ${hex(t.color)}06)` }}>
                      <img src={templatePreview(t, dark)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain p-3 transition-transform duration-700 group-hover:scale-[1.08]" />
                      {t.tag && <span className="absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm" style={{ backgroundColor: hex(t.color) }}>{t.tag}</span>}
                      <span className="absolute inset-x-3 bottom-3 flex translate-y-3 items-center justify-center gap-1.5 rounded-xl bg-ink py-2 text-[12px] font-bold text-paper opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                        <Icon name="plus" className="h-3.5 w-3.5" /> Use this template
                      </span>
                    </div>
                    <div className="px-3.5 py-3">
                      <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hex(t.color) }} />
                        {t.name}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{t.blurb}</p>
                    </div>
                  </motion.button>
                ))}
              </AnimatePresence>
            </motion.div>
            {shown.length === 0 && <p className="py-20 text-center text-[14px] text-muted">No template matches “{query}”. Try the AI instead.</p>}
          </div>
          <footer className="flex h-11 items-center border-t border-edge px-5 text-[12px] text-muted">
            {hover ? (
              <span>
                <b className="text-ink">{hover.name}</b> · {hover.category} · {hover.build().length} shapes
              </span>
            ) : (
              <span>{shown.length} templates · click one to add it to the board</span>
            )}
          </footer>
        </div>
      </motion.div>
    </motion.div>
  );
}
