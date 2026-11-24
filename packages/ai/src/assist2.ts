import { runJson } from "./creative.js";
import type { AssistantOptions } from "./assistant.js";
import { cleanText, type ChatMessage } from "./plan.js";

/**
 * More things the local model does for the board: vector illustrations, an AI teammate's
 * suggestions, understanding spoken commands, and turning a meeting into notes. Each is a
 * schema the model fills; the app validates every value again before using it.
 */

// --- illustrations ---------------------------------------------------------------------

export const ART_ICONS_AI = [
  "robot", "rocket", "house", "tree", "pine", "sun", "moon", "cloud", "mountain", "planet", "star", "heart",
  "lightbulb", "coffee", "laptop", "phone", "chart", "trophy", "gift", "car", "book", "cap", "globe", "shield",
  "coin", "shop", "person", "cat", "flower", "target",
] as const;

export const ILLUSTRATION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    background: { type: "string", enum: ["plain", "gradient", "sunset", "night", "sky", "hills", "space", "blob"] },
    color1: { type: "string" },
    color2: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          icon: { type: "string", enum: ART_ICONS_AI },
          x: { type: "number" },
          y: { type: "number" },
          size: { type: "number" },
          color: { type: "string" },
          accent: { type: "string" },
          rotate: { type: "number" },
        },
        required: ["icon", "x", "y", "size", "color", "accent"],
      },
    },
    text: { type: "string" },
    textStyle: { type: "string", enum: ["none", "title", "badge", "banner"] },
  },
  required: ["title", "background", "color1", "color2", "items", "text", "textStyle"],
} as const;

const ILLUSTRATION_SYSTEM = `You are an art director composing a flat vector illustration from a library of ready-made drawings. Reply ONLY with JSON matching the schema.
The canvas is 400x400. "items" (1 to 7) are placed by their CENTER ("x","y" in 0..400) with a "size" in pixels (40 to 260). The main subject is big (160-240) and near the center; supporting items are smaller and around it; things on the ground sit low (y 270-330).
Library: robot, rocket, house, tree, pine, sun, moon, cloud, mountain, planet, star, heart, lightbulb, coffee, laptop, phone, chart, trophy, gift, car, book, cap (graduation), globe, shield, coin, shop, person, cat, flower, target.
"background": plain, gradient, sunset, night, sky, hills (two-colour rolling hills), space or blob (soft shape). "color1"/"color2" are hex colours for the background.
Each item has a main "color" and an "accent" (hex). Pick a harmonious palette of 3-5 colours. Optional "rotate" in degrees for playful tilt.
"text": a short name or caption if the request asks for a logo, title or label, else "". "textStyle": "badge" for logos, "title" for a caption at the bottom, "banner" for a ribbon, "none" if no text.`;

export function buildIllustrationMessages(prompt: string): ChatMessage[] {
  return [
    { role: "system", content: ILLUSTRATION_SYSTEM },
    { role: "user", content: cleanText(prompt, 400) ?? "A friendly rocket" },
  ];
}

export async function runIllustration(prompt: string, options: AssistantOptions): Promise<{ value: unknown; tokensPerSecond?: number }> {
  return runJson(buildIllustrationMessages(prompt), ILLUSTRATION_SCHEMA, options);
}

// --- AI teammate ----------------------------------------------------------------------

export const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          near: { type: "string" },
          kind: { type: "string", enum: ["missing", "risk", "idea", "question", "duplicate"] },
          text: { type: "string" },
        },
        required: ["near", "kind", "text"],
      },
    },
  },
  required: ["suggestions"],
} as const;

const SUGGEST_SYSTEM = `You are a sharp, helpful teammate looking at a shared whiteboard. Reply ONLY with JSON matching the schema.
Give 3 to 6 suggestions that make this board better. Each one:
- "near": copy the EXACT text of the existing note it relates to (so it can be placed beside it).
- "kind": "missing" (an important step or item nobody wrote), "risk" (something that could go wrong), "idea" (a better way), "question" (something unclear to decide), "duplicate" (two notes saying the same thing).
- "text": one specific, actionable sentence (under 120 characters). No generic advice.`;

export function buildSuggestMessages(notes: readonly string[], focus = ""): ChatMessage[] {
  const board = notes.slice(0, 80).map((n) => `- ${cleanText(n, 160) ?? ""}`).join("\n");
  return [
    { role: "system", content: SUGGEST_SYSTEM },
    { role: "user", content: `The board:\n${board}${focus ? `\n\nFocus on: ${cleanText(focus, 200) ?? ""}` : ""}` },
  ];
}

export interface Suggestion {
  readonly near: string;
  readonly kind: "missing" | "risk" | "idea" | "question" | "duplicate";
  readonly text: string;
}

const SUGGEST_KINDS = ["missing", "risk", "idea", "question", "duplicate"] as const;

