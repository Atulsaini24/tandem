import type { NodeId, ShapeView } from "@canvas/doc";
import type { Presence } from "@canvas/sync";
import { useUiStore } from "../state/ui-store";
import type { Editor } from "./editor";
import { center, visualBounds } from "./geometry";
import { INK, NOTE_COLORS } from "./templates";
import type { Point } from "./viewport";

/**
 * "Simulate a team": eight bot collaborators, each with its own cursor, selection and
 * job, all working at once. Their cursors live in Peers like real people; their edits go
 * through the editor like yours, so they sync to every other tab too.
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

const IDEAS = ["Ship the beta", "Talk to 5 users", "Fix onboarding", "Pricing page", "Launch video", "Dark mode polish", "Write the FAQ", "Partner emails", "Plan the party 🎉", "Cut scope?", "Measure retention", "Hire a designer", "Docs refresh", "Speed it up ⚡"];
const CHATS = ["On it!", "Love this", "Moving this over", "Thoughts?", "Done ✓", "Nice idea", "Let's vote", "+1", "Hmm, not sure", "Ship it 🚀"];
const EMOJI = ["👍", "❤️", "🎉", "🔥", "😂", "👀"];
const TICK_MS = 50;
const MAX_BOT_SHAPES = 36;
const MAX_CONNECTIONS = 8;

type Task =
  | { kind: "idle"; until: number }
  | { kind: "go"; to: Point; then: Task }
  | { kind: "drag"; id: NodeId; from: Point; to: Point; t: number; group: number }
  | { kind: "type"; id: NodeId; text: string; i: number; next: number }
  | { kind: "connect"; from: NodeId; to: NodeId };

interface Bot {
  readonly id: string;
  readonly name: string;
  readonly color: number;
  pos: Point;
  task: Task;
  selection: NodeId[];
  chat: string;
  chatUntil: number;
  reaction: { emoji: string; n: number } | undefined;
}

const pick = <T,>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

export class CrowdSim {
  readonly #editor: Editor;
  readonly #bots: Bot[];
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #mine = new Set<NodeId>();
  #connections = 0;

  constructor(editor: Editor) {
    this.#editor = editor;
    const c = editor.viewCenter();
    this.#bots = BOTS.map((b, i) => ({
      id: `bot-${b.name.toLowerCase()}`,
      name: b.name,
      color: b.color,
      pos: { x: c.x + Math.cos(i) * 400, y: c.y + Math.sin(i) * 260 },
      task: { kind: "idle", until: Date.now() + 200 + i * 250 },
      selection: [],
      chat: "",
      chatUntil: 0,
      reaction: undefined,
    }));
  }

  get running(): boolean {
    return this.#timer !== undefined;
  }

  start(): void {
    if (this.#timer || this.#editor.locked) return;
    this.#timer = setInterval(() => this.#tick(), TICK_MS);
    useUiStore.getState().setCrowd(true);
    useUiStore.getState().setNotice("8 teammates joined — watch them work (they're bots)");
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const bot of this.#bots) this.#editor.peers.update(bot.id, null);
    this.#publishRoster();
    useUiStore.getState().setCrowd(false);
  }

  #area(): { x: number; y: number; w: number; h: number } {
    return this.#editor.renderer.visibleWorld;
  }

  #randomPoint(): Point {
    const a = this.#area();
    return { x: a.x + a.w * (0.12 + Math.random() * 0.76), y: a.y + a.h * (0.18 + Math.random() * 0.6) };
  }

  #shapes(): ShapeView[] {
    const view = this.#area();
    return this.#editor.scene.ordered().filter((s) => s.kind !== "arrow" && s.kind !== "frame" && s.kind !== "path" && s.x > view.x && s.y > view.y && s.x < view.x + view.w && s.y < view.y + view.h);
  }

  /** Choose what this bot does next. */
  #plan(bot: Bot): Task {
    const shapes = this.#shapes();
    const roll = Math.random();
    const target = pick(shapes);
    if (roll < 0.3 && target) {
      // Grab something and move it.
      const c = center(target);
      const to = { x: c.x + (Math.random() - 0.5) * 360, y: c.y + (Math.random() - 0.5) * 240 };
      return { kind: "go", to: c, then: { kind: "drag", id: target.id, from: { x: target.x, y: target.y }, to: { x: to.x - target.w / 2, y: to.y - target.h / 2 }, t: 0, group: 0 } };
    }
    if (roll < 0.55 && this.#mine.size < MAX_BOT_SHAPES) {
      // Write a new note, letter by letter.
      const at = this.#randomPoint();
      return { kind: "go", to: at, then: { kind: "type", id: "", text: pick(IDEAS) ?? "Idea", i: 0, next: 0 } };
    }
    if (roll < 0.6 && shapes.length >= 2 && this.#connections < MAX_CONNECTIONS) {
      // Connect a shape to one of its nearest neighbours (long wires across the board read as noise).
      const a = pick(shapes);
      if (a) {
        const ca = center(a);
        const near = shapes
          .filter((s) => s.id !== a.id)
          .map((s) => ({ s, d: Math.hypot(center(s).x - ca.x, center(s).y - ca.y) }))
          .filter(({ d }) => d < 520)
          .sort((p, q) => p.d - q.d)
          .slice(0, 3);
        const b = pick(near)?.s;
        if (b) {
          this.#connections += 1;
          return { kind: "go", to: ca, then: { kind: "connect", from: a.id, to: b.id } };
        }
      }
    }
    if (roll < 0.76 && target) {
      // Vote.
      this.#editor.engine.send({ type: "vote", seq: this.#editor.engine.nextSeq(), id: target.id, voter: bot.id, on: !(target.voters ?? []).includes(bot.id) });
      return { kind: "go", to: center(target), then: { kind: "idle", until: Date.now() + 600 } };
    }
    if (roll < 0.86) {
      bot.reaction = { emoji: pick(EMOJI) ?? "🎉", n: (bot.reaction?.n ?? 0) + 1 };
      this.#editor.renderer.spawnReaction(bot.pos, bot.reaction.emoji);
      return { kind: "idle", until: Date.now() + 700 };
    }
    bot.chat = pick(CHATS) ?? "";
    bot.chatUntil = Date.now() + 2_200;
    return { kind: "go", to: this.#randomPoint(), then: { kind: "idle", until: Date.now() + 1_200 } };
  }

  #tick(): void {
    if (this.#editor.locked) return;
    const now = Date.now();
    for (const bot of this.#bots) {
      this.#step(bot, now);
      if (bot.chat && now > bot.chatUntil) bot.chat = "";
      const presence: Presence = {
        name: bot.name,
        color: bot.color,
        cursor: bot.pos,
        selection: bot.selection,
        ...(bot.chat ? { chat: bot.chat } : {}),
        ...(bot.reaction ? { reaction: bot.reaction } : {}),
      };
      this.#editor.peers.update(bot.id, presence);
    }
    this.#publishRoster();
  }

  #publishRoster(): void {
    useUiStore.getState().setPeers(this.#editor.peers.list().map((p) => ({ clientId: p.clientId, name: p.presence.name, color: p.presence.color })));
  }

  #moveToward(bot: Bot, to: Point, speed = 0.22): boolean {
    const dx = to.x - bot.pos.x;
    const dy = to.y - bot.pos.y;
    // Ease in with a little curve, like a hand moving a mouse.
    bot.pos = { x: bot.pos.x + dx * speed + dy * 0.02, y: bot.pos.y + dy * speed - dx * 0.02 };
    return Math.hypot(dx, dy) < 6;
  }

  #step(bot: Bot, now: number): void {
    const task = bot.task;
    const editor = this.#editor;
    switch (task.kind) {
      case "idle":
        if (now >= task.until) {
          bot.selection = [];
          bot.task = this.#plan(bot);
        }
        return;
      case "go":
        if (this.#moveToward(bot, task.to)) bot.task = task.then;
        return;
      case "drag": {
        const shape = editor.scene.get(task.id);
        if (!shape) {
          bot.task = { kind: "idle", until: now + 300 };
          return;
        }
        if (task.t === 0) task.group = editor.beginGroup();
        bot.selection = [task.id];
        task.t = Math.min(1, task.t + 0.06);
        const e = task.t < 0.5 ? 2 * task.t * task.t : 1 - (-2 * task.t + 2) ** 2 / 2;
        const x = task.from.x + (task.to.x - task.from.x) * e;
        const y = task.from.y + (task.to.y - task.from.y) * e;
        editor.moveLocal([{ id: task.id, x, y }], task.group);
        bot.pos = { x: x + shape.w / 2, y: y + shape.h / 2 };
        if (task.t >= 1) bot.task = { kind: "idle", until: now + 500 + Math.random() * 800 };
        return;
      }
      case "type": {
        if (!task.id) {
          const id = editor.botCreate({ kind: "rect", x: bot.pos.x - 110, y: bot.pos.y - 45, w: 220, h: 90, fill: pick(Object.values(NOTE_COLORS)) ?? NOTE_COLORS.yellow, label: " " });
          if (!id) {
            bot.task = { kind: "idle", until: now + 500 };
            return;
          }
          this.#mine.add(id);
          task.id = id;
          bot.selection = [id];
          task.next = now + 300;
          return;
        }
        if (now < task.next) return;
        task.i += 1;
        task.next = now + 60 + Math.random() * 90;
        editor.updateShapes([{ id: task.id, patch: { label: task.text.slice(0, task.i) } }]);
        bot.pos = { x: bot.pos.x + 7, y: bot.pos.y };
        if (task.i >= task.text.length) bot.task = { kind: "idle", until: now + 700 };
        return;
      }
      case "connect": {
        const to = editor.scene.get(task.to);
        if (!to) {
          bot.task = { kind: "idle", until: now + 300 };
          return;
        }
        bot.selection = [task.from];
        if (this.#moveToward(bot, center(visualBounds(to, editor.lookup)), 0.16)) {
          const id = editor.botCreate({ kind: "arrow", x: 0, y: 0, w: 1, h: 1, fill: INK, points: "0,0 1,1", from: task.from, to: task.to });
          if (id) this.#mine.add(id);
          bot.task = { kind: "idle", until: now + 600 };
        }
      }
    }
  }
}
