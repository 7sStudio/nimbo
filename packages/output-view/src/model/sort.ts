// A total order over grid cells, so a header click sorts numbers as numbers, dates as instants and text by code unit
// (stable on every machine, and cheap over 48 000 rows), absent cells last.
import { leafText } from "./leaf.js";
import type { Cell } from "./records.js";
import type { WireKind } from "./wire.js";
import { textField } from "./wire.js";

const ranks: Partial<Record<WireKind, number>> = {
  number: 0,
  special: 0,
  bigint: 0,
  string: 1,
  date: 2,
  boolean: 3,
  null: 5,
  undefined: 5,
};

const rankOf = (cell: Cell): number => (cell.present ? (ranks[cell.kind] ?? 4) : 6);

/** The number a numeric cell stands for (bigints as the nearest double, NaN first). */
function numeric(node: unknown, kind: WireKind): number {
  if (typeof node === "number") return node;
  const value = Number(textField(node, "value"));
  return kind === "special" && Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

const instant = (node: unknown): number => {
  const ms = Date.parse(textField(node, "iso") ?? "");
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/** Compares two present cells of the same rank. */
function sameRank(
  a: Cell & { readonly present: true },
  b: Cell & { readonly present: true },
  rank: number,
): number {
  if (rank === 0) return numeric(a.node, a.kind) - numeric(b.node, b.kind);
  if (rank === 2) return instant(a.node) - instant(b.node);
  if (rank === 3) return Number(a.node === true) - Number(b.node === true);
  const left = leafText(a.node, a.kind);
  const right = leafText(b.node, b.kind);
  return left < right ? -1 : Number(left > right);
}

/** Orders two cells: numbers, then strings, dates, booleans, everything else, null and undefined, absent last. */
export function compareCells(a: Cell, b: Cell): number {
  const rank = rankOf(a) - rankOf(b);
  if (rank !== 0 || !a.present || !b.present) return rank;
  const order = sameRank(a, b, rankOf(a));
  return Number.isNaN(order) ? 0 : Math.sign(order);
}
