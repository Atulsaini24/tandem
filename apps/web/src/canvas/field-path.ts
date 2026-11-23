/**
 * Read and write one field of a slide spec by its path ("title", "items.2.text",
 * "columns.1.items.0"), as tagged on the drawn text (see `field` in svg-kit).
 */
type Json = Record<string, unknown> | unknown[];

const isIndex = (key: string): boolean => /^\d+$/.test(key);

export function getPath(root: unknown, path: string): string {
  let at: unknown = root;
  for (const key of path.split(".")) {
    if (at === null || typeof at !== "object") return "";
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === "string" ? at : typeof at === "number" ? String(at) : "";
}

/** A copy of `root` with the field at `path` set, creating objects/arrays on the way. */
export function setPath(root: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const keys = path.split(".");
  const clone = (v: unknown, nextKey: string | undefined): Json => {
    if (Array.isArray(v)) return [...v];
    if (v !== null && typeof v === "object") return { ...(v as Record<string, unknown>) };
    return nextKey !== undefined && isIndex(nextKey) ? [] : {};
  };
  const out = { ...root };
  let parent: Json = out;
  keys.forEach((key, i) => {
    const last = i === keys.length - 1;
    const slot = parent as Record<string, unknown>;
    if (last) {
      slot[key] = value;
      return;
    }
    const next = clone(slot[key], keys[i + 1]);
    slot[key] = next;
    parent = next;
  });
  return out;
}
