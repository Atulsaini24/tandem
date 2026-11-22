import type { ShapeProps } from "@canvas/doc";

/**
 * Starter boards. Shapes reference each other by `key` (arrows' from/to); the editor gives
 * every shape a fresh id when it inserts a template, so one board can hold several copies.
 */
export interface TemplateShape {
  readonly key: string;
  readonly props: ShapeProps;
}

export interface Template {
  readonly id: TemplateId;
  readonly name: string;
  readonly blurb: string;
  /** Accent for the dashboard card. */
  readonly color: number;
  build(): TemplateShape[];
}

export type TemplateId = "kanban" | "retro" | "flowchart" | "mindmap" | "brainstorm";

export const NOTE_COLORS = {
  yellow: 0xffd666,
  pink: 0xffadc8,
  green: 0xa8e6b4,
  blue: 0xa9cdff,
  purple: 0xcdb8ff,
  orange: 0xffc49b,
} as const;

export const INK = 0x111318;

const note = (key: string, x: number, y: number, label: string, fill: number = NOTE_COLORS.yellow, w = 280, h = 84): TemplateShape => ({
  key,
  props: { kind: "rect", x, y, w, h, fill, label },
});

const frame = (key: string, x: number, y: number, w: number, h: number, label: string, fill: number): TemplateShape => ({
  key,
  props: { kind: "frame", x, y, w, h, fill, label },
});

const arrow = (key: string, from: string, to: string, label?: string): TemplateShape => ({
  key,
  props: { kind: "arrow", x: 0, y: 0, w: 1, h: 1, fill: INK, points: "0,0 1,1", from, to, ...(label ? { label } : {}) },
});

function columns(titles: ReadonlyArray<{ title: string; fill: number; notes: readonly string[]; noteFill: number }>, width = 320): TemplateShape[] {
  const out: TemplateShape[] = [];
  titles.forEach((column, c) => {
    const x = c * (width + 40);
    const height = Math.max(520, 40 + column.notes.length * 104 + 80);
    out.push(frame(`col${c}`, x, 0, width, height, column.title, column.fill));
    column.notes.forEach((text, i) => out.push(note(`n${c}-${i}`, x + 20, 24 + i * 104, text, column.noteFill, width - 40)));
  });
  return out;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "kanban",
    name: "Kanban board",
    blurb: "To do, in progress, done — move cards as work flows.",
    color: 0x2f63ff,
    build: () =>
      columns([
        { title: "To do", fill: 0x2f63ff, noteFill: NOTE_COLORS.blue, notes: ["Write the launch announcement", "Record a 60-second demo", "Invite beta testers"] },
        { title: "In progress", fill: 0xef6b3a, noteFill: NOTE_COLORS.orange, notes: ["Polish onboarding flow", "Fix sync on flaky Wi-Fi"] },
        { title: "Done", fill: 0x1e8f5a, noteFill: NOTE_COLORS.green, notes: ["Offline mode", "Time travel", "Dark theme"] },
      ]),
  },
  {
    id: "retro",
    name: "Team retro",
    blurb: "What went well, what to improve, and who does what next.",
    color: 0x1e8f5a,
    build: () =>
      columns(
        [
          { title: "Went well 🎉", fill: 0x1e8f5a, noteFill: NOTE_COLORS.green, notes: ["Shipped on time", "Great pairing sessions"] },
          { title: "To improve 🔧", fill: 0xef6b3a, noteFill: NOTE_COLORS.orange, notes: ["Too many meetings", "Flaky end-to-end tests"] },
          { title: "Ideas 💡", fill: 0x7b55e7, noteFill: NOTE_COLORS.purple, notes: ["Demo day every Friday"] },
          { title: "Action items ✅", fill: 0x2f63ff, noteFill: NOTE_COLORS.blue, notes: ["Alex: cap meetings at 25 min", "Sam: quarantine flaky tests"] },
        ],
        300,
      ),
  },
  {
    id: "flowchart",
    name: "Flowchart",
    blurb: "Connected steps and decisions. Arrows follow when you move things.",
    color: 0x7b55e7,
    build: () => [
      { key: "start", props: { kind: "ellipse", x: 0, y: 160, w: 200, h: 90, fill: NOTE_COLORS.green, label: "Request comes in" } },
      { key: "review", props: { kind: "rect", x: 300, y: 165, w: 220, h: 80, fill: NOTE_COLORS.blue, label: "Review the request" } },
      { key: "ok", props: { kind: "diamond", x: 620, y: 130, w: 200, h: 150, fill: NOTE_COLORS.yellow, label: "Approved?" } },
      { key: "ship", props: { kind: "rect", x: 920, y: 165, w: 220, h: 80, fill: NOTE_COLORS.blue, label: "Build and ship" } },
      { key: "end", props: { kind: "ellipse", x: 1240, y: 160, w: 200, h: 90, fill: NOTE_COLORS.green, label: "Tell the customer" } },
      { key: "revise", props: { kind: "rect", x: 610, y: 420, w: 220, h: 80, fill: NOTE_COLORS.pink, label: "Ask for changes" } },
      arrow("a1", "start", "review"),
      arrow("a2", "review", "ok"),
      arrow("a3", "ok", "ship", "Yes"),
      arrow("a4", "ship", "end"),
      arrow("a5", "ok", "revise", "No"),
      arrow("a6", "revise", "review"),
    ],
  },
  {
    id: "mindmap",
    name: "Mind map",
    blurb: "One idea in the middle, branches all around.",
    color: 0xdd4f78,
    build: () => {
      const branches = ["Audience", "Pricing", "Channels", "Timeline", "Risks", "Metrics"];
      const fills = Object.values(NOTE_COLORS);
      const out: TemplateShape[] = [{ key: "core", props: { kind: "ellipse", x: -130, y: -65, w: 260, h: 130, fill: 0x111318, label: "Product launch" } }];
      branches.forEach((label, i) => {
        const angle = (i / branches.length) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * 430 - 110;
        const y = Math.sin(angle) * 280 - 40;
        out.push(note(`b${i}`, x, y, label, fills[i % fills.length], 220, 80));
        out.push(arrow(`e${i}`, "core", `b${i}`));
      });
      return out;
    },
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    blurb: "A frame full of sticky notes to get ideas flowing.",
    color: 0xc98a12,
    build: () => {
      const ideas = ["What if it worked offline?", "AI that tidies the board", "Follow a teammate's view", "Comments on the canvas", "Templates for rituals", "Export to slides", "Emoji reactions", "Voice notes?"];
      const fills = Object.values(NOTE_COLORS);
      const out: TemplateShape[] = [frame("frame", 0, 0, 1000, 560, "Brainstorm — how might we make planning fun?", 0xc98a12)];
      ideas.forEach((idea, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        out.push(note(`i${i}`, 30 + col * 240 + (row % 2) * 20, 40 + row * 240 + (col % 2) * 30, idea, fills[(i * 5) % fills.length], 200, 150));
      });
      return out;
    },
  },
];

export const templateById = (id: string | null | undefined): Template | undefined => TEMPLATES.find((t) => t.id === id);
