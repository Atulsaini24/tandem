import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { listModels, type ModelInfo } from "../canvas/ai-models";
import type { Editor } from "../canvas/editor";
import { useUiStore } from "../state/ui-store";
import { Icon, Kbd, MOD, spring, type IconName } from "./kit";

export type AiMode = "board" | "flowchart" | "mindmap" | "chart" | "scene" | "deck" | "insight";

const MODES: ReadonlyArray<{ id: AiMode; label: string; icon: IconName; placeholder: string; action: string; examples: readonly string[]; blurb: string }> = [
  {
    id: "board",
    label: "Plan",
    icon: "frame",
    blurb: "A detailed plan: sections with tasks, owners, dates, priorities and dependencies.",
    placeholder: "e.g. Launch a SaaS product in 90 days",
    action: "Create plan",
    examples: ["Launch a SaaS product in 90 days", "Organize a 150-guest wedding in Goa", "6-month full-stack developer roadmap"],
  },
  {
    id: "flowchart",
    label: "Flow",
    icon: "arrow",
    blurb: "Steps, decisions and connectors, laid out with as few crossings as possible.",
    placeholder: "e.g. Online food order with refunds",
    action: "Draw flowchart",
    examples: ["Online food order with payment, refunds and ratings", "Engineer hiring pipeline with rejection paths", "Bug lifecycle from report to release"],
  },
  {
    id: "mindmap",
    label: "Mind map",
    icon: "sparkle",
    blurb: "A central topic with colored branches and ideas.",
    placeholder: "e.g. Starting a coffee shop",
    action: "Draw mind map",
    examples: ["Starting a coffee shop", "Artificial intelligence: uses, risks, careers", "Get fit in 6 months"],
  },
  {
    id: "chart",
    label: "Chart",
    icon: "chart",
    blurb: "Bar, line, area, pie, donut or funnel charts with numbers — editable on the board.",
    placeholder: "e.g. Monthly revenue of a growing startup",
    action: "Make chart",
    examples: ["Monthly revenue of a growing SaaS startup in 2025", "Website signup funnel from visit to paid", "Market share of smartphone brands"],
  },
  {
    id: "scene",
    label: "3D",
    icon: "cube",
    blurb: "An interactive 3D scene in a frame you can orbit, with animation.",
    placeholder: "e.g. The solar system",
    action: "Build 3D scene",
    examples: ["The solar system", "A 3-tier web architecture", "A city block with buildings and trees"],
  },
  {
    id: "deck",
    label: "Slides",
    icon: "slides",
    blurb: "A slide deck as frames, played with animated reveals in Present mode.",
    placeholder: "e.g. Pitch deck for a fitness app",
    action: "Create deck",
    examples: ["Pitch deck for a fitness app startup", "Explain how CRDTs work", "Quarterly business review"],
  },
  {
    id: "insight",
    label: "Summarize",
    icon: "search",
    blurb: "Reads the board (or selection): summary, key points and what's missing.",
    placeholder: "Optional focus, e.g. biggest risks",
    action: "Summarize board",
    examples: ["What are the biggest risks?", "What should we do first?", "Who owns what?"],
  },
];

function useElapsed(startedAt: number | undefined, running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);
  return startedAt ? Math.max(0, (running ? now : Date.now()) - startedAt) / 1000 : 0;
}

