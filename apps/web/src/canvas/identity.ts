/**
 * A friendly name and color for this browser, shown on other people's screens.
 * Remembered in localStorage (a per-viewer convenience: if storage is blocked, you just
 * get a new name each visit).
 */
export interface Identity {
  /** Stable per browser: used as this person's voter key. */
  readonly id: string;
  readonly name: string;
  readonly color: number;
}

const ADJECTIVES = ["Swift", "Calm", "Bright", "Bold", "Quiet", "Lucky", "Clever", "Sunny", "Brave", "Gentle"];
const ANIMALS = ["Otter", "Fox", "Heron", "Lynx", "Panda", "Falcon", "Koala", "Badger", "Orca", "Ibex"];
const COLORS = [0x2f63ff, 0xef6b3a, 0x1e8f5a, 0x7b55e7, 0xdd4f78, 0x137d77, 0xc6513c];
const KEY = "canvas:identity";

function pick<T>(items: readonly T[], fallback: T): T {
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

export function loadIdentity(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Identity> | null;
    if (saved && typeof saved.name === "string" && typeof saved.color === "number") {
      const id = typeof saved.id === "string" && saved.id ? saved.id : crypto.randomUUID().slice(0, 12);
      if (id !== saved.id) localStorage.setItem(KEY, JSON.stringify({ ...saved, id }));
      return { id, name: saved.name, color: saved.color };
    }
  } catch {
    // fall through to a fresh identity
  }
  const identity: Identity = { id: crypto.randomUUID().slice(0, 12), name: `${pick(ADJECTIVES, "Swift")} ${pick(ANIMALS, "Otter")}`, color: pick(COLORS, 0x2f63ff) };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // storage blocked: fine
  }
  return identity;
}