export async function runSuggest(notes: readonly string[], focus: string, options: AssistantOptions): Promise<Suggestion[]> {
  const { value } = await runJson(buildSuggestMessages(notes, focus), SUGGEST_SCHEMA, options);
  const list = typeof value === "object" && value !== null && Array.isArray((value as { suggestions?: unknown }).suggestions) ? (value as { suggestions: unknown[] }).suggestions : [];
  return list.slice(0, 8).flatMap((x): Suggestion[] => {
    if (typeof x !== "object" || x === null) return [];
    const o = x as Record<string, unknown>;
    const text = cleanText(o.text, 160);
    if (!text) return [];
    return [{ near: cleanText(o.near, 200) ?? "", kind: SUGGEST_KINDS.includes(o.kind as Suggestion["kind"]) ? (o.kind as Suggestion["kind"]) : "idea", text }];
  });
}

// --- voice commands --------------------------------------------------------------------

export const VOICE_ACTIONS = ["notes", "plan", "flowchart", "mindmap", "chart", "scene", "deck", "illustration", "summarize", "suggest", "tidy", "present", "none"] as const;
export type VoiceAction = (typeof VOICE_ACTIONS)[number];

export const VOICE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: VOICE_ACTIONS },
    prompt: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["action", "prompt", "notes"],
} as const;

const VOICE_SYSTEM = `You turn a spoken command for a whiteboard app into an action. Reply ONLY with JSON matching the schema.
Actions: "notes" (add sticky notes: put each note's text in "notes"), "plan" (a project plan), "flowchart", "mindmap", "chart", "scene" (a 3D scene), "deck" (slides), "illustration" (a drawing or icon), "summarize" (summarize the board), "suggest" (review the board and suggest improvements), "tidy" (arrange the board neatly), "present" (start presenting), "none" (not a command).
"prompt": what to make, rewritten clearly (e.g. "Monthly revenue of a coffee shop in 2025"). Keep the user's specifics.`;

export function buildVoiceMessages(transcript: string): ChatMessage[] {
  return [
    { role: "system", content: VOICE_SYSTEM },
    { role: "user", content: cleanText(transcript, 600) ?? "" },
  ];
}

export async function runVoiceCommand(transcript: string, options: AssistantOptions): Promise<{ action: VoiceAction; prompt: string; notes: string[] }> {
  const { value } = await runJson(buildVoiceMessages(transcript), VOICE_SCHEMA, options);
  const o = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const action = VOICE_ACTIONS.includes(o.action as VoiceAction) ? (o.action as VoiceAction) : "none";
  const notes = (Array.isArray(o.notes) ? o.notes : []).slice(0, 12).flatMap((n) => {
    const t = cleanText(n, 200);
    return t ? [t] : [];
  });
  return { action, prompt: cleanText(o.prompt, 400) ?? cleanText(transcript, 400) ?? "", notes };
}

// --- meeting notes ---------------------------------------------------------------------

export const MEETING_SCHEMA = {
  type: "object",
  properties: {
    notes: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "object", properties: { task: { type: "string" }, owner: { type: "string" }, due: { type: "string" } }, required: ["task"] } },
  },
  required: ["notes", "decisions", "actions"],
} as const;

const MEETING_SYSTEM = `You take notes in a team meeting. From the transcript excerpt, extract only what is NEW compared with the notes already taken. Reply ONLY with JSON matching the schema.
- "notes": key points discussed (short, specific, max 4).
- "decisions": things the team agreed (max 3).
- "actions": tasks someone will do, with "owner" (a name if said) and "due" (if said).
Use [] for anything empty. Never repeat items already taken.`;

export function buildMeetingMessages(transcript: string, already: readonly string[]): ChatMessage[] {
  return [
    { role: "system", content: MEETING_SYSTEM },
    { role: "user", content: `Already noted:\n${already.slice(-30).map((a) => `- ${a}`).join("\n") || "(nothing yet)"}\n\nTranscript:\n${cleanText(transcript, 3000) ?? ""}` },
  ];
}

export interface MeetingUpdate {
  readonly notes: readonly string[];
  readonly decisions: readonly string[];
  readonly actions: ReadonlyArray<{ readonly task: string; readonly owner: string; readonly due: string }>;
}

export async function runMeeting(transcript: string, already: readonly string[], options: AssistantOptions): Promise<MeetingUpdate> {
  const { value } = await runJson(buildMeetingMessages(transcript, already), MEETING_SCHEMA, options);
  const o = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const list = (v: unknown, n: number): string[] =>
    (Array.isArray(v) ? v : []).slice(0, n).flatMap((x) => {
      const t = cleanText(x, 200);
      return t ? [t] : [];
    });
  const actions = (Array.isArray(o.actions) ? o.actions : []).slice(0, 5).flatMap((x) => {
    if (typeof x !== "object" || x === null) return [];
    const a = x as Record<string, unknown>;
    const task = cleanText(a.task, 200);
    return task ? [{ task, owner: cleanText(a.owner, 40) ?? "", due: cleanText(a.due, 40) ?? "" }] : [];
  });
  return { notes: list(o.notes, 4), decisions: list(o.decisions, 3), actions };
}
