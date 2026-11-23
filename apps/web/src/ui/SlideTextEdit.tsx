import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHART_THEMES } from "../canvas/charts";
import type { Editor } from "../canvas/editor";
import { designSvg } from "../canvas/export";
import { getPath, setPath } from "../canvas/field-path";
import { parseSlide, THEMES } from "../canvas/slides";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd } from "./kit";
import { useSceneVersion } from "./useScene";

interface Field {
  readonly path: string;
  /** Where the text sits, relative to the slide box (screen px). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly size: number;
  readonly weight: string;
  readonly anchor: string;
  readonly color: string;
}

/**
 * Edit a designed slide's text right on the canvas: double-click the slide, hover to see
 * what's editable, click any title, card, number or quote and type. Enter saves (Shift+Enter
 * for a new line), Esc cancels. Studio is one click away for layout, theme and the rest.
 */
export function SlideTextEdit({ editor }: { editor: Editor | null }) {
  const id = useUiStore((s) => s.slideEdit);
  if (!editor || !id) return null;
  return <Overlay key={id} editor={editor} id={id} />;
}

function Overlay({ editor, id }: { editor: Editor; id: string }) {
  const version = useSceneVersion(editor, 150);
  const box = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const group = useRef(editor.beginGroup());
  const [hover, setHover] = useState<Field | undefined>(undefined);
  const [field, setField] = useState<Field | undefined>(undefined);
  const [text, setText] = useState("");
  const shape = editor.scene.get(id);
  const theme = editor.renderer.theme.name;
  const w = Math.max(40, Math.round(shape?.w ?? 0));
  const h = Math.max(30, Math.round(shape?.h ?? 0));
  const svg = useMemo(() => (shape ? designSvg(shape.kind, shape.data, shape.label, w, h, CHART_THEMES[theme]) : ""), [shape?.data, shape?.label, w, h, theme, version]);
  const ink = useMemo(() => {
    const spec = parseSlide(shape?.data);
    return spec ? THEMES[spec.theme].ink : "#ffffff";
  }, [shape?.data]);
  const exit = (): void => useUiStore.getState().setSlideEdit(undefined);

  // Glue the editor to the slide on screen, through pans and zooms.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = box.current;
      const s = editor.renderer.lookup(id);
      if (!el || !s) return;
      const a = editor.renderer.worldToScreen({ x: s.x, y: s.y });
      const z = editor.renderer.viewport.zoom;
      el.style.transform = `translate(${a.x}px, ${a.y}px)`;
      el.style.width = `${s.w * z}px`;
      el.style.height = `${s.h * z}px`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editor, id]);

  // Click anywhere else (or Esc) to finish.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node) && !(e.target as Element).closest?.("[data-slide-edit-ui]")) exit();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !field) {
        e.stopImmediatePropagation();
        exit();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [field]);

  if (!shape || shape.kind !== "slide") return null;

  const measure = (el: Element): Field | undefined => {
    const path = el.getAttribute("data-f");
    const host = box.current;
    if (!path || !host) return undefined;
    const r = el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const scale = hr.width / 960; // slides are designed at 960 wide
    const fill = el.getAttribute("fill") ?? "";
    return {
      path,
      x: r.left - hr.left,
      y: r.top - hr.top,
      w: r.width,
      h: r.height,
      size: Number(el.getAttribute("font-size") ?? 16) * scale,
      weight: el.getAttribute("font-weight") ?? "400",
      anchor: el.getAttribute("text-anchor") ?? "start",
      color: fill.startsWith("url(") || !fill ? ink : fill,
    };
  };
  const target = (e: React.PointerEvent | React.MouseEvent): Element | null => (e.target as Element).closest?.("[data-f]") ?? null;

  const begin = (f: Field): void => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(shape.data ?? "{}") as Record<string, unknown>;
    } catch {
      // empty
    }
    setText(getPath(data, f.path));
    setField(f);
    setHover(undefined);
  };
  const commit = (): void => {
    if (!field) return;
    try {
      const data = JSON.parse(shape.data ?? "{}") as Record<string, unknown>;
      if (getPath(data, field.path) !== text) {
        const next = setPath(data, field.path, text);
        const label = field.path === "title" ? text.replace(/\*/g, "").slice(0, 120) : undefined;
        // A new title also renames the slide's frame (its page name in Pages and Present).
        const frame = label ? editor.scene.ordered().find((s) => s.kind === "frame" && Math.abs(s.x - shape.x) < 2 && Math.abs(s.y - shape.y) < 2 && Math.abs(s.w - shape.w) < 2) : undefined;
        const number = frame?.label?.match(/^\d+\.\s/)?.[0] ?? "";
        editor.updateShapes(
          [{ id, patch: { data: JSON.stringify(next), ...(label ? { label } : {}) } }, ...(frame && label ? [{ id: frame.id, patch: { label: `${number}${label}`.slice(0, 120) } }] : [])],
          group.current,
        );
      }
    } catch {
      // unparseable: leave it
    }
    setField(undefined);
  };

  return (
    <div
      ref={box}
      className="pointer-events-auto absolute left-0 top-0 z-30 rounded-[4px] ring-2 ring-accent ring-offset-2 ring-offset-transparent"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        ref={art}
        className="slide-edit showcase-art h-full w-full overflow-hidden"
        onPointerMove={(e) => {
          if (field) return;
          const el = target(e);
          setHover(el ? measure(el) : undefined);
        }}
        onPointerLeave={() => setHover(undefined)}
        onClick={(e) => {
          const el = target(e);
          const f = el ? measure(el) : undefined;
          if (field) commit();
          if (f) begin(f);
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {hover && !field && (
        <div className="pointer-events-none absolute rounded-md border-2 border-dashed border-accent bg-accent/10" style={{ left: hover.x - 6, top: hover.y - 4, width: hover.w + 12, height: hover.h + 8 }}>
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">Click to edit</span>
        </div>
      )}
      {field && <FieldInput field={field} value={text} onChange={setText} onCommit={commit} onCancel={() => setField(undefined)} />}
      <div data-slide-edit-ui className="absolute -top-12 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-edge bg-paper/95 p-1 shadow-xl backdrop-blur">
        <span className="flex items-center gap-1.5 px-2.5 text-[12px] font-semibold text-muted">
          <Icon name="text" className="h-3.5 w-3.5 text-accent" /> Click any text to edit
        </span>
        <button
          type="button"
          onClick={() => {
            exit();
            useUiStore.getState().setStudio(id);
          }}
          className="flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#5b8cff] to-[#b36bff] px-3 text-[12px] font-bold text-white"
        >
          <Icon name="sparkle" className="h-3.5 w-3.5" /> Studio
        </button>
        <button type="button" onClick={exit} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-ink hover:bg-hover">
          Done <Kbd>Esc</Kbd>
        </button>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange, onCommit, onCancel }: { field: Field; value: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  // Grow with the text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const width = Math.max(field.w + 24, 180);
  const left = field.anchor === "middle" ? field.x + field.w / 2 - width / 2 : field.anchor === "end" ? field.x + field.w - width + 12 : field.x - 8;
  return (
    <textarea
      ref={ref}
      data-slide-edit-ui
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="absolute resize-none overflow-hidden rounded-lg border-2 border-accent bg-black/70 px-2 py-1 leading-tight shadow-2xl outline-none backdrop-blur"
      style={{
        left,
        top: field.y - 6,
        width,
        minHeight: field.h + 12,
        fontSize: Math.max(12, field.size),
        fontWeight: field.weight,
        color: field.color,
        textAlign: field.anchor === "middle" ? "center" : field.anchor === "end" ? "right" : "left",
        fontFamily: "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
      }}
    />
  );
}
