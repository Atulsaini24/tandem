import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { branchOf, diffBranch, discardBranch, mergeBranch } from "../canvas/branch";
import type { Editor } from "../canvas/editor";
import { spring } from "./kit";
import { useSceneVersion } from "./useScene";

/**
 * On a branch: what's changed so far, Compare (original and branch side by side, both
 * live), Merge into the original, or Discard.
 */
export function BranchBar({ editor }: { editor: Editor | null }) {
  const version = useSceneVersion(editor, 600);
  const [compare, setCompare] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const record = editor ? branchOf(editor.docId) : undefined;
  const ops = useMemo(() => (editor && record ? diffBranch(record.base, editor.scene.ordered()) : undefined), [version, editor, record?.at]);
  if (!editor || !record || !ops) return null;
  const n = ops.added.length + ops.changed.length + ops.removed.length;
  return (
    <>
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring} className="pointer-events-none absolute inset-x-0 top-[64px] z-20 flex justify-center px-3">
        <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-[#22c3a6]/40 bg-[#062a22]/90 py-1.5 pl-3 pr-1.5 text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <span className="shrink-0 text-[15px]">🌿</span>
          <span className="shrink-0 text-[12px] font-semibold">
            Branch of <b>{record.parentTitle}</b>
          </span>
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-[#9ff5dc]">
            +{ops.added.length} ~{ops.changed.length} −{ops.removed.length}
          </span>
          <button type="button" onClick={() => setCompare(true)} className="shrink-0 rounded-full px-3 py-1 text-[12px] font-bold hover:bg-white/10">
            Compare
          </button>
          <button
            type="button"
            disabled={n === 0}
            onClick={() => mergeBranch(editor)}
            className="shrink-0 rounded-full bg-[#22c3a6] px-3 py-1 text-[12px] font-bold text-[#032019] disabled:opacity-40"
            title={n === 0 ? "No changes yet" : "Apply these changes to the original"}
          >
            Merge into original
          </button>
          <button
            type="button"
            onClick={() => (confirm ? discardBranch(editor) : setConfirm(true))}
            onBlur={() => setConfirm(false)}
            className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-bold ${confirm ? "bg-[#ff5c5c]" : "hover:bg-white/10"}`}
          >
            {confirm ? "Leave branch?" : "Discard"}
          </button>
        </div>
      </motion.div>
      <AnimatePresence>
        {compare && (
          <motion.div className="fixed inset-0 z-[60] flex flex-col bg-[#05060a]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onKeyDown={(e) => e.key === "Escape" && setCompare(false)}>
            <div className="flex items-center justify-between px-4 py-2.5 text-white">
              <span className="text-[14px] font-bold">
                Compare · <span className="text-white/60">original</span> ↔ <span className="text-[#9ff5dc]">branch</span> · {n} change{n === 1 ? "" : "s"}
              </span>
              <div className="flex gap-2">
                <button type="button" disabled={n === 0} onClick={() => mergeBranch(editor)} className="rounded-full bg-[#22c3a6] px-3 py-1.5 text-[12px] font-bold text-[#032019] disabled:opacity-40">
                  Merge into original
                </button>
                <button type="button" onClick={() => setCompare(false)} className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-bold hover:bg-white/20">
                  Close
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 md:grid-cols-2">
              {[
                { label: `Original · ${record.parentTitle}`, src: `/b/${record.parent}?mode=view`, tone: "#9aa0ab" },
                { label: "Branch (live)", src: `/b/${editor.docId}?mode=view`, tone: "#22c3a6" },
              ].map((p) => (
                <div key={p.src} className="relative overflow-hidden rounded-2xl border border-white/10">
                  <span className="absolute left-3 top-3 z-10 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white" style={{ boxShadow: `inset 0 0 0 1px ${p.tone}` }}>
                    {p.label}
                  </span>
                  <iframe title={p.label} src={p.src} className="h-full w-full border-0" />
                </div>
              ))}
            </div>
            <p className="pb-2 text-center text-[11px] text-white/40">Both sides are read-only views of the live boards.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
