import type { NodeId, ShapeProps, ShapeView } from "@canvas/doc";
import {
  COLORS,
  OllamaError,
  headerRect,
  CHART_SCHEMA,
  SCENE_SCHEMA,
  buildChartMessages,
  buildSceneMessages,
  layoutDiagram,
  runDeckFast,
  runVision,
  runIllustration,
  runSuggest,
  runVoiceCommand,
  runMeeting,
  isVisionModel,
  buildSlideRewriteMessages,
  buildChartRewriteMessages,
  SLIDE_SCHEMA,
  runJson,
  runDiagram,
  runInsight,
  stagingRect,
  type DiagramKind,
  type DiagramNode,
  type NodeShape,
  itemRect,
  runAssistant,
  titleRect,
  type AiEvent,
  type AiRequest,
  type Point,
  type Rect,
} from "@canvas/ai";
import { useUiStore } from "../state/ui-store";
import { chatOptions, listModels } from "./ai-models";
import { nearestNote, sampleColors, type PreparedImage } from "./image";
import { parseChart } from "./charts";
import { parseScene } from "./scenes";
import { hashTheme, SLIDE_H, SLIDE_THEMES, SLIDE_W, type SlideThemeName } from "./slides";
import { boundsOf, intersects, visualBounds } from "./geometry";
import { parseArt } from "./art";
import { tidy } from "./features";
import { INK, NOTE_COLORS } from "./templates";
import type { Editor } from "./editor";

/** The model the user picked, with the right options for it. */
const llm = (signal: AbortSignal) => ({ ...chatOptions(useUiStore.getState().aiModel), signal });
const TITLE_FILL = 0x111318;
const NOTE_FILL = COLORS.yellow;

/**
 * Turns the assistant's streamed board events into canvas edits.
 *
 * Every edit of one run shares one undo group (Ctrl+Z removes the whole result) and
 * syncs to collaborators like any edit. Cards are placed as each one finishes streaming,
 * with a fade/glide, so the board fills in while the model is still writing.
 */
