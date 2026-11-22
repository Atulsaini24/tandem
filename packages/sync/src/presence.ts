import { DecodeError, Reader, Writer } from "./codec.js";

/**
 * Ephemeral per-connection state: who you are, where your pointer is, what you have
 * selected. Not part of the document. It's relayed live, never stored, and dropped
 * when the connection closes.
 *
 * Cursor positions are in WORLD coordinates, so each viewer can draw them correctly
 * under their own pan and zoom.
 */
export interface Presence {
  readonly name: string;
  /** 0xRRGGBB */
  readonly color: number;
  readonly cursor: { readonly x: number; readonly y: number } | null;
  readonly selection: readonly string[];
  /** The world rectangle this person is looking at (so others can follow them). */
  readonly view?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Cursor chat: a short message shown next to their cursor while it's set. */
  readonly chat?: string;
  /** The latest emoji reaction; `n` changes with every new one so repeats still show. */
  readonly reaction?: { readonly emoji: string; readonly n: number };
  /** Asking everyone to follow this person's view (present mode, "spotlight me"). */
  readonly spotlight?: boolean;
  /** The cursor is a laser pointer (drawn with a glowing trail on every screen). */
  readonly laser?: boolean;
}

export const MAX_PRESENCE_NAME = 40;
export const MAX_PRESENCE_CHAT = 120;
const MAX_EMOJI = 16;
const VIEW = 1;
const CHAT = 2;
const REACTION = 4;
const SPOTLIGHT = 8;
const LASER = 16;
export const MAX_PRESENCE_SELECTION = 200;

export function encodePresence(presence: Presence): Uint8Array {
  const w = new Writer();
  w.str(Array.from(presence.name).slice(0, MAX_PRESENCE_NAME).join(""));
  w.uint(Math.max(0, Math.min(0xffffff, Math.floor(presence.color))));
  if (presence.cursor && Number.isFinite(presence.cursor.x) && Number.isFinite(presence.cursor.y)) {
    w.byte(1);
    w.f64(presence.cursor.x);
    w.f64(presence.cursor.y);
  } else {
    w.byte(0);
  }
  const selection = presence.selection.slice(0, MAX_PRESENCE_SELECTION);
  w.uint(selection.length);
  for (const id of selection) w.str(id);
  // Optional fields after the base record, behind a flag byte (older readers stop above).
  const view = presence.view && [presence.view.x, presence.view.y, presence.view.w, presence.view.h].every(Number.isFinite) ? presence.view : undefined;
  const chat = presence.chat ? Array.from(presence.chat).slice(0, MAX_PRESENCE_CHAT).join("") : "";
  const reaction = presence.reaction && presence.reaction.emoji ? presence.reaction : undefined;
  const flags = (view ? VIEW : 0) | (chat ? CHAT : 0) | (reaction ? REACTION : 0) | (presence.spotlight ? SPOTLIGHT : 0) | (presence.laser ? LASER : 0);
  if (flags !== 0) {
    w.byte(flags);
    if (view) for (const v of [view.x, view.y, view.w, view.h]) w.f64(v);
    if (chat) w.str(chat);
    if (reaction) {
      w.str(Array.from(reaction.emoji).slice(0, MAX_EMOJI).join(""));
      w.uint(Math.max(0, Math.floor(reaction.n)) % 1_000_000);
    }
  }
  return w.finish();
}

/** Presence comes from other clients: validate everything, throw only DecodeError. */
export function decodePresence(bytes: Uint8Array): Presence {
  const r = new Reader(bytes);
  const name = r.str();
  if (Array.from(name).length > MAX_PRESENCE_NAME) throw new DecodeError("presence name too long");
  const color = r.uint();
  if (color > 0xffffff) throw new DecodeError("presence color out of range");
  let cursor: Presence["cursor"] = null;
  const hasCursor = r.byte();
  if (hasCursor === 1) {
    const x = r.f64();
    const y = r.f64();
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new DecodeError("presence cursor not finite");
    cursor = { x, y };
  } else if (hasCursor !== 0) {
    throw new DecodeError("bad presence cursor flag");
  }
  const count = r.count(1);
  if (count > MAX_PRESENCE_SELECTION) throw new DecodeError("presence selection too large");
  const selection: string[] = [];
  for (let i = 0; i < count; i++) selection.push(r.str());
  const presence: { -readonly [K in keyof Presence]: Presence[K] } = { name, color, cursor, selection };
  if (r.remaining > 0) {
    const flags = r.byte();
    if (flags & ~(VIEW | CHAT | REACTION | SPOTLIGHT | LASER)) throw new DecodeError("bad presence flags");
    if (flags & SPOTLIGHT) presence.spotlight = true;
    if (flags & LASER) presence.laser = true;
    if (flags & VIEW) {
      const [x, y, w, h] = [r.f64(), r.f64(), r.f64(), r.f64()];
      if (![x, y, w, h].every(Number.isFinite)) throw new DecodeError("presence view not finite");
      presence.view = { x, y, w, h };
    }
    if (flags & CHAT) {
      const chat = r.str();
      if (Array.from(chat).length > MAX_PRESENCE_CHAT) throw new DecodeError("presence chat too long");
      presence.chat = chat;
    }
    if (flags & REACTION) {
      const emoji = r.str();
      if (Array.from(emoji).length > MAX_EMOJI) throw new DecodeError("presence emoji too long");
      presence.reaction = { emoji, n: r.uint() };
    }
  }
  r.end();
  return presence;
}
