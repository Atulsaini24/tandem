/**
 * The boards this browser knows about, for the dashboard: id, name, when it was last
 * changed, and a small SVG thumbnail. A per-device convenience in localStorage. The boards
 * themselves live in IndexedDB and on the server, so losing this list loses nothing but
 * the shortcuts (any board still opens from its link).
 */
export interface BoardEntry {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly shapes: number;
  readonly thumb?: string;
  readonly starred?: boolean;
}

const KEY = "canvas:boards";
const MAX_BOARDS = 200;
const listeners = new Set<() => void>();

export const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function newBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}

export function listBoards(): BoardEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b): b is BoardEntry => typeof b === "object" && b !== null && typeof (b as BoardEntry).id === "string" && DOC_ID_PATTERN.test((b as BoardEntry).id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function save(boards: readonly BoardEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(boards.slice(0, MAX_BOARDS)));
  } catch {
    // Quota: drop thumbnails and retry once.
    try {
      localStorage.setItem(KEY, JSON.stringify(boards.slice(0, MAX_BOARDS).map((b) => ({ ...b, thumb: undefined }))));
    } catch {
      // storage blocked: the dashboard just won't remember this board
    }
  }
  for (const listener of listeners) listener();
}

export function upsertBoard(id: string, patch: Partial<Omit<BoardEntry, "id">>): void {
  const boards = listBoards();
  const now = Date.now();
  const existing = boards.find((b) => b.id === id);
  const next: BoardEntry = { id, title: "Untitled board", createdAt: now, updatedAt: now, shapes: 0, ...existing, ...patch };
  save([next, ...boards.filter((b) => b.id !== id)]);
}

export function removeBoard(id: string): void {
  save(listBoards().filter((b) => b.id !== id));
}

export function subscribeBoards(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(ms).toLocaleDateString();
}