export class AiRunner {
  readonly #editor: Editor;
  #abort: AbortController | undefined;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  get running(): boolean {
    return this.#abort !== undefined;
  }

  cancel(): void {
    this.#abort?.abort();
  }

  /** Brainstorm a new board from a prompt, placed in the visible area. */
  generate(prompt: string): Promise<void> {
    return this.#run({ mode: "generate", prompt }, this.#freeSpot(), []);
  }

  /** Sort the selected labelled shapes into columns (they move; nothing is duplicated). */
  organize(prompt: string): Promise<void> {
    const notes = this.organizable();
    if (notes.length < 2) {
      useUiStore.getState().setAi({ status: "error", message: "Select at least 2 shapes with text to organize." });
      return Promise.resolve();
    }
    const origin = { x: Math.min(...notes.map((n) => n.x)), y: Math.min(...notes.map((n) => n.y)) };
    return this.#run({ mode: "organize", prompt, notes: notes.map((n) => n.label ?? "") }, origin, notes.map((n) => n.id));
  }

  /**
   * Draw a flowchart or mind map. Nodes appear in a loose grid as they stream in, arrows
   * connect them as edges arrive, and when the model is done everything glides into a
   * proper layout (the arrows follow, since they're attached). One undo step.
   */
  async diagram(kind: DiagramKind, prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    const group = editor.beginGroup();
    const origin = this.#freeSpot(kind === "mindmap" ? 2200 : 1700, kind === "mindmap" ? 1300 : 700);
    const ids = new Map<string, NodeId>();
    const nodes: DiagramNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];
    let titleId: NodeId | undefined;
    let items = 0;
    useUiStore.getState().setAi({ status: "thinking", mode: "diagram", items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });
    try {
      for await (const event of runDiagram(kind, prompt, llm(abort.signal))) {
        if (event.type === "title") {
          titleId = editor.aiCreate({ kind: "text", x: origin.x, y: origin.y - 70, w: 640, h: 40, fill: INK, label: event.title }, group);
          const current = useUiStore.getState().title;
          if (!current || current === "Untitled board") editor.setTitle(event.title);
        } else if (event.type === "node") {
          const rect = stagingRect(origin, event.index, event.shape);
          const root = kind === "mindmap" && event.index === 0;
          const props: ShapeProps = root
            ? { kind: "ellipse", ...rect, w: 260, h: 120, fill: INK, label: event.label }
            : { kind: shapeKind(event.shape), ...rect, fill: shapeFill(event.shape), label: event.label };
          ids.set(event.id, editor.aiCreate(props, group));
          nodes.push({ id: event.id, shape: event.shape });
          items += 1;
          useUiStore.getState().setAi({ status: "writing", items });
        } else if (event.type === "edge") {
          const from = ids.get(event.from);
          const to = ids.get(event.to);
          if (!from || !to) continue;
          edges.push({ from: event.from, to: event.to });
          editor.aiCreate({ kind: "arrow", x: 0, y: 0, w: 1, h: 1, fill: INK, points: "0,0 1,1", from, to, ...(event.label ? { label: event.label } : {}) }, group);
        } else {
          // Final layout: glide every node into place.
          const rects = layoutDiagram(kind, nodes, edges, origin);
          const branchFill = kind === "mindmap" ? mindmapColors(nodes, edges) : new Map<string, number>();
          for (const [slug, rect] of rects) {
            const id = ids.get(slug);
            if (!id) continue;
            editor.aiMove(id, rect, group);
            const fill = branchFill.get(slug);
            if (fill !== undefined) editor.updateShapes([{ id, patch: { fill } }], group);
          }
          const all = boundsOf([...rects.values()]);
          if (titleId && all) editor.aiMove(titleId, { x: all.x, y: all.y - 80, w: Math.max(320, Math.min(all.w, 900)), h: 40 }, group);
          if (all) this.#show({ x: all.x, y: all.y - 90, w: all.w, h: all.h + 90 });
          useUiStore.getState().setAi({
            status: "done",
            items: event.nodes,
            finishedAt: Date.now(),
            message: `${event.edges} connection${event.edges === 1 ? "" : "s"}${event.rejected > 0 ? ` · ${event.rejected} invalid suggestion${event.rejected === 1 ? "" : "s"} ignored` : ""}`,
            ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }),
          });
        }
      }
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /**
   * Read the board (or the selection) and write a summary, the key points and what's
   * missing, as a frame of notes next to the board. The summary also shows in the panel.
   */
  async insight(prompt: string): Promise<void> {
    if (this.#abort) return;
    const editor = this.#editor;
    const selected = editor.selected();
    const source = selected.length > 0 ? editor.dragSet(useUiStore.getState().selection) : editor.scene.ordered();
    const texts = source.flatMap((s) => (s.label?.trim() ? [s.kind === "frame" ? `Section: ${s.label}` : s.kind === "comment" ? `Comment: ${s.label}` : s.label] : []));
    if (texts.length === 0) {
      useUiStore.getState().setAi({ status: "error", message: "There's no text on this board to summarize yet." });
      return;
    }
    const abort = new AbortController();
    this.#abort = abort;
    const group = editor.beginGroup();
    const board = boundsOf(source.map((s) => visualBounds(s, editor.lookup))) ?? { x: 0, y: 0, w: 0, h: 0 };
    const x = board.x + board.w + 140;
    const y = board.y;
    const W = 760;
    const half = (W - 72) / 2;
    let frameId: NodeId | undefined;
    let height = 240;
    const grow = (bottom: number): void => {
      if (!frameId || bottom + 30 <= y + height) return;
      height = bottom + 30 - y;
      editor.updateShapes([{ id: frameId, patch: { h: height } }], group);
    };
    let items = 0;
    useUiStore.getState().setAi({ status: "thinking", mode: "insight", items: 0, startedAt: Date.now(), message: "", summary: "", tokensPerSecond: 0 });
    try {
      for await (const event of runInsight(prompt, texts, llm(abort.signal))) {
        if (event.type === "summary") {
          frameId = editor.aiCreate({ kind: "frame", x, y, w: W, h: height, fill: 0x7b55e7, label: "✦ AI summary" }, group);
          editor.aiCreate({ kind: "rect", x: x + 24, y: y + 24, w: W - 48, h: 120, fill: NOTE_COLORS.purple, label: event.text }, group);
          editor.aiCreate({ kind: "rect", x: x + 24, y: y + 168, w: half, h: 44, fill: INK, label: "Key points" }, group);
          editor.aiCreate({ kind: "rect", x: x + 48 + half, y: y + 168, w: half, h: 44, fill: 0xdd4f78, label: "What's missing" }, group);
          grow(y + 212);
          useUiStore.getState().setAi({ status: "writing", summary: event.text });
        } else if (event.type === "point" || event.type === "missing") {
          const column = event.type === "point" ? 0 : 1;
          const rect = { x: x + 24 + column * (24 + half), y: y + 228 + event.index * 98, w: half, h: 84 };
          editor.aiCreate({ kind: "rect", ...rect, fill: column === 0 ? NOTE_COLORS.blue : NOTE_COLORS.pink, label: event.text }, group);
          grow(rect.y + rect.h);
          items += 1;
          useUiStore.getState().setAi({ status: "writing", items });
        } else {
          useUiStore.getState().setAi({
            status: "done",
            items,
            finishedAt: Date.now(),
            message: event.rejected > 0 ? `${event.rejected} invalid line${event.rejected === 1 ? "" : "s"} ignored` : "",
            ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }),
          });
          this.#show({ x, y: y - 40, w: W, h: height + 40 });
        }
      }
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /**
   * Photo → board: a vision model reads a photo of a whiteboard, sticky notes or a sketch,
   * and the notes, shapes and arrows are rebuilt as real, editable shapes laid out like the
   * photo. Uses the chosen model if it can see images, else the best installed one that can.
   */
  async photo(image: PreparedImage, hint = ""): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    useUiStore.getState().setAi({ status: "thinking", mode: "photo", items: 0, startedAt: Date.now(), message: "Reading the photo…", tokensPerSecond: 0 });
    try {
      const chosen = useUiStore.getState().aiModel;
      const model = isVisionModel(chosen) ? chosen : (await listModels()).find((m) => isVisionModel(m.name))?.name;
      if (!model) throw new OllamaError("Photo → board needs a model that can see images. Install one with: ollama pull gemma3:4b");
      const result = await runVision(image.base64, hint, { ...chatOptions(model), signal: abort.signal });
      if (result.items.length === 0) throw new OllamaError("The model couldn't find any notes or shapes in this photo. Try a sharper, closer photo.");
      // The board keeps the photo's proportions.
      const W = 1800;
      const H = Math.round((W * image.height) / image.width);
      const origin = this.#freeSpot(W, H + 120);
      const group = editor.beginGroup();
      const fill: Record<string, number> = { yellow: NOTE_COLORS.yellow, pink: NOTE_COLORS.pink, green: NOTE_COLORS.green, blue: NOTE_COLORS.blue, purple: NOTE_COLORS.purple, orange: NOTE_COLORS.orange, white: 0xffffff };
      const ids = new Map<string, NodeId>();
      editor.aiCreate({ kind: "text", x: origin.x, y: origin.y, w: 900, h: 48, fill: INK, label: result.title }, group);
      // The photo itself says which items are coloured paper, and what colour: trust it over the model.
      const samples = await sampleColors(image.dataUrl, result.items);
      const look = new Map(result.items.map((it, i) => [it.id, samples[i]]));
      // Groups first, so they sit behind what's inside them.
      const ordered = [...result.items].sort((a, b) => (a.kind === "group" ? 0 : 1) - (b.kind === "group" ? 0 : 1));
      for (const raw of ordered) {
        const sample = look.get(raw.id);
        const it = sample?.paper && (raw.kind === "text" || raw.kind === "note" || raw.kind === "box") ? { ...raw, kind: "note" as const } : raw;
        const paperFill = sample?.paper ? nearestNote(sample.rgb, NOTE_COLORS) : undefined;
        const x = origin.x + (it.x / 100) * W;
        const y = origin.y + 80 + (it.y / 100) * H;
        const w = Math.max(it.kind === "text" ? 160 : 140, (it.w / 100) * W);
        const h = Math.max(it.kind === "text" ? 40 : 70, (it.h / 100) * H);
        const kind = it.kind === "group" ? "frame" : it.kind === "ellipse" ? "ellipse" : it.kind === "diamond" ? "diamond" : it.kind === "text" ? "text" : "rect";
        const id = editor.aiCreate({ kind, x, y, w, h, fill: kind === "text" ? INK : kind === "frame" ? 0x2f63ff : (paperFill ?? fill[it.color] ?? NOTE_COLORS.yellow), label: it.text }, group);
        ids.set(it.id, id);
        if (kind === "frame") editor.engine.send({ type: "back", seq: editor.engine.nextSeq(), ids: [id], group });
      }
      for (const link of result.links) {
        const from = ids.get(link.from);
        const to = ids.get(link.to);
        if (from && to) editor.aiCreate({ kind: "arrow", x: 0, y: 0, w: 1, h: 1, fill: INK, points: "0,0 1,1", from, to, ...(link.label ? { label: link.label } : {}) }, group);
      }
      useUiStore.getState().setAi({ status: "done", items: result.items.length, finishedAt: Date.now(), message: `${result.items.length} items and ${result.links.length} arrows from the photo (read by ${model})`, ...(result.tokensPerSecond === undefined ? {} : { tokensPerSecond: result.tokensPerSecond }) });
      this.#show({ x: origin.x, y: origin.y - 20, w: W, h: H + 120 });
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /** A vector illustration (icon, logo, scene) drawn by the AI as clean shapes. */
  async illustration(prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    useUiStore.getState().setAi({ status: "thinking", mode: "illustration", items: 0, startedAt: Date.now(), message: "Sketching…", tokensPerSecond: 0 });
    try {
      const { value, tokensPerSecond } = await runIllustration(prompt, llm(abort.signal));
      const data = JSON.stringify(value);
      const spec = parseArt(data);
      if (!spec) throw new OllamaError("The model didn't draw anything usable. Try a simpler subject, like \"a friendly robot icon\".");
      const at = this.#freeSpot(520, 520);
      const id = editor.aiCreate({ kind: "art", x: at.x, y: at.y, w: 520, h: 520, fill: 0xffffff, label: spec.title || prompt.slice(0, 60), data }, editor.beginGroup());
      useUiStore.getState().reveal([id]);
      useUiStore.getState().setAi({ status: "done", items: spec.shapes.length, finishedAt: Date.now(), message: `Illustration · ${spec.scene ? spec.scene.items.length : spec.shapes.length} elements`, ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }) });
      this.#show({ x: at.x, y: at.y - 20, w: 520, h: 560 });
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /**
   * The AI teammate reads the board and leaves suggestion cards next to the notes they're
   * about: missing steps, risks, ideas, questions, duplicates. Each can be accepted (it
   * becomes a normal note) or dismissed.
   */
  async suggest(focus = ""): Promise<number> {
    if (this.#abort) return 0;
    const editor = this.#editor;
    const shapes = editor.scene.ordered().filter((s) => s.label?.trim() && s.kind !== "frame" && s.kind !== "arrow" && !useUiStore.getState().suggestions[s.id]);
    if (shapes.length < 2) {
      useUiStore.getState().setAi({ status: "error", mode: "suggest", items: 0, message: "Add a few notes first — the AI teammate reviews what's on the board." });
      return 0;
    }
    const abort = new AbortController();
    this.#abort = abort;
    useUiStore.getState().setAi({ status: "thinking", mode: "suggest", items: 0, startedAt: Date.now(), message: "Reviewing the board…", tokensPerSecond: 0 });
    try {
      const found = await runSuggest(shapes.map((s) => s.label ?? ""), focus, llm(abort.signal));
      const group = editor.beginGroup();
      const fills: Record<string, number> = { missing: NOTE_COLORS.blue, risk: NOTE_COLORS.pink, idea: NOTE_COLORS.green, question: NOTE_COLORS.orange, duplicate: NOTE_COLORS.purple };
      const icons: Record<string, string> = { missing: "➕", risk: "⚠️", idea: "💡", question: "❓", duplicate: "♊" };
      const pending: Record<string, string> = { ...useUiStore.getState().suggestions };
      const taken: Rect[] = [];
      for (const s of found) {
        const near = bestMatch(shapes, s.near);
        // Beside the note it's about, stepping down past anything already there.
        let x = near ? near.x + near.w + 40 : this.#freeSpot(260, 140).x;
        let y = near ? near.y : this.#freeSpot(260, 140).y;
        const w = 260;
        const h = 130;
        for (let i = 0; i < 12; i += 1) {
          const box = { x, y, w, h };
          const hit = editor.scene.ordered().some((o) => o.kind !== "frame" && o.kind !== "arrow" && overlaps(box, o)) || taken.some((t) => overlaps(box, t));
          if (!hit) break;
          y += h + 20;
          if (i === 6) x += w + 30;
        }
        taken.push({ x, y, w, h });
        const id = editor.aiCreate({ kind: "rect", x, y, w, h, fill: fills[s.kind] ?? NOTE_COLORS.yellow, label: `${icons[s.kind] ?? "✨"} ${s.text}` }, group);
        pending[id] = s.kind;
      }
      useUiStore.getState().setSuggestions(pending);
      useUiStore.getState().setAi({ status: "done", items: found.length, finishedAt: Date.now(), message: `${found.length} suggestions — accept ✓ or dismiss ✕ on each card` });
      const all = boundsOf(taken);
      if (all) this.#show(all);
      return found.length;
    } catch (error) {
      this.#fail(error, abort);
      return 0;
    } finally {
      this.#abort = undefined;
    }
  }

  /** Understand a spoken command and do it. Returns what was understood. */
  async voiceCommand(transcript: string): Promise<string> {
    if (this.#abort) return "Busy — wait for the current AI run.";
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    let result: Awaited<ReturnType<typeof runVoiceCommand>>;
    useUiStore.getState().setAi({ status: "thinking", mode: "voice", items: 0, startedAt: Date.now(), message: `“${transcript}”`, tokensPerSecond: 0 });
    try {
      result = await runVoiceCommand(transcript, llm(abort.signal));
    } catch (error) {
      this.#fail(error, abort);
      return "Couldn't understand that.";
    } finally {
      this.#abort = undefined;
    }
    useUiStore.getState().setAi({ status: "idle", items: 0 });
    const { action, prompt, notes } = result;
    switch (action) {
      case "notes": {
        const list = notes.length > 0 ? notes : [prompt];
        const at = this.#freeSpot(Math.min(4, list.length) * 300, Math.ceil(list.length / 4) * 180);
        const group = editor.beginGroup();
        const ids = list.map((t, i) => editor.aiCreate({ kind: "rect", x: at.x + (i % 4) * 300, y: at.y + Math.floor(i / 4) * 180, w: 270, h: 150, fill: [NOTE_COLORS.yellow, NOTE_COLORS.blue, NOTE_COLORS.green, NOTE_COLORS.pink][i % 4] ?? NOTE_COLORS.yellow, label: t }, group));
        useUiStore.getState().reveal([]);
        this.#show({ x: at.x, y: at.y - 20, w: Math.min(4, list.length) * 300, h: Math.ceil(list.length / 4) * 180 + 20 });
        editor.select(ids);
        return `Added ${list.length} note${list.length === 1 ? "" : "s"}`;
      }
      case "plan":
        void this.generate(prompt);
        return `Planning: ${prompt}`;
      case "flowchart":
      case "mindmap":
        void this.diagram(action, prompt);
        return `Drawing a ${action === "mindmap" ? "mind map" : "flowchart"}: ${prompt}`;
      case "chart":
        void this.chart(prompt);
        return `Making a chart: ${prompt}`;
      case "scene":
        void this.scene(prompt);
        return `Building a 3D scene: ${prompt}`;
      case "deck":
        void this.deck(prompt);
        return `Writing a deck: ${prompt}`;
      case "illustration":
        void this.illustration(prompt);
        return `Drawing: ${prompt}`;
      case "summarize":
        void this.insight(prompt);
        return "Summarizing the board";
      case "suggest":
        void this.suggest(prompt);
        return "Reviewing the board";
      case "tidy":
        return `Tidied ${tidy(editor)} shapes`;
      case "present":
        editor.startPresenting();
        return "Presenting";
      default:
        return `Didn't catch a command in “${transcript}”`;
    }
  }

  /**
   * Meeting mode: each chunk of what was said becomes notes, decisions and action items in
   * a "Meeting notes" frame with three columns that fill in as the meeting goes.
   */
  async meetingChunk(transcript: string): Promise<number> {
    if (this.#abort || !transcript.trim()) return 0;
    const editor = this.#editor;
    const abort = new AbortController();
    this.#abort = abort;
    try {
      const frame = this.#meetingFrame();
      const taken = editor.scene.ordered().filter((s) => s.kind === "rect" && s.label && within(s, frame)).map((s) => s.label ?? "");
      const update = await runMeeting(transcript, taken, llm(abort.signal));
      const group = editor.beginGroup();
      const cols: Array<[number, string[]]> = [
        [0, update.notes.map((n) => `📝 ${n}`)],
        [1, update.decisions.map((d) => `✅ ${d}`)],
        [2, update.actions.map((a) => `🎯 ${a.task}${a.owner ? `\n\n👤 ${a.owner}` : ""}${a.due ? ` · 📅 ${a.due}` : ""}`)],
      ];
      let added = 0;
      for (const [col, items] of cols) {
        const colX = frame.x + 30 + col * 380;
        const inCol = editor.scene.ordered().filter((s) => s.kind === "rect" && within(s, frame) && s.x >= colX - 5 && s.x < colX + 340);
        let y = Math.max(frame.y + 90, ...inCol.map((s) => s.y + s.h + 16));
        for (const text of items) {
          const id = editor.aiCreate({ kind: "rect", x: colX, y, w: 340, h: 110, fill: [NOTE_COLORS.yellow, NOTE_COLORS.green, NOTE_COLORS.blue][col] ?? NOTE_COLORS.yellow, label: text }, group);
          useUiStore.getState().reveal([id]);
          y += 126;
          added += 1;
        }
        if (y > frame.y + frame.h - 40) editor.updateShapes([{ id: frame.id, patch: { h: y - frame.y + 60 } }], group);
      }
      return added;
    } catch {
      return 0;
    } finally {
      this.#abort = undefined;
    }
  }

  /** The meeting notes frame (made on first use). */
  #meetingFrame(): ShapeView {
    const editor = this.#editor;
    const existing = editor.scene.ordered().find((s) => s.kind === "frame" && s.label?.startsWith("🎙️ Meeting notes"));
    if (existing) return existing;
    const at = this.#freeSpot(1170, 640);
    const group = editor.beginGroup();
    const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const id = editor.aiCreate({ kind: "frame", x: at.x, y: at.y, w: 1170, h: 640, fill: 0x7b55e7, label: `🎙️ Meeting notes — ${date}` }, group);
    editor.engine.send({ type: "back", seq: editor.engine.nextSeq(), ids: [id], group });
    ["Notes", "Decisions", "Action items"].forEach((t, i) => editor.aiCreate({ kind: "text", x: at.x + 30 + i * 380, y: at.y + 30, w: 340, h: 40, fill: INK, label: t }, group));
    this.#show({ x: at.x, y: at.y - 30, w: 1170, h: 680 });
    return editor.scene.get(id) ?? { id, kind: "frame", x: at.x, y: at.y, w: 1170, h: 640, fill: 0x7b55e7 };
  }

  #fail(error: unknown, abort: AbortController): void {
    if (abort.signal.aborted) {
      useUiStore.getState().setAi({ status: "cancelled", finishedAt: Date.now(), message: "Stopped. What was placed stays (Ctrl+Z removes it)." });
    } else {
      const message = error instanceof OllamaError ? error.message : `Something went wrong: ${String(error)}`;
      useUiStore.getState().setAi({ status: "error", finishedAt: Date.now(), message });
    }
  }

  /** Make one designed chart card: KPIs, the plot and the insight, all in one shape. */
  async chart(prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    const ui = useUiStore.getState();
    ui.setAi({ status: "thinking", mode: "chart", items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });
    try {
      const { value, tokensPerSecond } = await runJson(buildChartMessages(prompt), CHART_SCHEMA, llm(abort.signal), () => useUiStore.getState().setAi({ status: "writing" }));
      const data = JSON.stringify(value);
      const spec = parseChart(data);
      if (!spec) throw new Error("The model didn't return usable chart data. Try rephrasing.");
      const w = 860;
      const h = spec.kpis.length > 0 ? 600 : 500;
      const at = this.#freeSpot(w, h);
      const id = editor.aiCreate({ kind: "chart", x: at.x, y: at.y, w, h, fill: 0x2f63ff, data, label: spec.title }, editor.beginGroup());
      useUiStore.getState().reveal([id]);
      useUiStore.getState().setAi({ status: "done", items: 1, finishedAt: Date.now(), message: `${spec.type} chart · ${spec.labels.length} points${spec.series.length > 1 ? ` · ${spec.series.length} series` : ""}`, ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }) });
      this.#show({ x: at.x, y: at.y - 20, w, h: h + 40 });
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /** Build an interactive 3D scene in a 3D card on the board. */
  async scene(prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    useUiStore.getState().setAi({ status: "thinking", mode: "scene", items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });
    try {
      const { value, tokensPerSecond } = await runJson(buildSceneMessages(prompt), SCENE_SCHEMA, llm(abort.signal), () => useUiStore.getState().setAi({ status: "writing" }));
      const data = JSON.stringify(value);
      const spec = parseScene(data);
      if (!spec) throw new Error("The model didn't return a usable 3D scene. Try rephrasing.");
      const w = 960;
      const h = 600;
      const at = this.#freeSpot(w, h);
      editor.aiCreate({ kind: "scene3d", x: at.x, y: at.y, w, h, fill: 0x111318, data, label: spec.title || prompt.slice(0, 60) }, editor.beginGroup());
      useUiStore.getState().setAi({ status: "done", items: spec.objects.length, finishedAt: Date.now(), message: `3D scene · ${spec.objects.length} objects · double-click it to orbit`, ...(tokensPerSecond === undefined ? {} : { tokensPerSecond }) });
      this.#show({ x: at.x, y: at.y - 20, w, h: h + 40 });
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /**
   * A slide deck, fast: the outline comes first and every slide appears at once as a
   * placeholder (960×540 frame + designed slide); then slides are written two at a time
   * and each one builds in the moment it lands. Present mode plays the deck at the end.
   */
  async deck(prompt: string): Promise<void> {
    if (this.#abort) return;
    const abort = new AbortController();
    this.#abort = abort;
    const editor = this.#editor;
    const W = SLIDE_W;
    const H = SLIDE_H;
    const GAP = 120;
    const notes = editor.scene.ordered().flatMap((s) => (s.label?.trim() && s.kind !== "frame" && editor.selected().some((x) => x.id === s.id) ? [s.label] : []));
    const group = editor.beginGroup();
    const frames: NodeId[] = [];
    const slides = new Map<number, { id: NodeId; base: Record<string, unknown> }>();
    let origin = { x: 0, y: 0 };
    let cols = 4;
    let written = 0;
    let total = 0;
    let deckTitle = "";
    let theme = "";
    useUiStore.getState().setAi({ status: "thinking", mode: "deck", items: 0, startedAt: Date.now(), message: "Planning the storyline…", tokensPerSecond: 0 });
    try {
      for await (const event of runDeckFast(prompt, notes, llm(abort.signal), 2)) {
        if (event.type === "plan") {
          deckTitle = event.title || prompt.slice(0, 60);
          theme = SLIDE_THEMES.includes(event.theme as SlideThemeName) ? event.theme : hashTheme(deckTitle);
          cols = 4;
          origin = this.#freeSpot(cols * (W + GAP), 3 * (H + GAP));
          editor.renderer.fitTo({ x: origin.x - 60, y: origin.y - 100, w: cols * (W + GAP), h: 2 * (H + GAP) + 60 }, 40, 0, 1, 900, true);
          useUiStore.getState().setAi({ status: "writing", items: 0, message: "Planning the storyline…" });
        } else if (event.type === "placeholder") {
          const s = event.slide;
          const x = origin.x + (s.index % cols) * (W + GAP);
          const y = origin.y + Math.floor(s.index / cols) * (H + GAP);
          const base = { theme, deck: deckTitle, index: s.index, total: 0, kicker: s.kicker, title: s.title, layout: s.layout };
          frames.push(editor.aiCreate({ kind: "frame", x, y, w: W, h: H, fill: 0x2f63ff, label: `${s.index + 1}. ${s.title}`.slice(0, 120) }, group));
          const id = editor.aiCreate({ kind: "slide", x, y, w: W, h: H, fill: 0x111318, label: s.title, data: JSON.stringify({ ...base, subtitle: s.brief, pending: true }) }, group);
          slides.set(s.index, { id, base });
          useUiStore.getState().reveal([id]);
        } else if (event.type === "planned") {
          total = event.total;
          useUiStore.getState().setAi({ status: "writing", items: written, message: `Writing ${total} slides…` });
        } else if (event.type === "slide") {
          const target = slides.get(event.slide.index);
          if (!target) continue;
          const raw = event.slide.raw;
          const data = { ...raw, ...target.base, layout: typeof raw.layout === "string" ? raw.layout : target.base.layout, title: event.slide.title, pending: false };
          editor.updateShapes([{ id: target.id, patch: { data: JSON.stringify(data), label: event.slide.title } }], group);
          useUiStore.getState().reveal([target.id], 80);
          written += 1;
          useUiStore.getState().setAi({ status: "writing", items: written, message: `${written} of ${total || slides.size} slides written` });
        } else if (event.type === "failed") {
          const target = slides.get(event.index);
          if (target) editor.updateShapes([{ id: target.id, patch: { data: JSON.stringify({ ...target.base, layout: "statement", pending: false }) } }], group);
        } else if (event.type === "done") {
          // Now the deck size is known everywhere: number the slides "03 / 08".
          const n = slides.size;
          editor.updateShapes(
            [...slides.values()].flatMap(({ id }) => {
              try {
                return [{ id, patch: { data: JSON.stringify({ ...(JSON.parse(editor.scene.get(id)?.data ?? "{}") as Record<string, unknown>), total: n }) } }];
              } catch {
                return [];
              }
            }),
            group,
          );
          useUiStore.getState().setAi({ status: "done", items: event.slides, finishedAt: Date.now(), message: "Playing it now in Present mode — arrows to move, Esc to stop", ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }) });
          if (frames.length > 0) {
            useUiStore.getState().setAi({ status: "done", result: { x: origin.x, y: origin.y - 40, w: cols * (W + GAP), h: Math.ceil(frames.length / cols) * (H + GAP) + 40 } });
            setTimeout(() => editor.startPresenting(frames), 700);
          }
        }
      }
    } catch (error) {
      this.#fail(error, abort);
    } finally {
      this.#abort = undefined;
    }
  }

  /** Change a chart following an instruction; false when it didn't work. */
  async rewriteChart(id: NodeId, instruction: string): Promise<boolean> {
    const editor = this.#editor;
    const shape = editor.scene.get(id);
    if (!shape?.data || this.#abort) return false;
    const abort = new AbortController();
    this.#abort = abort;
    try {
      const current = JSON.parse(shape.data) as Record<string, unknown>;
      const { value } = await runJson(buildChartRewriteMessages(current, instruction), CHART_SCHEMA, llm(abort.signal));
      const next = { ...current, ...(typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}), palette: current.palette };
      if (!parseChart(JSON.stringify(next))) return false;
      editor.updateShapes([{ id, patch: { data: JSON.stringify(next) } }], editor.beginGroup());
      useUiStore.getState().reveal([id]);
      return true;
    } catch {
      return false;
    } finally {
      this.#abort = undefined;
    }
  }

  /** Rewrite one designed slide following an instruction; false when it didn't work. */
  async rewriteSlide(id: NodeId, instruction: string): Promise<boolean> {
    const editor = this.#editor;
    const shape = editor.scene.get(id);
    if (!shape?.data || this.#abort) return false;
    const abort = new AbortController();
    this.#abort = abort;
    try {
      const current = JSON.parse(shape.data) as Record<string, unknown>;
      const { value } = await runJson(buildSlideRewriteMessages(current, instruction, String(current.deck ?? "")), SLIDE_SCHEMA, llm(abort.signal));
      if (typeof value !== "object" || value === null) return false;
      const keep = { theme: current.theme, deck: current.deck, index: current.index, total: current.total };
      editor.updateShapes([{ id, patch: { data: JSON.stringify({ ...current, ...(value as Record<string, unknown>), ...keep, pending: false }) } }], editor.beginGroup());
      useUiStore.getState().reveal([id]);
      return true;
    } catch {
      return false;
    } finally {
      this.#abort = undefined;
    }
  }

  /** Selected shapes that have text, in reading order. */
  organizable() {
    const scene = this.#editor.scene;
    return [...useUiStore.getState().selection]
      .flatMap((id) => {
        const shape = scene.get(id);
        return shape?.label ? [shape] : [];
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  async #run(request: AiRequest, origin: Point, noteIds: readonly NodeId[]): Promise<void> {
    if (this.#abort) return;
    const ui = useUiStore.getState();
    const abort = new AbortController();
    this.#abort = abort;
    const group = this.#editor.beginGroup();
    const placed: Rect[] = [];
    const columnFill = new Map<number, number>();
    let items = 0;
    ui.setAi({ status: "thinking", mode: request.mode, items: 0, startedAt: Date.now(), message: "", tokensPerSecond: 0 });

    const place = (rect: Rect, props: Omit<ShapeProps, "x" | "y" | "w" | "h">): void => {
      placed.push(rect);
      this.#editor.aiCreate({ ...props, x: rect.x, y: rect.y, w: rect.w, h: rect.h }, group);
    };

    try {
      for await (const event of runAssistant(request, llm(abort.signal))) {
        this.#apply(event, origin, noteIds, group, place, placed, columnFill);
        if (event.type === "item") {
          items += 1;
          useUiStore.getState().setAi({ status: "writing", items });
        } else if (event.type === "done") {
          const notes: string[] = [];
          if (event.unplaced.length > 0) notes.push(`${event.unplaced.length} note${event.unplaced.length === 1 ? "" : "s"} left where they were`);
          if (event.rejected > 0) notes.push(`${event.rejected} invalid suggestion${event.rejected === 1 ? "" : "s"} ignored`);
          useUiStore.getState().setAi({
            status: "done",
            items,
            finishedAt: Date.now(),
            message: notes.join(" · "),
            ...(event.tokensPerSecond === undefined ? {} : { tokensPerSecond: event.tokensPerSecond }),
          });
        }
      }
      if (placed.length > 0) this.#show(bounds(placed));
    } catch (error) {
      if (abort.signal.aborted) {
        useUiStore.getState().setAi({ status: "cancelled", finishedAt: Date.now(), message: "Stopped. What was placed stays (Ctrl+Z removes it)." });
      } else {
        const message = error instanceof OllamaError ? error.message : `Something went wrong: ${String(error)}`;
        useUiStore.getState().setAi({ status: "error", finishedAt: Date.now(), message });
      }
    } finally {
      this.#abort = undefined;
    }
  }

  #apply(
    event: AiEvent,
    origin: Point,
    noteIds: readonly NodeId[],
    group: number,
    place: (rect: Rect, props: Omit<ShapeProps, "x" | "y" | "w" | "h">) => void,
    placed: Rect[],
    columnFill: Map<number, number>,
  ): void {
    switch (event.type) {
      case "title": {
        place(titleRect(origin), { kind: "rect", fill: TITLE_FILL, label: event.title });
        const current = useUiStore.getState().title;
        if (!current || current === "Untitled board") this.#editor.setTitle(event.title);
        return;
      }
      case "column": {
        const fill = COLORS[event.color];
        columnFill.set(event.column, fill);
        if (noteIds.length > 0) {
          place(headerRect(origin, event.column), { kind: "rect", fill, label: event.title });
          return;
        }
        // A detailed plan: every column is a frame (a page you can present), headed by its title.
        const r = richColumn(origin, event.column);
        const frame = this.#editor.aiCreate({ kind: "frame", x: r.x, y: r.y, w: r.w, h: r.h, fill, label: event.title }, group);
        this.#editor.engine.send({ type: "back", seq: this.#editor.engine.nextSeq(), ids: [frame], group });
        placed.push(r);
        return;
      }
      case "item": {
        if (noteIds.length === 0) {
          const rect = richItem(origin, event.column, event.index);
          const meta = [event.owner ? `👤 ${event.owner}` : "", event.due ? `📅 ${event.due}` : "", event.priority ? `${PRIORITY[event.priority]} ${event.priority}` : ""].filter(Boolean).join("  ·  ");
          const label = [event.text, event.detail ?? "", meta].filter(Boolean).join("\n\n");
          const pastel = PASTEL[event.column % PASTEL.length] ?? NOTE_FILL;
          place(rect, { kind: "rect", fill: pastel, label: label.slice(0, 480) });
          return;
        }
        const rect = itemRect(origin, event.column, event.index);
        const existing = event.source === undefined ? undefined : noteIds[event.source];
        if (existing) {
          // Organize: move the user's own note into place (keeps its id, color, history).
          placed.push(rect);
          this.#editor.aiMove(existing, rect, group);
        } else {
          place(rect, { kind: "rect", fill: event.source === undefined && noteIds.length > 0 ? NOTE_FILL : (columnFill.get(event.column) ?? NOTE_FILL), label: event.text });
        }
      }
    }
  }

  /**
   * Where a new result goes: empty space beside the board (never on top of existing
   * work), with the camera flying there first so you watch it stream in.
   */
  #freeSpot(w = 900, h = 620): Point {
    const editor = this.#editor;
    const spot = editor.freeSpot(w, h);
    if (editor.scene.size > 0) editor.renderer.fitTo({ x: spot.x - 40, y: spot.y - 100, w: w + 80, h: h + 140 }, 40, 0, 1, 800, true);
    return spot;
  }

  /** Frame the finished result and remember it, for the panel's "Show result". */
  #show(rect: Rect): void {
    this.#editor.fitTo(rect);
    useUiStore.getState().setAi({ status: useUiStore.getState().ai.status, result: rect });
  }
}

function bounds(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function shapeKind(shape: NodeShape): ShapeProps["kind"] {
  if (shape === "start" || shape === "end") return "ellipse";
  if (shape === "decision") return "diamond";
  return "rect";
}

function shapeFill(shape: NodeShape): number {
  if (shape === "start") return NOTE_COLORS.green;
  if (shape === "end") return NOTE_COLORS.pink;
  if (shape === "decision" || shape === "topic") return NOTE_COLORS.yellow;
  return NOTE_COLORS.blue;
}

/** Mind maps: each main branch (and everything under it) gets its own color. */
function mindmapColors(nodes: readonly DiagramNode[], edges: ReadonlyArray<{ from: string; to: string }>): Map<string, number> {
  const palette = [NOTE_COLORS.blue, NOTE_COLORS.green, NOTE_COLORS.orange, NOTE_COLORS.purple, NOTE_COLORS.pink, NOTE_COLORS.yellow];
  const root = nodes[0]?.id;
  const fills = new Map<string, number>();
  if (!root) return fills;
  const branches = edges.filter((e) => e.from === root).map((e) => e.to);
  branches.forEach((branch, i) => {
    const color = palette[i % palette.length] ?? NOTE_COLORS.yellow;
    const stack = [branch];
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || fills.has(id) || id === root) continue;
      fills.set(id, color);
      for (const e of edges) if (e.from === id) stack.push(e.to);
    }
  });
  return fills;
}

const PASTEL = [0xa9cdff, 0xffd666, 0xa8e6b4, 0xffadc8, 0xcdb8ff, 0xffc49b] as const;
const PRIORITY = { high: "🔴", medium: "🟠", low: "🟢" } as const;
const RICH = { width: 300, cardH: 168, gap: 18, colGap: 48, head: 70, pad: 22 } as const;

/** A detailed plan's column frame (tall enough for six cards). */
function richColumn(origin: Point, column: number): Rect {
  return {
    x: origin.x + column * (RICH.width + RICH.pad * 2 + RICH.colGap),
    y: origin.y + 90,
    w: RICH.width + RICH.pad * 2,
    h: RICH.head + 6 * (RICH.cardH + RICH.gap) + RICH.pad,
  };
}

function richItem(origin: Point, column: number, index: number): Rect {
  const c = richColumn(origin, column);
  return { x: c.x + RICH.pad, y: c.y + RICH.head - 30 + index * (RICH.cardH + RICH.gap), w: RICH.width, h: RICH.cardH };
}

const overlaps = (a: Rect, b: Rect): boolean => intersects(a, b);
const within = (s: Rect, frame: Rect): boolean => s.x >= frame.x && s.y >= frame.y && s.x + s.w <= frame.x + frame.w + 1 && s.y + s.h <= frame.y + frame.h + 400;

/** The shape whose text best matches what the AI quoted (words in common). */
function bestMatch(shapes: readonly ShapeView[], quote: string): ShapeView | undefined {
  const words = (t: string): Set<string> => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const q = words(quote);
  if (q.size === 0) return undefined;
  let best: ShapeView | undefined;
  let score = 0;
  for (const s of shapes) {
    const w = words(s.label ?? "");
    let common = 0;
    for (const x of q) if (w.has(x)) common += 1;
    const sc = common / Math.max(1, Math.min(q.size, w.size));
    if (sc > score) {
      score = sc;
      best = s;
    }
  }
  return score >= 0.34 ? best : undefined;
}
