import type { Presence } from "@canvas/sync";
import type { Point } from "./viewport";

export interface Peer {
  readonly clientId: string;
  presence: Presence;
  /** Where the cursor is drawn: eases toward presence.cursor every frame. */
  shown: Point | null;
}

/**
 * Other people on this document. Presence arrives ~25 times a second; drawing the raw
 * positions would look jumpy, so each cursor glides toward its latest position with
 * frame-rate-independent exponential smoothing.
 */
export class Peers {
  readonly #peers = new Map<string, Peer>();
  /** Bumped on any change, so the renderer knows when to redraw remote selections. */
  version = 0;

  list(): Peer[] {
    return [...this.#peers.values()];
  }

  /** Returns true when the visible roster (who, names, colors) changed. */
  update(clientId: string, presence: Presence | null): boolean {
    this.version += 1;
    const existing = this.#peers.get(clientId);
    if (!presence) return this.#peers.delete(clientId);
    if (!existing) {
      this.#peers.set(clientId, { clientId, presence, shown: presence.cursor });
      return true;
    }
    const rosterChanged = existing.presence.name !== presence.name || existing.presence.color !== presence.color;
    existing.presence = presence;
    return rosterChanged;
  }

  clear(): void {
    this.#peers.clear();
    this.version += 1;
  }

  step(dtMs: number, stiffness = 22): void {
    const t = 1 - Math.exp((-stiffness * dtMs) / 1000);
    for (const peer of this.#peers.values()) {
      const target = peer.presence.cursor;
      if (!target) {
        peer.shown = null;
      } else if (!peer.shown) {
        peer.shown = target;
      } else {
        peer.shown = { x: peer.shown.x + (target.x - peer.shown.x) * t, y: peer.shown.y + (target.y - peer.shown.y) * t };
      }
    }
  }
}
