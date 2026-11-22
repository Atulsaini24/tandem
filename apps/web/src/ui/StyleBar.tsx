import { AnimatePresence, motion } from "motion/react";
import { PALETTE, type Editor } from "../canvas/editor";
import { NOTE_COLORS } from "../canvas/templates";
import { useUiStore } from "../state/ui-store";
import { IconButton, MOD, hexColor, panel, spring } from "./kit";

const SWATCHES = [...Object.values(NOTE_COLORS), ...PALETTE];

/**
 * Appears while something is selected: color, order, arrange, group, duplicate, delete.
 * Every action is one undo step and syncs like any other edit.
 */
export function StyleBar({ editor }: { editor: Editor | null }) {
  const selection = useUiStore((s) => s.selection);
  const locked = useUiStore((s) => s.sync.readOnly || s.viewMode || s.history !== undefined);
  const editing = useUiStore((s) => s.editing);
  const count = selection.size;
  const show = editor !== null && count > 0 && !locked && !editing;
  const first = editor && count > 0 ? editor.scene.get([...selection][0] ?? "") : undefined;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[76px] flex justify-center px-4">
      <AnimatePresence>
        {show && (
          <motion.div
            key="style"
            initial={{ y: -10, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -8, opacity: 0, scale: 0.98 }}
            transition={spring}
            className={`pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto p-1.5 scroll-quiet ${panel}`}
          >
            <span className="px-2 text-[11px] font-bold tabular-nums text-muted">{count === 1 ? (first?.kind ?? "1") : `${count} selected`}</span>
            <div className="flex items-center gap-1 px-1">
              {SWATCHES.map((color) => (
                <motion.button
                  key={color}
                  type="button"
                  title={hexColor(color)}
                  aria-label={`Color ${hexColor(color)}`}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => editor.setFillOfSelection(color)}
                  className="h-5 w-5 shrink-0 rounded-full border border-edge"
                  style={{ backgroundColor: hexColor(color), boxShadow: first?.fill === color ? `0 0 0 2px var(--color-paper), 0 0 0 4px ${hexColor(color)}` : undefined }}
                />
              ))}
            </div>
            <span className="mx-1 h-6 w-px shrink-0 bg-line" />
            <IconButton icon="rotate" title="Rotate 90°" onClick={() => editor.rotateSelection(Math.PI / 2)} />
            <IconButton icon="front" title="Bring to front (])" onClick={() => editor.bringSelectionToFront()} />
            <IconButton icon="back" title="Send to back ([)" onClick={() => editor.sendSelectionToBack()} />
            {count >= 2 && (
              <>
                <span className="mx-1 h-6 w-px shrink-0 bg-line" />
                <IconButton icon="alignLeft" title="Align left" onClick={() => editor.align("left")} />
                <IconButton icon="alignCenter" title="Align centers" onClick={() => editor.align("center")} />
                <IconButton icon="alignRight" title="Align right" onClick={() => editor.align("right")} />
                <IconButton icon="alignTop" title="Align top" onClick={() => editor.align("top")} />
                <IconButton icon="alignMiddle" title="Align middles" onClick={() => editor.align("middle")} />
                <IconButton icon="alignBottom" title="Align bottom" onClick={() => editor.align("bottom")} />
                {count >= 3 && (
                  <>
                    <IconButton icon="distributeX" title="Distribute horizontally" onClick={() => editor.distribute("x")} />
                    <IconButton icon="distributeY" title="Distribute vertically" onClick={() => editor.distribute("y")} />
                  </>
                )}
              </>
            )}
            <span className="mx-1 h-6 w-px shrink-0 bg-line" />
            <IconButton icon="group" title={`Wrap in a frame (${MOD}G)`} onClick={() => editor.frameSelection()} />
            <IconButton icon="copy" title={`Duplicate (${MOD}D)`} onClick={() => editor.duplicate()} />
            <IconButton icon="trash" title="Delete (Del)" onClick={() => editor.deleteSelection()} className="hover:text-bad" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
