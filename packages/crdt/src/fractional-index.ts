/**
 * Variable-length integer-prefixed fractional indexing: sibling order (z-order on the canvas)
 * as ASCII-sortable strings.
 *
 * A position has an integer part followed by an optional base-62 fractional suffix:
 *
 *   [integer prefix] [fractional digits]
 *
 * Integer prefix encoding (Rocicorp / Figma style):
 *   - Non-negative integers: 'a'..'z' (length k = charCode - 'a' + 1, k in 1..26) followed
 *     by k base-62 digits: "a0".."az" (1 digit), "b00".."bzz" (2 digits), "c000".., etc.
 *   - Negative integers: 'Z'..'A' (length k = 'Z' - charCode + 1, k in 1..26) followed
 *     by k base-62 digits: "Zz" (just before "a0") down to "Z0", then "Yzz" down to "Y00", etc.
 *
 * Because 'A' < ... < 'Z' < 'a' < ... < 'z' in ASCII, plain string comparison (`<`)
 * preserves exact integer order across all magnitudes, while repeated append-only
 * (`positionBetween(last, null)`) or prepend-only (`positionBetween(null, first)`)
 * workloads simply increment/decrement the integer part — keeping keys O(log_62 N)
 * (2 chars for 62 appends, 3 chars for 3,844 appends) instead of growing linearly.
 *
 * Invariant: any non-empty fractional suffix never ends in "0" (the smallest digit),
 * so there is always room before it.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const FRAC_VALID = /^(?:[0-9A-Za-z]*[1-9A-Za-z])?$/;
const DIGIT_RUN = /^[0-9A-Za-z]+$/;

const SMALLEST_POS_INT = "a0";
const LARGEST_NEG_INT = "Zz";

function intDigitCount(prefix: string): number {
  const code = prefix.charCodeAt(0);
  if (code >= 97 && code <= 122) return code - 97 + 1; // 'a'..'z' -> 1..26
  if (code >= 65 && code <= 90) return 90 - code + 1; // 'Z'..'A' -> 1..26
  return 0;
}

function splitPosition(position: string): { intPart: string; fracPart: string } | undefined {
  if (position.length < 2) return undefined;
  const count = intDigitCount(position);
  if (count === 0 || position.length < 1 + count) return undefined;
  const intPart = position.slice(0, 1 + count);
  if (!DIGIT_RUN.test(intPart.slice(1))) return undefined;
  const fracPart = position.slice(1 + count);
  if (!FRAC_VALID.test(fracPart)) return undefined;
  return { intPart, fracPart };
}

export function isValidPosition(position: string): boolean {
  return splitPosition(position) !== undefined;
}

/** Increment an integer prefix by 1 (e.g. "a0" -> "a1", "az" -> "b00", "Zz" -> "a0"). */
function incrementInt(intPart: string): string {
  const prefix = intPart.charAt(0);
  const digits = intPart.slice(1).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const idx = DIGITS.indexOf(digits[i] ?? "0");
    if (idx < DIGITS.length - 1) {
      digits[i] = DIGITS.charAt(idx + 1);
      return prefix + digits.join("");
    }
    digits[i] = "0";
  }
  // Overflowed all digits
  if (prefix === "Z") return SMALLEST_POS_INT;
  if (prefix === "z") throw new RangeError("integer position overflow");
  const code = prefix.charCodeAt(0);
  if (code >= 97 && code < 122) {
    // 'a'..'y' -> next letter with (len + 1) zeros
    const nextPrefix = String.fromCharCode(code + 1);
    return nextPrefix + "0".repeat(digits.length + 1);
  }
  // 'A'..'Y' -> next letter toward 'Z' with (len - 1) zeros
  const nextPrefix = String.fromCharCode(code + 1);
  return nextPrefix + "0".repeat(digits.length - 1);
}

