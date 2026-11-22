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
}

export const MAX_PRESENCE_NAME = 40;
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
  r.end();
  return { name, color, cursor, selection };
}