/** Choose which installed local model answers (bigger = smarter, slower). */
function ModelPicker() {
  const model = useUiStore((s) => s.aiModel);
  const setModel = useUiStore((s) => s.setAiModel);
  const [models, setModels] = useState<ModelInfo[] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void listModels().then((list) => {
      if (!alive) return;
      setModels(list);
      // The saved model isn't installed: use the best one that is.
      const first = list[0];
      if (first && !list.some((m) => m.name === model)) setModel(first.name);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (models && models.length === 0) {
    return <p className="rounded-xl bg-bad/10 px-3 py-2 text-[11px] text-bad">Ollama isn't running. Start it to use the AI.</p>;
  }
  return (
    <label className="flex items-center gap-2 rounded-xl border border-line bg-field px-2.5 py-1.5">
      <span className="text-[11px] font-bold text-muted">Model</span>
      <select value={model} onChange={(e) => setModel(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-ink outline-none">
        {(models ?? [{ name: model, blurb: "", sizeGb: 0 }]).map((m) => (
          <option key={m.name} value={m.name}>
            {m.name}
            {m.blurb ? ` — ${m.blurb}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The AI assistant (local model via Ollama: nothing leaves this machine). Lives in the
 * right panel's AI tab. Every mode streams onto the canvas as the model writes, into
 * empty space beside the board, and each run is one undo step.
 */
export function AiAssistant({ editor }: { editor: Editor | null }) {
  const ai = useUiStore((s) => s.ai);
  const selectionSize = useUiStore((s) => s.selection.size);
  const [mode, setMode] = useState<AiMode>("board");
  const [prompt, setPrompt] = useState("");
  const running = ai.status === "thinking" || ai.status === "writing";
  const elapsed = useElapsed(ai.startedAt, running);
  const organizable = editor ? editor.ai.organizable().length : 0;
  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  void selectionSize;

  const run = (): void => {
    if (!editor || running) return;
    if (mode === "board") void editor.ai.generate(prompt);
    else if (mode === "flowchart" || mode === "mindmap") void editor.ai.diagram(mode, prompt);
    else if (mode === "chart") void editor.ai.chart(prompt);
    else if (mode === "scene") void editor.ai.scene(prompt);
    else if (mode === "deck") void editor.ai.deck(prompt);
    else void editor.ai.insight(prompt);
  };
  if (!current) return null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10.5px] font-bold transition-colors ${mode === m.id ? "text-white" : "text-muted hover:bg-hover hover:text-ink"}`}
          >
            {mode === m.id && <motion.span layoutId="ai-mode" transition={spring} className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#2f63ff] to-[#7b6cff] shadow-[0_8px_20px_rgba(47,99,255,0.35)]" />}
            <Icon name={m.icon} className="relative h-4 w-4" />
            <span className="relative">{m.label}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="popLayout">
        <motion.p key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[12px] leading-relaxed text-muted">
          {current.blurb}
        </motion.p>
      </AnimatePresence>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
        }}
        rows={3}
        maxLength={2000}
        placeholder={current.placeholder}
        className="w-full resize-none rounded-2xl border border-line bg-field p-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent"
      />
      <div className="flex flex-wrap gap-1.5">
        {current.examples.map((s) => (
          <button key={s} type="button" onClick={() => setPrompt(s)} className="rounded-full border border-line bg-field px-2.5 py-1 text-left text-[11px] font-medium text-muted hover:border-ink/30 hover:text-ink">
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {running ? (
          <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => editor?.ai.cancel()} className="h-10 flex-1 rounded-xl border border-line text-[13px] font-semibold text-ink hover:bg-hover">
            Stop
          </motion.button>
        ) : (
          <>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              disabled={!editor}
              onClick={run}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2f63ff] to-[#7b6cff] text-[13px] font-bold text-white shadow-[0_10px_24px_rgba(47,99,255,0.3)] disabled:opacity-30"
            >
              <Icon name={current.icon} className="h-4 w-4" />
              {current.action}
            </motion.button>
            {mode === "board" && organizable >= 2 && (
              <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => void editor?.ai.organize(prompt)} className="h-10 rounded-xl border border-line px-3 text-[12px] font-semibold text-ink hover:bg-hover">
                Organize {organizable}
              </motion.button>
            )}
          </>
        )}
      </div>
      <ModelPicker />
      <p className="text-center text-[10px] text-muted">
        <Kbd>{MOD}Enter</Kbd> to run · runs on this computer · Undo removes a whole run
      </p>

      <AnimatePresence mode="popLayout">
        {ai.status !== "idle" && (
          <motion.div key={ai.status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`rounded-2xl px-3 py-2.5 text-[12px] ${ai.status === "error" ? "bg-bad/10 text-bad" : "bg-hover text-ink"}`}>
            {ai.status === "thinking" && (
              <span className="flex items-center gap-2">
                <motion.span className="h-2 w-2 rounded-full bg-accent" animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1, repeat: Infinity }} />
                Thinking… {elapsed.toFixed(0)}s (the first run loads the model)
              </span>
            )}
            {ai.status === "writing" && (
              <>
                Writing: <b>{ai.items}</b> so far · {elapsed.toFixed(0)}s
              </>
            )}
            {ai.status === "done" && (
              <>
                Done: <b>{ai.items}</b> items in {elapsed.toFixed(0)}s{ai.tokensPerSecond ? ` · ${ai.tokensPerSecond} tok/s` : ""}.
                {ai.message ? <div className="mt-1 text-muted">{ai.message}</div> : null}
                <div className="mt-2.5 flex gap-2">
                  {ai.result && (
                    <button type="button" onClick={() => ai.result && editor?.fitTo(ai.result)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-ink text-[12px] font-bold text-paper">
                      <Icon name="fit" className="h-3.5 w-3.5" /> Show result
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      editor?.undo();
                      useUiStore.getState().setAi({ status: "idle", items: 0 });
                    }}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] font-bold text-ink hover:border-bad hover:text-bad"
                  >
                    <Icon name="undo" className="h-3.5 w-3.5" /> Undo this run
                  </button>
                </div>
              </>
            )}
            {(ai.status === "error" || ai.status === "cancelled") && ai.message}
            {ai.mode === "insight" && ai.summary && ai.status !== "error" && <p className="mt-2 border-t border-line pt-2 text-[12px] leading-relaxed text-ink">{ai.summary}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
