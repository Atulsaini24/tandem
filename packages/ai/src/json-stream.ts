/**
 * Incremental JSON parser: feed it text as it streams in, and it reports every value
 * (with its path) the moment that value is complete.
 *
 * A local model writes a whole board in ~20s. Waiting for the closing brace to
 * JSON.parse would leave the canvas empty that whole time. With this, each sticky
 * note lands as soon as its `}` arrives.
 *
 *   push('{"columns":[{"title":"Now","items":[{"text":"Shi')  → [title "Now"]
 *   push('p it"}]}]}')                                        → [text, item, items, column, ...]
 *
 * Values are reported innermost first (an item before the array containing it).
 * Malformed input never throws: an unparseable span is skipped, and validation of
 * whatever does parse happens downstream.
 */
export type JsonPath = ReadonlyArray<string | number>;

export interface CompletedValue {
  readonly path: JsonPath;
  readonly value: unknown;
}

type Frame =
  | { readonly type: "object"; readonly start: number; key: string | undefined }
  | { readonly type: "array"; readonly start: number; index: number };

const PRIMITIVE_START = /[-0-9tfn]/;
const PRIMITIVE_END = /[\s,\]}:]/;

export class JsonStreamParser {
  #text = "";
  #position = 0;
  readonly #stack: Frame[] = [];
  #inString = false;
  #escaped = false;
  #stringStart = 0;
  #stringIsKey = false;
  #primitiveStart = -1;

  /** Feed the next chunk; returns the values completed by it, innermost first. */
  push(chunk: string): CompletedValue[] {
    const out: CompletedValue[] = [];
    this.#text += chunk;
    for (; this.#position < this.#text.length; this.#position++) {
      const ch = this.#text.charAt(this.#position);

      if (this.#inString) {
        if (this.#escaped) this.#escaped = false;
        else if (ch === "\\") this.#escaped = true;
        else if (ch === '"') this.#endString(out);
        continue;
      }

      if (this.#primitiveStart >= 0) {
        if (!PRIMITIVE_END.test(ch)) continue;
        this.#emit(out, this.#path(), this.#primitiveStart, this.#position);
        this.#primitiveStart = -1;
        // fall through: the delimiter itself still needs handling
      }

      switch (ch) {
        case "{":
          this.#stack.push({ type: "object", start: this.#position, key: undefined });
          break;
        case "[":
          this.#stack.push({ type: "array", start: this.#position, index: 0 });
          break;
        case "}":
        case "]": {
          const frame = this.#stack.pop();
          if (frame) this.#emit(out, this.#path(), frame.start, this.#position + 1);
          break;
        }
        case '"': {
          const top = this.#stack[this.#stack.length - 1];
          this.#inString = true;
          this.#stringStart = this.#position;
          this.#stringIsKey = top?.type === "object" && top.key === undefined;
          break;
        }
        case ",": {
          const top = this.#stack[this.#stack.length - 1];
          if (top?.type === "array") top.index += 1;
          else if (top?.type === "object") top.key = undefined;
          break;
        }
        default:
          if (PRIMITIVE_START.test(ch)) this.#primitiveStart = this.#position;
      }
    }
    return out;
  }

  #endString(out: CompletedValue[]): void {
    this.#inString = false;
    const raw = this.#text.slice(this.#stringStart, this.#position + 1);
    if (this.#stringIsKey) {
      const top = this.#stack[this.#stack.length - 1];
      if (top?.type === "object") {
        try {
          top.key = JSON.parse(raw) as string;
        } catch {
          top.key = "";
        }
      }
      return;
    }
    this.#emit(out, this.#path(), this.#stringStart, this.#position + 1);
  }

  /** Path of the value currently being written (its parents' keys / indexes). */
  #path(): JsonPath {
    return this.#stack.map((frame) => (frame.type === "object" ? (frame.key ?? "") : frame.index));
  }

  #emit(out: CompletedValue[], path: JsonPath, start: number, end: number): void {
    try {
      out.push({ path, value: JSON.parse(this.#text.slice(start, end)) as unknown });
    } catch {
      // Malformed span (the model produced invalid JSON): skip it.
    }
  }
}

/** True if `path` matches `pattern`, where "#" in the pattern matches any array index. */
export function pathMatches(path: JsonPath, pattern: ReadonlyArray<string | number>): boolean {
  return path.length === pattern.length && pattern.every((part, i) => (part === "#" ? typeof path[i] === "number" : part === path[i]));
}
