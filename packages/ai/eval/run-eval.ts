/**
 * Evaluate the assistant against a REAL local model (not the fake used in unit tests).
 *
 *   pnpm --filter @canvas/ai eval            (model: OLLAMA_MODEL or gemma3:4b)
 *
 * For each case: time to the first card (what the user feels), total time, cards placed,
 * suggestions rejected by validation, and for "organize" how many existing notes the
 * model actually placed. Unit tests prove the pipeline is safe with ANY output; this
 * measures how good a particular model's output is.
 */
import { runAssistant, type AiRequest } from "../src/index.js";

const url = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "gemma3:4b";

const NOTES = [
  "Fix login timeout bug",
  "Design onboarding screens",
  "Set up crash reporting",
  "Write App Store description",
  "Load test the API",
  "Pick pricing tiers",
  "Beta invite emails",
  "Accessibility audit",
];

const cases: Array<{ name: string; request: AiRequest }> = [
  { name: "generate: app launch", request: { mode: "generate", prompt: "Plan a mobile app launch" } },
  { name: "generate: retro", request: { mode: "generate", prompt: "Sprint retro: went well, didn't go well, action items" } },
  { name: "organize: 8 notes → roadmap", request: { mode: "organize", prompt: "Organize into a Now / Next / Later roadmap", notes: NOTES } },
];

async function main(): Promise<void> {
  console.log(`model ${model} at ${url}\n`);
  const rows = [];
  for (const { name, request } of cases) {
    const started = performance.now();
    let firstCard: number | undefined;
    let columns = 0;
    let summary: { items: number; rejected: number; unplaced: readonly number[]; tokensPerSecond?: number } | undefined;
    for await (const event of runAssistant(request, { url, model })) {
      if (event.type === "item") firstCard ??= performance.now() - started;
      if (event.type === "column") columns += 1;
      if (event.type === "done") summary = event;
    }
    const total = (performance.now() - started) / 1000;
    const placedNotes = request.mode === "organize" ? `${request.notes.length - (summary?.unplaced.length ?? 0)}/${request.notes.length}` : "—";
    rows.push({
      case: name,
      firstCardS: firstCard === undefined ? "—" : (firstCard / 1000).toFixed(1),
      totalS: total.toFixed(1),
      columns,
      cards: summary?.items ?? 0,
      rejected: summary?.rejected ?? 0,
      notesPlaced: placedNotes,
      tokPerS: summary?.tokensPerSecond ?? "—",
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
  console.log();
  console.table(rows);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
