import type { ShapeView } from "@canvas/doc";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import type { Editor } from "../canvas/editor";
import { visualBounds } from "../canvas/geometry";
import { TEMPLATES } from "../canvas/templates";
import { CANVAS_THEMES, displayFill, hex } from "../canvas/theme";
import { useUiStore } from "../state/ui-store";
import { InsertPanel } from "./InsertPanel";
import { Icon, spring, type IconName } from "./kit";
import { useSceneVersion } from "./useScene";

type Tab = "pages" | "layers" | "insert" | "templates";

const KIND_ICON: Record<ShapeView["kind"], IconName> = {
  rect: "rect",
  ellipse: "ellipse",
  diamond: "diamond",
  text: "text",
  frame: "frame",
  arrow: "arrow",
  path: "pen",
  comment: "comment",
  chart: "chart",
  scene3d: "cube",
  slide: "slides",
  art: "sparkle",
  embed: "link",
  poll: "star",
};

const describe = (s: ShapeView): string => {
  const text = s.label?.trim();
  if (text) return text.split("\n")[0] ?? text;
  if (s.kind === "rect") return s.fill === 0xffd666 ? "Sticky note" : "Rectangle";
  return s.kind[0]?.toUpperCase() + s.kind.slice(1);
};

/**
 * The Pro editor's left side: Pages (every frame, in reading order: click to fly there),
 * Layers (every shape, top first: click to select, search to filter) and Templates.
 */
export function LeftSidebar({ editor, open, onToggle }: { editor: Editor | null; open: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<Tab>("pages");
  const [query, setQuery] = useState("");
  const version = useSceneVersion(editor);
  const selection = useUiStore((s) => s.selection);
  const theme = useUiStore((s) => s.theme);

  const shapes = useMemo(() => (editor ? editor.scene.ordered() : []), [editor, version]);
  const pages = useMemo(() => (editor ? editor.slides().map((id) => editor.scene.get(id)).filter((s): s is ShapeView => s !== undefined) : []), [editor, version]);
  const layers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...shapes].reverse();
    return (q ? list.filter((s) => describe(s).toLowerCase().includes(q) || s.kind.includes(q)) : list).slice(0, 400);
  }, [shapes, query]);

  const flyTo = (s: ShapeView): void => {
    if (!editor) return;
    editor.select([s.id]);
    editor.renderer.fitTo(visualBounds(s, editor.lookup), 80, 0, 1.5, 700, true);
  };

  return (
    <>
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            key="left"
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={spring}
            className="pointer-events-auto absolute bottom-0 left-0 top-14 z-10 flex w-64 flex-col border-r border-edge bg-paper/90 backdrop-blur-xl"
          >
            <div className="grid grid-cols-4 gap-1 border-b border-edge p-2">
              {(["pages", "layers", "insert", "templates"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className="relative h-8 rounded-lg text-[11px] font-bold capitalize">
                  {tab === t && <motion.span layoutId="left-tab" transition={spring} className="absolute inset-0 rounded-lg bg-hover" />}
                  <span className={`relative ${tab === t ? "text-ink" : "text-muted"}`}>{t}</span>
                </button>
              ))}
            </div>

            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-2">
              {tab === "pages" && (
                <>
                  <p className="px-2 pb-2 pt-1 text-[11px] leading-relaxed text-muted">Frames are pages: click to fly there. In Present mode each one is a slide.</p>
                  {pages.length === 0 && (
                    <button type="button" onClick={() => useUiStore.getState().setTool("frame")} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line p-3 text-left text-[12px] font-semibold text-muted hover:border-accent hover:text-accent">
                      <Icon name="plus" className="h-4 w-4" /> Draw a frame (F) to make a page
                    </button>
                  )}
                  {pages.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => flyTo(s)}
                      className={`group mb-1 flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors ${selection.has(s.id) ? "bg-accent/12 ring-1 ring-accent/40" : "hover:bg-hover"}`}
                    >
                      <span className="grid h-10 w-14 shrink-0 place-items-center rounded-lg border border-line text-[11px] font-bold text-muted" style={{ background: `${hex(displayFill(s.fill, CANVAS_THEMES[theme]))}22` }}>
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-ink">{s.label ?? `Page ${i + 1}`}</span>
                        <span className="block text-[11px] text-muted">
                          {Math.round(s.w)} × {Math.round(s.h)}
                        </span>
                      </span>
                    </button>
                  ))}
                </>
              )}

              {tab === "layers" && (
                <>
                  <div className="relative mb-2">
                    <Icon name="search" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder={`Search ${shapes.length} layers`}
                      className="h-8 w-full rounded-lg border border-line bg-field pl-8 pr-2 text-[12px] text-ink outline-none focus:border-accent"
                    />
                  </div>
                  {layers.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={(e) => (e.shiftKey ? editor?.select([...selection, s.id]) : editor?.select([s.id]))}
                      onDoubleClick={() => flyTo(s)}
                      title="Click to select · double-click to fly there"
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${selection.has(s.id) ? "bg-accent text-white" : "text-ink hover:bg-hover"}`}
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded" style={{ color: selection.has(s.id) ? "white" : hex(s.kind === "arrow" || s.kind === "text" ? 0x6c6f76 : s.fill) }}>
                        <Icon name={KIND_ICON[s.kind]} className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{describe(s)}</span>
                      {(s.voters?.length ?? 0) > 0 && <span className="rounded-full bg-[#dd2f6e] px-1.5 text-[10px] font-bold text-white">{s.voters?.length}</span>}
                    </button>
                  ))}
                  {shapes.length > 400 && !query && <p className="px-2 py-2 text-[11px] text-muted">Showing the top 400 of {shapes.length}. Search to find the rest.</p>}
                </>
              )}

              {tab === "insert" && <InsertPanel editor={editor} />}

              {tab === "templates" && (
                <div className="space-y-2">
                  <button type="button" onClick={() => useUiStore.getState().setGalleryOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5b8cff] to-[#b36bff] py-2.5 text-[13px] font-bold text-white shadow-[0_8px_24px_rgba(91,140,255,0.3)]">
                    ✨ Browse all {TEMPLATES.length} templates
                  </button>
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => editor?.insertTemplate(t.id, editor.freeSpotCenter(1200, 700))}
                      className="w-full rounded-xl border border-line bg-field p-3 text-left hover:border-ink/30"
                    >
                      <span className="mb-1.5 flex items-center gap-2">
                        <span className="block h-1.5 w-8 rounded-full" style={{ backgroundColor: hex(t.color) }} />
                        {t.tag && <span className="rounded-full px-1.5 text-[10px] font-bold" style={{ color: hex(t.color), backgroundColor: `${hex(t.color)}1f` }}>{t.tag}</span>}
                      </span>
                      <span className="block text-[13px] font-bold text-ink">{t.name}</span>
                      <span className="block text-[11px] leading-snug text-muted">{t.blurb}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-edge px-3 py-2 text-[11px] text-muted">
              <span>{shapes.length.toLocaleString()} shapes</span>
              <span>{pages.length} pages</span>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={onToggle}
        title={open ? "Hide sidebar" : "Show pages and layers"}
        className={`pointer-events-auto absolute top-[68px] z-10 grid h-8 w-8 place-items-center rounded-lg border border-edge bg-paper/90 text-muted shadow-sm backdrop-blur hover:text-ink ${open ? "left-[268px]" : "left-3"}`}
      >
        <Icon name="back2" className={`h-4 w-4 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </>
  );
}