/** Decrement an integer prefix by 1 (e.g. "a1" -> "a0", "a0" -> "Zz", "b00" -> "az"). */
function decrementInt(intPart: string): string {
  const prefix = intPart.charAt(0);
  const digits = intPart.slice(1).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const idx = DIGITS.indexOf(digits[i] ?? "0");
    if (idx > 0) {
      digits[i] = DIGITS.charAt(idx - 1);
      return prefix + digits.join("");
    }
    digits[i] = DIGITS.charAt(DIGITS.length - 1);
  }
  // Underflowed all digits
  if (prefix === "a") return LARGEST_NEG_INT;
  if (prefix === "A") throw new RangeError("integer position underflow");
  const code = prefix.charCodeAt(0);
  if (code > 97 && code <= 122) {
    // 'b'..'z' -> previous letter with (len - 1) 'z's
    const prevPrefix = String.fromCharCode(code - 1);
    return prevPrefix + DIGITS.charAt(DIGITS.length - 1).repeat(digits.length - 1);
  }
  // 'B'..'Z' -> previous letter toward 'A' with (len + 1) 'z's
  const prevPrefix = String.fromCharCode(code - 1);
  return prevPrefix + DIGITS.charAt(DIGITS.length - 1).repeat(digits.length + 1);
}

/**
 * A position strictly between `before` and `after`.
 * `null` means "no neighbour": the start or end of the sibling list.
 */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && !isValidPosition(before)) throw new RangeError(`invalid position "${before}"`);
  if (after !== null && !isValidPosition(after)) throw new RangeError(`invalid position "${after}"`);
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`"${before}" must sort before "${after}"`);
  }

  if (before === null && after === null) return SMALLEST_POS_INT;

  if (before === null) {
    const parsedAfter = after !== null ? splitPosition(after) : undefined;
    if (!parsedAfter) throw new RangeError(`invalid position "${after}"`);
    if (parsedAfter.fracPart.length > 0) return parsedAfter.intPart;
    return decrementInt(parsedAfter.intPart);
  }

  if (after === null) {
    const parsedBefore = splitPosition(before);
    if (!parsedBefore) throw new RangeError(`invalid position "${before}"`);
    return incrementInt(parsedBefore.intPart);
  }

  const parsedA = splitPosition(before);
  const parsedB = splitPosition(after);
  if (!parsedA || !parsedB) throw new RangeError("invalid position");

  if (parsedA.intPart === parsedB.intPart) {
    return parsedA.intPart + midpoint(parsedA.fracPart, parsedB.fracPart);
  }

  const nextInt = incrementInt(parsedA.intPart);
  if (nextInt < parsedB.intPart) {
    return nextInt;
  }

  // Adjacent integers (nextInt === parsedB.intPart)
  if (parsedB.fracPart.length > 0) {
    return parsedB.intPart;
  }
  return parsedA.intPart + midpoint(parsedA.fracPart, null);
}

/**
 * `count` evenly spread positions between `before` and `after`, in order.
 *
 * Bisecting keeps keys short even for large bulk inserts.
 */
export function positionsBetween(before: string | null, after: string | null, count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`invalid count ${count}`);
  if (count === 0) return [];
  const mid = positionBetween(before, after);
  const leftCount = Math.floor((count - 1) / 2);
  return [
    ...positionsBetween(before, mid, leftCount),
    mid,
    ...positionsBetween(mid, after, count - 1 - leftCount),
  ];
}

/** Digit-wise midpoint of two fractions; `b === null` means 1.0. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Skip the shared prefix (treating missing digits of `a` as "0").
    let n = 0;
    while (n < b.length && (a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a.length > 0 ? DIGITS.indexOf(a.charAt(0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b.charAt(0)) : DIGITS.length;
  if (digitB - digitA > 1) {
    // Room for a single digit in between.
    return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  }
  // Adjacent digits: take b's first digit if b has more digits after it,
  // otherwise keep a's digit and recurse one place deeper.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}
