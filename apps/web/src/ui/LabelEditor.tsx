import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "../canvas/editor";
import { worldToScreen } from "../canvas/viewport";
import { useUiStore } from "../state/ui-store";

/**
 * Edits a shape's label in place: a textarea laid exactly over the shape (in screen
 * coordinates), committed on Enter or blur, cancelled with Escape. Shift+Enter = new line.
 */
export function LabelEditor({ editor }: { editor: Editor | null }) {
  const editing = useUiStore((s) => s.editing);
  const shape = editing && editor ? editor.scene.get(editing) : undefined;
  if (!editor || !editing || !shape) return null;
  return <EditorBox key={editing} editor={editor} id={editing} />;
}

function EditorBox({ editor, id }: { editor: Editor; id: string }) {
  const shape = editor.scene.get(id);
  const [value, setValue] = useState(shape?.label ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!shape) return null;
  const v = editor.renderer.viewport;
  const topLeft = worldToScreen(v, { x: shape.x, y: shape.y });
  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    if (commit) editor.setLabel(id, value.trim());
    useUiStore.getState().setEditing(undefined);
  };

  return (
    <motion.textarea
      ref={ref}
      value={value}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Escape") finish(false);
        else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
      }}
      maxLength={500}
      aria-label="Shape text"
      className="absolute resize-none rounded-[2px] border-2 border-accent bg-white/95 p-2.5 text-[15px] font-semibold leading-[19px] text-ink shadow-[0_8px_24px_rgba(17,19,24,0.18)] outline-none"
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: Math.max(160, shape.w * v.zoom),
        height: Math.max(64, shape.h * v.zoom),
        transformOrigin: "top left",
      }}
    />
  );
}
