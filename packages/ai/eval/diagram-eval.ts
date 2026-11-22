/**
 * Evaluate diagrams and insights against a REAL local model.
 *
 *   pnpm --filter @canvas/ai eval:diagram      (model: OLLAMA_MODEL or gemma3:4b)
 *
 * Per case: time to the first node, total time, nodes/edges accepted, items rejected by
 * validation, and whether every node ended up connected (a disconnected node is a
 * diagram the user has to fix by hand).
 */
import { layoutDiagram, runDiagram, runInsight, type DiagramKind, type DiagramNode } from "../src/index.js";

const url = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "gemma3:4b";
const options = { url, model };

const diagrams: Array<{ kind: DiagramKind; prompt: string }> = [
  { kind: "flowchart", prompt: "How a pull request gets merged" },
  { kind: "flowchart", prompt: "Customer refund process" },
  { kind: "mindmap", prompt: "Ideas for a team offsite" },
  { kind: "mindmap", prompt: "Growing a newsletter" },
];

const board = [
  "Section: To do",
  "Write the launch announcement",
  "Record a 60-second demo",
  "Section: In progress",
  "Polish onboarding flow",
  "Fix sync on flaky Wi-Fi",
  "Section: Done",
  "Offline mode",
  "Time travel",
];

async function main(): Promise<void> {
  console.log(`model: ${model}\n`);
  for (const c of diagrams) {
    const started = performance.now();
    let first: number | undefined;
    const nodes: DiagramNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];
    let rejected = 0;
    let tps: number | undefined;
    for await (const event of runDiagram(c.kind, c.prompt, options)) {
      if (event.type === "node") {
        first ??= performance.now() - started;
        nodes.push({ id: event.id, shape: event.shape });
      } else if (event.type === "edge") edges.push(event);
      else if (event.type === "done") {
        rejected = event.rejected;
        tps = event.tokensPerSecond;
      }
    }
    const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
    const orphans = nodes.filter((n) => !linked.has(n.id)).length;
    const placed = layoutDiagram(c.kind, nodes, edges, { x: 0, y: 0 }).size;
    console.log(
      `${c.kind.padEnd(9)} ${c.prompt.padEnd(34)} first node ${((first ?? 0) / 1000).toFixed(1)}s · total ${((performance.now() - started) / 1000).toFixed(1)}s · ${nodes.length} nodes · ${edges.length} edges · ${rejected} rejected · ${orphans} unconnected · ${placed} laid out${tps ? ` · ${tps} tok/s` : ""}`,
    );
  }

  const started = performance.now();
  let summary = "";
  const points: string[] = [];
  const missing: string[] = [];
  for await (const event of runInsight("", board, options)) {
    if (event.type === "summary") summary = event.text;
    if (event.type === "point") points.push(event.text);
    if (event.type === "missing") missing.push(event.text);
  }
  console.log(`\ninsight   kanban board · ${((performance.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  summary: ${summary}`);
  console.log(`  points:  ${points.join(" | ")}`);
  console.log(`  missing: ${missing.join(" | ")}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
