import { runAssistant } from "@canvas/ai";
import type { NodeId } from "@canvas/doc";
import type { Presence } from "@canvas/sync";
import { useUiStore, type TeamPhase } from "../state/ui-store";
import { chatOptions } from "./ai-models";
import type { Editor } from "./editor";
import { INK, NOTE_COLORS } from "./templates";
import type { Point } from "./viewport";

/**
 * A simulated team session: eight bot teammates run a short, real workshop on a topic.
 *
 *   thinking   → the local AI writes themed ideas for the topic
 *   brainstorm → each bot writes its ideas as sticky notes, letter by letter
 *   organize   → they carry their notes into tidy themed columns
 *   vote       → each casts two dot votes
 *   done       → the top idea is highlighted, everyone says so and leaves
 *
 * The rule that keeps it clean: bots only ever touch what THEY created, inside their own
 * frame, placed in empty space beside the board. Your notes, flowcharts and maps are never
 * moved, connected or voted on. Their cursors live in Peers like real people's, and their
 * edits go through the editor like yours, so they sync to other tabs too.
 */
const BOTS = [
  { name: "Maya", color: 0xff4f8b },
  { name: "Leo", color: 0x19c3a5 },
  { name: "Ava", color: 0x7b6cff },
  { name: "Kai", color: 0xffb020 },
  { name: "Noah", color: 0x2f9bff },
  { name: "Zoe", color: 0xff6a3d },
  { name: "Ivy", color: 0x52d36b },
  { name: "Sam", color: 0xe85cff },
] as const;

const TICK_MS = 40;
const COL_W = 250;
const NOTE_W = 220;
const NOTE_H = 92;
const GAP = 16;
const PAD = 32;
const HEADER_H = 48;
const THEME_FILLS = [NOTE_COLORS.blue, NOTE_COLORS.yellow, NOTE_COLORS.green, NOTE_COLORS.pink] as const;
const THEME_INK = [0x2f63ff, 0xc98a12, 0x1e8f5a, 0xdd4f78] as const;

/** Used when the local AI isn't reachable: a sensible generic workshop. */
const FALLBACK: ReadonlyArray<{ title: string; items: readonly string[] }> = [
  { title: "Quick wins", items: ["Simplify onboarding", "Faster first load", "Clearer pricing page"] },
  { title: "Big bets", items: ["Mobile app", "Team workspaces", "AI assistant"] },
  { title: "Risks", items: ["Scope creep", "Hiring delays", "Unclear success metric"] },
];

interface Idea {
  readonly text: string;
  readonly theme: number;
  id?: NodeId;
}

type Job =
  | { kind: "write"; idea: Idea; slot: Point; typed: number; next: number }
  | { kind: "sort"; idea: Idea; to: Point; from?: Point; t: number; group: number }
  | { kind: "vote"; idea: Idea; at: number }
  | { kind: "wait"; until: number };

interface Bot {
  readonly id: string;
  readonly name: string;
  readonly color: number;
  pos: Point;
  jobs: Job[];
  selection: NodeId[];
  chat: string;
  chatUntil: number;
}

