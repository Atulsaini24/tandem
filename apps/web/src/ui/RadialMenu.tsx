import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Icon, type IconName } from "./kit";

interface Item {
  readonly icon: IconName;
  readonly label: string;
  readonly run: () => void;
  readonly danger?: boolean;
}

const RADIUS = 92;

/**
 * Right-click: a ring of actions around the pointer. On a shape: edit, connect, vote,
 * duplicate, order, frame, delete. On empty canvas: create things right there. The hub
 * names whatever you're pointing at.
 */
export function RadialMenu({ editor }: { editor: Editor | null }) {
  const radial = useUiStore((s) => s.radial);
  return <AnimatePresence>{radial && editor && <Ring key={`${radial.x}:${radial.y}`} editor={editor} x={radial.x} y={radial.y} target={radial.target} />}</AnimatePresence>;
}

function Ring({ editor, x, y, target }: { editor: Editor; x: number; y: number; target: string | undefined }) {
  const [hover, setHover] = useState<number | undefined>(undefined);
  const close = (): void => useUiStore.getState().setRadial(undefined);
  const world = editor.renderer.screenToWorld({ x: x - editor.renderer.app.canvas.getBoundingClientRect().left, y: y - editor.renderer.app.canvas.getBoundingClientRect().top });
  const shape = target ? editor.scene.get(target) : undefined;
  const voted = shape?.voters?.includes(editor.voterId) ?? false;

  const items: Item[] = shape
    ? [
        { icon: "text", label: "Edit text", run: () => editor.startEditing(shape.id) },
        { icon: "arrow", label: "Connect next step", run: () => editor.quickConnect(shape.id, "e") },
        { icon: "star", label: voted ? "Remove vote" : "Vote", run: () => void editor.toggleVote(shape.id) },
        { icon: "copy", label: "Duplicate", run: () => editor.duplicate() },
        { icon: "front", label: "Bring to front", run: () => editor.bringSelectionToFront() },
        { icon: "back", label: "Send to back", run: () => editor.sendSelectionToBack() },
        { icon: "group", label: "Wrap in frame", run: () => editor.frameSelection() },
        { icon: "trash", label: "Delete", run: () => editor.deleteSelection(), danger: true },
      ]
    : [
        { icon: "note", label: "Sticky note", run: () => editor.createNote(world) },
        { icon: "text", label: "Text", run: () => editor.createText(world) },
        { icon: "rect", label: "Rectangle", run: () => editor.createBox("rect", world) },
        { icon: "diamond", label: "Decision", run: () => editor.createBox("diamond", world) },
        { icon: "frame", label: "Frame", run: () => editor.createBox("frame", world) },
        { icon: "comment", label: "Comment", run: () => editor.createComment(world) },
        { icon: "copy", label: "Paste", run: () => editor.paste() },
        { icon: "sparkle", label: "Ask the AI", run: () => useUiStore.getState().setAiOpen(true) },
      ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the whole ring on screen.
  const cx = Math.min(window.innerWidth - RADIUS - 40, Math.max(RADIUS + 40, x));
  const cy = Math.min(window.innerHeight - RADIUS - 40, Math.max(RADIUS + 40, y));
  const label = hover === undefined ? (shape ? (shape.label?.trim() || shape.kind) : "Add here") : items[hover]?.label;

  return (
    <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div className="absolute" style={{ left: cx, top: cy }} onPointerDown={(e) => e.stopPropagation()}>
        <motion.div
          className="absolute -left-[118px] -top-[118px] h-[236px] w-[236px] rounded-full border border-white/20 bg-paper/40 shadow-[0_30px_80px_rgba(17,19,24,0.35)] backdrop-blur-xl"
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
        />
        <motion.div
          className="absolute -left-[46px] -top-[46px] grid h-[92px] w-[92px] place-items-center rounded-full bg-ink px-2 text-center text-[11px] font-bold leading-tight text-paper shadow-xl"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 28 }}
        >
          <AnimatePresence mode="popLayout">
            <motion.span key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="line-clamp-3">
              {label}
            </motion.span>
          </AnimatePresence>
        </motion.div>
        {items.map((item, i) => {
          const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <motion.button
              key={item.label}
              type="button"
              aria-label={item.label}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(undefined)}
              onClick={() => {
                close();
                item.run();
              }}
              initial={{ x: -22, y: -22, scale: 0, opacity: 0 }}
              animate={{ x: Math.cos(angle) * RADIUS - 22, y: Math.sin(angle) * RADIUS - 22, scale: 1, opacity: 1 }}
              exit={{ x: -22, y: -22, scale: 0, opacity: 0 }}
              whileHover={{ scale: 1.18 }}
              transition={{ type: "spring", stiffness: 460, damping: 26, delay: i * 0.018 }}
              className={`absolute left-0 top-0 grid h-11 w-11 place-items-center rounded-full border border-edge shadow-lg ${item.danger ? "bg-bad text-white" : "bg-paper text-ink hover:bg-accent hover:text-white"}`}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px]" />
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
