import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "../canvas/editor";
import { arrowEnds } from "../canvas/geometry";
import { displayFill, hex, labelColor } from "../canvas/theme";
import { useUiStore } from "../state/ui-store";

const LIVE_MS = 150;

/**
 * Edits a shape's text in place: a textarea laid over the shape (screen coordinates,
 * rotated with it). Text streams to collaborators as you type (every ~150ms), so they see
 * it appear live. Enter or clicking away commits, Esc puts the old text back,
 * Shift+Enter is a new line.
 */
export function LabelEditor({ editor }: { editor: Editor | null }) {
  const editing = useUiStore((s) => s.editing);
  const shape = editing && editor ? editor.scene.get(editing) : undefined;
  if (!editor || !editing || !shape) return null;
  return <EditorBox key={editing} editor={editor} id={editing} />;
}

function EditorBox({ editor, id }: { editor: Editor; id: string }) {
  const initial = useRef(editor.scene.get(id)?.label ?? "");
  const [value, setValue] = useState(() => {
    const buffered = useUiStore.getState().editBuffer;
    return buffered ? initial.current.trim() + buffered : initial.current.trim();
  });
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const live = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, force] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    node?.focus();
    if (useUiStore.getState().editBuffer) node?.setSelectionRange(node.value.length, node.value.length);
    else node?.select();
    useUiStore.getState().setEditBuffer("");
  }, []);

  useEffect(() => {
    // Sync remote FugueText edits into the open textarea without clobbering the user's cursor.
    let lastVersion = editor.scene.version;
    const timer = setInterval(() => {
      if (editor.scene.version === lastVersion) return;
      lastVersion = editor.scene.version;
      const remoteLabel = editor.scene.get(id)?.label;
      if (remoteLabel === undefined) return;
      setValue((prev) => {
        if (prev === remoteLabel) return prev;
        const node = ref.current;
        if (node && document.activeElement === node) {
          const start = node.selectionStart ?? prev.length;
          const end = node.selectionEnd ?? prev.length;
          requestAnimationFrame(() => {
            if (ref.current) {
              const clampedStart = Math.min(start, remoteLabel.length);
              const clampedEnd = Math.min(end, remoteLabel.length);
              ref.current.setSelectionRange(clampedStart, clampedEnd);
            }
          });
        }
        return remoteLabel;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [editor, id]);

  useEffect(() => {
    // Follow the shape if the camera moves while typing.
    let raf = 0;
    let last = "";
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const v = editor.renderer.viewport;
      const key = `${v.x}|${v.y}|${v.zoom}`;
      if (key !== last) {
        last = key;
        force((n) => n + 1);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(live.current);
    };
  }, [editor]);

  const shape = editor.scene.get(id);
  if (!shape) return null;
  const v = editor.renderer.viewport;
  const zoom = v.zoom;

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    clearTimeout(live.current);
    if (commit) editor.setLabel(id, value.trim());
    else editor.setLabel(id, initial.current.trim() ? initial.current : "");
    useUiStore.getState().setEditing(undefined);
  };

  // Where the box goes, by kind.
  let left = shape.x;
  let top = shape.y;
  let width = shape.w;
  let height = shape.h;
  let style = "rounded-[10px] border-2 border-accent bg-field p-2.5 text-[15px] font-semibold leading-[19px]";
  if (shape.kind === "text") style = "rounded-md border-2 border-dashed border-accent/60 bg-transparent p-0.5 text-[24px] font-bold leading-[30px]";
  if (shape.kind === "comment") {
    left = shape.x + 34;
    top = shape.y - 2;
    width = 260;
    height = 90;
  }
  if (shape.kind === "frame") {
    top = shape.y - 30;
    height = 26;
    width = Math.min(360, shape.w);
    style = "rounded-md border-2 border-accent bg-field px-1.5 text-[14px] font-bold leading-[18px]";
  }
  if (shape.kind === "arrow") {
    const { a, b } = arrowEnds(shape, editor.lookup);
    width = 160;
    height = 34;
    left = (a.x + b.x) / 2 - width / 2;
    top = (a.y + b.y) / 2 - height / 2;
    style = "rounded-xl border-2 border-accent bg-field px-2 py-1 text-center text-[13px] font-semibold";
  }
  const screen = editor.renderer.worldToScreen({ x: left, y: top });
  const theme = editor.renderer.theme;
  const tinted = shape.kind === "rect" || shape.kind === "ellipse" || shape.kind === "diamond";
  const colors = tinted ? { backgroundColor: hex(displayFill(shape.fill, theme)), color: hex(labelColor(displayFill(shape.fill, theme))) } : {};
  const rotation = shape.kind === "comment" || shape.kind === "arrow" || shape.kind === "frame" ? 0 : (shape.rotation ?? 0);
  const minW = shape.kind === "arrow" ? 120 : 160;

  return (
    <motion.textarea
      ref={ref}
      value={value}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      placeholder={shape.kind === "comment" ? "Write a comment…" : shape.kind === "text" ? "Type something" : ""}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        clearTimeout(live.current);
        live.current = setTimeout(() => {
          if (next.trim()) editor.setLabel(id, next);
        }, LIVE_MS);
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(false);
        else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
      }}
      maxLength={500}
      aria-label="Shape text"
      className={`absolute z-20 resize-none text-ink shadow-[0_8px_24px_rgba(17,19,24,0.18)] outline-none ${style}`}
      style={{
        ...colors,
        left: screen.x,
        top: screen.y,
        width: Math.max(minW / zoom, width),
        height: Math.max((shape.kind === "frame" ? 26 : 44) / zoom, height),
        transform: `scale(${zoom}) rotate(${rotation}rad)`,
        transformOrigin: rotation ? `${width / 2}px ${height / 2}px` : "top left",
        ...(rotation ? { transformOrigin: "center", left: screen.x + ((width * zoom) - width) / 2, top: screen.y + ((height * zoom) - height) / 2 } : {}),
      }}
    />
  );
}