export class CrowdSim {
  readonly #editor: Editor;
  #bots: Bot[] = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #abort: AbortController | undefined;
  readonly #mine = new Set<NodeId>();
  #phase: TeamPhase = "thinking";
  #ideas: Idea[] = [];
  #themes: string[] = [];
  #origin: Point = { x: 0, y: 0 };
  #rows = 3;
  #phaseEndsAt = 0;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  get running(): boolean {
    return this.#timer !== undefined;
  }

  /** Whether the session left anything on the board that cleanup can remove. */
  get hasWork(): boolean {
    return [...this.#mine].some((id) => this.#editor.scene.get(id));
  }

  /** Run a team session about `topic` (defaults to the board's name). */
  start(topic?: string): void {
    if (this.#timer || this.#editor.locked) return;
    const ui = useUiStore.getState();
    const subject = (topic?.trim() || ui.title?.trim() || "How we could make our product better").slice(0, 120);
    this.#phase = "thinking";
    this.#ideas = [];
    this.#themes = [];
    this.#phaseEndsAt = 0;
    const c = this.#editor.viewCenter();
    this.#bots = BOTS.map((b, i) => ({
      id: `bot-${b.name.toLowerCase()}`,
      name: b.name,
      color: b.color,
      pos: { x: c.x + Math.cos(i * 0.8) * 520, y: c.y + Math.sin(i * 0.8) * 340 },
      jobs: [],
      selection: [],
      chat: i === 0 ? "Let's start!" : i === 3 ? "Thinking…" : "",
      chatUntil: Date.now() + 2_500,
    }));
    ui.setCrowd(true);
    ui.setTeam({ phase: "thinking", topic: subject, done: 0, total: 0, top: undefined });
    this.#timer = setInterval(() => this.#tick(), TICK_MS);
    void this.#prepare(subject);
  }

  stop(): void {
    this.#abort?.abort();
    this.#abort = undefined;
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const bot of this.#bots) this.#editor.peers.update(bot.id, null);
    this.#publishRoster();
    const ui = useUiStore.getState();
    ui.setCrowd(false);
    if (ui.team?.phase !== "done") ui.setTeam(undefined);
  }

  /** Remove everything the session created (your own content was never touched). */
  cleanup(): void {
    if (this.#timer) this.stop();
    const ids = [...this.#mine].filter((id) => this.#editor.scene.get(id));
    if (ids.length > 0) this.#editor.deleteShapes(ids);
    this.#mine.clear();
    useUiStore.getState().setTeam(undefined);
    useUiStore.getState().setNotice("Removed the team session's frame and notes");
  }

  // --- setup ---------------------------------------------------------------------------

  /** Ask the local AI for themed ideas, then lay out the session frame in free space. */
  async #prepare(topic: string): Promise<void> {
    const abort = new AbortController();
    this.#abort = abort;
    let themes: Array<{ title: string; items: string[] }> = [];
    const timeout = setTimeout(() => abort.abort(), 40_000);
    try {
      const prompt = `Team brainstorm about: ${topic}. Exactly 3 columns (themes), each with exactly 3 short, concrete ideas (under 40 characters).`;
      for await (const event of runAssistant({ mode: "generate", prompt }, { ...chatOptions(useUiStore.getState().aiModel), signal: abort.signal })) {
        if (event.type === "column") themes[event.column] = { title: event.title, items: themes[event.column]?.items ?? [] };
        if (event.type === "item") {
          const t = themes[event.column] ?? { title: `Theme ${event.column + 1}`, items: [] };
          t.items.push(event.text);
          themes[event.column] = t;
        }
      }
    } catch {
      themes = [];
    } finally {
      clearTimeout(timeout);
    }
    if (!this.#timer) return; // stopped while thinking
    themes = themes
      .filter((t) => t !== undefined && t.items.length > 0)
      .slice(0, 4)
      .map((t) => ({ title: t.title, items: t.items.slice(0, 4) }));
    if (themes.length < 2) {
      themes = FALLBACK.map((t) => ({ title: t.title, items: [...t.items] }));
      useUiStore.getState().setNotice("Local AI unavailable — the team is running a sample workshop");
    }
    this.#begin(themes);
  }

  #begin(themes: ReadonlyArray<{ title: string; items: readonly string[] }>): void {
    const editor = this.#editor;
    this.#themes = themes.map((t) => t.title);
    this.#ideas = themes.flatMap((t, theme) => t.items.map((text) => ({ text, theme })));
    this.#rows = Math.max(...themes.map((t) => t.items.length));
    const w = PAD * 2 + themes.length * COL_W - (COL_W - NOTE_W);
    const h = PAD * 2 + HEADER_H + GAP + this.#rows * (NOTE_H + GAP);
    this.#origin = editor.freeSpot(w, h);
    const group = editor.beginGroup();
    const topic = useUiStore.getState().team?.topic ?? "";
    const frame = editor.botCreate({ kind: "frame", x: this.#origin.x, y: this.#origin.y, w, h, fill: 0x7b55e7, label: `Team session · ${topic}`.slice(0, 120) }, group);
    if (frame) {
      this.#mine.add(frame);
      editor.engine.send({ type: "back", seq: editor.engine.nextSeq(), ids: [frame], group });
    }
    editor.renderer.fitTo({ x: this.#origin.x - 60, y: this.#origin.y - 90, w: w + 120, h: h + 150 }, 40, 0, 1.2, 900, true);

    // Brainstorm: deal the ideas out like cards; each bot writes its own, in a loose grid.
    const slots = this.#scatterSlots(this.#ideas.length);
    this.#bots.forEach((bot, i) => bot.jobs.push({ kind: "wait", until: Date.now() + 500 + i * 220 }));
    this.#ideas.forEach((idea, i) => {
      const bot = this.#bots[i % this.#bots.length];
      const slot = slots[i];
      if (bot && slot) bot.jobs.push({ kind: "write", idea, slot, typed: 0, next: 0 });
    });
    this.#setPhase("brainstorm");
  }

  /** Brainstorm positions: a gently jittered grid inside the frame (never overlapping). */
  #scatterSlots(n: number): Point[] {
    const cols = this.#themes.length;
    const width = cols * COL_W - (COL_W - NOTE_W);
    const perRow = Math.max(2, Math.ceil(n / this.#rows));
    const cellW = width / perRow;
    const top = this.#origin.y + PAD + HEADER_H + GAP;
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      const c = i % perRow;
      const r = Math.floor(i / perRow);
      const spare = Math.max(0, cellW - NOTE_W);
      const squeeze = cellW < NOTE_W ? (NOTE_W - cellW) * (c / Math.max(1, perRow - 1)) : 0;
      out.push({ x: this.#origin.x + PAD + c * cellW + spare * (((i * 37) % 10) / 10) - squeeze, y: top + r * (NOTE_H + GAP) });
    }
    return out;
  }

  /** Where the k-th idea of a theme ends up after sorting. */
  #columnSlot(theme: number, row: number): Point {
    return { x: this.#origin.x + PAD + theme * COL_W, y: this.#origin.y + PAD + HEADER_H + GAP + row * (NOTE_H + GAP) };
  }

  #setPhase(phase: TeamPhase): void {
    this.#phase = phase;
    this.#phaseEndsAt = 0;
    const ui = useUiStore.getState();
    const total = phase === "vote" ? this.#bots.length : this.#ideas.length;
    if (ui.team) ui.setTeam({ ...ui.team, phase, done: 0, total });
  }

  // --- the loop ----------------------------------------------------------------------------

  #tick(): void {
    if (this.#editor.locked) return;
    const now = Date.now();
    for (const bot of this.#bots) {
      if (this.#phase === "thinking") this.#gather(bot, now);
      else this.#work(bot, now);
      if (bot.chat && now > bot.chatUntil) bot.chat = "";
      const presence: Presence = {
        name: bot.name,
        color: bot.color,
        cursor: bot.pos,
        selection: bot.selection,
        ...(bot.chat ? { chat: bot.chat } : {}),
      };
      this.#editor.peers.update(bot.id, presence);
    }
    this.#publishRoster();
    this.#advance(now);
  }

  /** Move to the next phase once every bot has finished its jobs (with a short beat). */
  #advance(now: number): void {
    if (this.#phase === "thinking" || this.#bots.some((b) => b.jobs.length > 0)) return;
    if (!this.#phaseEndsAt) {
      this.#phaseEndsAt = now + 700;
      return;
    }
    if (now < this.#phaseEndsAt) return;
    if (this.#phase === "brainstorm") this.#planOrganize();
    else if (this.#phase === "organize") this.#planVote();
    else if (this.#phase === "vote") this.#finish();
    else this.stop();
  }

  #planOrganize(): void {
    const editor = this.#editor;
    const group = editor.beginGroup();
    // Column headers appear first, then everyone carries their own notes over.
    this.#themes.forEach((title, theme) => {
      const id = editor.botCreate(
        { kind: "rect", x: this.#origin.x + PAD + theme * COL_W, y: this.#origin.y + PAD, w: NOTE_W, h: HEADER_H, fill: THEME_INK[theme % THEME_INK.length] ?? INK, label: title },
        group,
      );
      if (id) this.#mine.add(id);
    });
    const rows = new Map<number, number>();
    this.#ideas.forEach((idea, i) => {
      const row = rows.get(idea.theme) ?? 0;
      rows.set(idea.theme, row + 1);
      const bot = this.#bots[i % this.#bots.length];
      if (bot && idea.id) bot.jobs.push({ kind: "sort", idea, to: this.#columnSlot(idea.theme, row), t: 0, group: 0 });
    });
    const lines = ["Sorting mine", "This goes here", "Grouping", "On it"];
    this.#bots.forEach((bot, i) => {
      if (bot.jobs.length === 0) return;
      bot.chat = lines[i % lines.length] ?? "";
      bot.chatUntil = Date.now() + 1_600;
    });
    this.#setPhase("organize");
  }

  #planVote(): void {
    const written = this.#ideas.filter((i) => i.id);
    if (written.length === 0) return this.#finish();
    // Two votes each; picks lean toward a few favourites, like a real room.
    this.#bots.forEach((bot, b) => {
      const favourites = Math.min(4, written.length);
      const picks = [written[(b * 3) % favourites], written[(b * 5 + 2) % written.length]];
      picks.forEach((idea, k) => {
        if (idea && !bot.jobs.some((j) => j.kind === "vote" && j.idea === idea)) bot.jobs.push({ kind: "vote", idea, at: Date.now() + b * 160 + k * 500 });
      });
    });
    this.#setPhase("vote");
  }

  #finish(): void {
    const editor = this.#editor;
    let top: Idea | undefined;
    let best = -1;
    for (const idea of this.#ideas) {
      const votes = idea.id ? (editor.scene.get(idea.id)?.voters?.length ?? 0) : 0;
      if (votes > best) {
        best = votes;
        top = idea;
      }
    }
    if (top?.id) {
      editor.renderer.pulse(top.id);
      editor.renderer.spawnReaction(this.#centerOf(top.id), "🏆");
    }
    this.#bots.forEach((bot, i) => {
      bot.selection = top?.id && i === 0 ? [top.id] : [];
      bot.chat = i === 0 && top ? `Winner: ${top.text}` : i % 3 === 0 ? "Great session 🎉" : "Done ✓";
      bot.chatUntil = Date.now() + 3_200;
      bot.jobs.push({ kind: "wait", until: Date.now() + 3_000 });
    });
    const ui = useUiStore.getState();
    if (ui.team) ui.setTeam({ ...ui.team, phase: "done", top: top?.text });
    this.#phase = "done";
    this.#phaseEndsAt = 0;
  }

  #centerOf(id: NodeId): Point {
    const s = this.#editor.scene.get(id);
    return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : this.#origin;
  }

  /** While the AI thinks: everyone circles loosely in the middle of the view. */
  #gather(bot: Bot, now: number): void {
    const i = this.#bots.indexOf(bot);
    const c = this.#editor.viewCenter();
    const a = (i / this.#bots.length) * Math.PI * 2 + now / 1600;
    this.#moveToward(bot, { x: c.x + Math.cos(a) * 180, y: c.y + Math.sin(a) * 110 }, 0.06);
  }

  #publishRoster(): void {
    useUiStore.getState().setPeers(this.#editor.peers.list().map((p) => ({ clientId: p.clientId, name: p.presence.name, color: p.presence.color })));
  }

  #moveToward(bot: Bot, to: Point, speed = 0.2): boolean {
    const dx = to.x - bot.pos.x;
    const dy = to.y - bot.pos.y;
    bot.pos = { x: bot.pos.x + dx * speed + dy * 0.015, y: bot.pos.y + dy * speed - dx * 0.015 };
    return Math.hypot(dx, dy) < 5;
  }

  #progress(): void {
    const ui = useUiStore.getState();
    if (ui.team) ui.setTeam({ ...ui.team, done: Math.min(ui.team.total, ui.team.done + 1) });
  }

  #work(bot: Bot, now: number): void {
    const job = bot.jobs[0];
    if (!job) return;
    const editor = this.#editor;
    switch (job.kind) {
      case "wait":
        if (now >= job.until) bot.jobs.shift();
        return;
      case "write": {
        if (!job.idea.id) {
          if (!this.#moveToward(bot, { x: job.slot.x + NOTE_W / 2, y: job.slot.y + NOTE_H / 2 })) return;
          const id = editor.botCreate({ kind: "rect", x: job.slot.x, y: job.slot.y, w: NOTE_W, h: NOTE_H, fill: THEME_FILLS[job.idea.theme % THEME_FILLS.length] ?? NOTE_COLORS.yellow, label: " " });
          if (!id) {
            bot.jobs.shift();
            return;
          }
          this.#mine.add(id);
          job.idea.id = id;
          bot.selection = [id];
          job.next = now + 250;
          return;
        }
        if (now < job.next) return;
        job.typed += 1;
        job.next = now + 45 + Math.random() * 70;
        editor.updateShapes([{ id: job.idea.id, patch: { label: job.idea.text.slice(0, job.typed) } }]);
        bot.pos = { x: Math.min(job.slot.x + NOTE_W - 16, bot.pos.x + 5), y: bot.pos.y };
        if (job.typed >= job.idea.text.length) {
          bot.selection = [];
          bot.jobs.shift();
          this.#progress();
        }
        return;
      }
      case "sort": {
        const id = job.idea.id;
        const shape = id ? editor.scene.get(id) : undefined;
        if (!id || !shape) {
          bot.jobs.shift();
          return;
        }
        if (!job.from) {
          // Walk over to the note first, then carry it.
          if (!this.#moveToward(bot, { x: shape.x + shape.w / 2, y: shape.y + 18 })) return;
          job.from = { x: shape.x, y: shape.y };
          job.group = editor.beginGroup();
        }
        bot.selection = [id];
        job.t = Math.min(1, job.t + 0.045);
        const e = job.t < 0.5 ? 4 * job.t ** 3 : 1 - (-2 * job.t + 2) ** 3 / 2;
        const x = job.from.x + (job.to.x - job.from.x) * e;
        const y = job.from.y + (job.to.y - job.from.y) * e;
        editor.moveLocal([{ id, x, y }], job.group);
        bot.pos = { x: x + NOTE_W / 2, y: y + 18 };
        if (job.t >= 1) {
          bot.selection = [];
          bot.jobs.shift();
          this.#progress();
        }
        return;
      }
      case "vote": {
        const id = job.idea.id;
        if (!id || !editor.scene.get(id)) {
          bot.jobs.shift();
          return;
        }
        if (now < job.at || !this.#moveToward(bot, this.#centerOf(id), 0.22)) return;
        editor.engine.send({ type: "vote", seq: editor.engine.nextSeq(), id, voter: bot.id, on: true });
        editor.renderer.pulse(id);
        bot.jobs.shift();
        if (!bot.jobs.some((j) => j.kind === "vote")) this.#progress();
      }
    }
  }
}
