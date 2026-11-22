/**
 * Deterministic layout for a board plan. A card's position depends only on its column
 * index and its index within the column, so each card can be placed the moment it
 * streams in, without knowing how many will follow.
 *
 *   title banner
 *   [col 0 header]  [col 1 header]  ...
 *   [item 0]        [item 0]
 *   [item 1]        ...
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const CARD = {
  width: 220,
  height: 84,
  gapY: 14,
  columnGap: 36,
  headerHeight: 48,
  titleHeight: 56,
  titleGap: 24,
} as const;

const columnLeft = (origin: Point, column: number): number => origin.x + column * (CARD.width + CARD.columnGap);
const columnsTop = (origin: Point): number => origin.y + CARD.titleHeight + CARD.titleGap;

/** Board title: a banner across the first two columns. */
export function titleRect(origin: Point): Rect {
  return { x: origin.x, y: origin.y, w: CARD.width * 2 + CARD.columnGap, h: CARD.titleHeight };
}

export function headerRect(origin: Point, column: number): Rect {
  return { x: columnLeft(origin, column), y: columnsTop(origin), w: CARD.width, h: CARD.headerHeight };
}

export function itemRect(origin: Point, column: number, index: number): Rect {
  return {
    x: columnLeft(origin, column),
    y: columnsTop(origin) + CARD.headerHeight + CARD.gapY + index * (CARD.height + CARD.gapY),
    w: CARD.width,
    h: CARD.height,
  };
}

/** Total footprint of a board with these column sizes (to pick a clear spot for it). */
export function boardSize(itemsPerColumn: readonly number[]): { w: number; h: number } {
  const columns = Math.max(2, itemsPerColumn.length);
  const tallest = Math.max(0, ...itemsPerColumn);
  return {
    w: columns * CARD.width + (columns - 1) * CARD.columnGap,
    h: CARD.titleHeight + CARD.titleGap + CARD.headerHeight + CARD.gapY + tallest * (CARD.height + CARD.gapY),
  };
}
