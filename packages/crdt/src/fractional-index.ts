/**
 * Fractional indexing: sibling order (z-order on the canvas) as strings.
 *
 * A position is a base-62 fraction written without the leading "0.", e.g. "V" ≈ 0.5.
 * To insert between two siblings we generate a NEW string strictly between their
 * positions, so reordering one shape never rewrites any other shape. Plain string
 * comparison (`<`) gives the order, because the digit alphabet is in ASCII order.
 *
 * Invariant: a position never ends in "0" (the smallest digit). Otherwise there
 * would be no room left before it ("V" and "V0" are the same fraction).
 *
 * Concurrent inserts in the same gap can produce the same position. That's fine:
 * the tree breaks ties by node id, so the order is still deterministic.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const VALID = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export function isValidPosition(position: string): boolean {
  return VALID.test(position);
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
  return midpoint(before ?? "", after);
}

/**
 * `count` evenly spread positions between `before` and `after`, in order.
 *
 * Inserting n items one after another makes keys grow by about one digit every few
 * inserts. Bisecting instead keeps them about log2(n)/6 digits long: 5,000 shapes get
 * keys of a few characters, not hundreds.
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
