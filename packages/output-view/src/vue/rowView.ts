// How a tree row reads: its key, the label and bracket of a container, the text of a leaf, and the
// part of a long string shown folded.
import type { Path } from "@jsnb/core";

import type { Hint } from "../model/hints.js";
import { foldedChars } from "../model/hints.js";
import type { LeafOptions, Token } from "../model/leaf.js";
import { leafTokens } from "../model/leaf.js";
import { countLabel, preview, typeLabel } from "../model/preview.js";
import type { NodeRow, Row } from "../model/tree.js";
import type { RowKey, WireKind } from "../model/wire.js";
import { isContainer } from "../model/wire.js";

/** How a row's leaf reads: in the viewer's time zone, at its path (refs and dates need both). */
export const leafOptions = (timeZone: string | undefined, at: Path): LeafOptions =>
  timeZone === undefined ? { at } : { timeZone, at };

/** The closing bracket of an open container. */
export const closing = (kind: WireKind): string => (kind === "array" ? "]" : "}");

/** `name: `, `3: `, `"a" => `, or nothing for a Set member and the root. */
export function keyTokens(key: RowKey, options: LeafOptions): Token[] {
  if (key.kind === "name")
    return [
      { kind: "key", text: key.name },
      { kind: "punc", text: ": " },
    ];
  if (key.kind === "index")
    return [
      { kind: "nul", text: String(key.index) },
      { kind: "punc", text: ": " },
    ];
  if (key.kind !== "entry") return [];
  return [...preview(key.node, { ...options, width: 40 }), { kind: "punc", text: " => " }];
}

/** An open container `Price {`, `Array(2) [`, `{`; a closed one `{…}`, `Price {…}`, `Array(14)`. */
function containerTokens(row: NodeRow): Token[] {
  const label = typeLabel(row.value, row.kind) ?? "";
  const named = row.kind === "object" ? [] : [{ kind: "typ" as const, text: `${label} ` }];
  if (row.expanded) return [...named, { kind: "punc", text: row.kind === "array" ? "[" : "{" }];
  if (row.kind === "object" || row.kind === "instance")
    return [...named, { kind: "punc", text: "{…}" }];
  return [{ kind: "typ", text: label }];
}

/** `3 keys`, `14 items` beside a closed container. */
export const closedCount = (row: NodeRow): string | undefined =>
  row.expanded || !row.hasChildren ? undefined : countLabel(row.value, row.kind);

/** A container's label and bracket, an empty container's `{}` or `Map(0) {}`, a leaf's tokens. */
export function valueTokens(row: NodeRow, options: LeafOptions): Token[] {
  if (row.hasChildren) return containerTokens(row);
  return isContainer(row.kind)
    ? preview(row.value, options)
    : leafTokens(row.value, row.kind, options);
}

/** The http(s) address a string links to, from its link hint. */
export function linkOf(hints: readonly Hint[]): string | undefined {
  for (const hint of hints) if (hint.kind === "link") return hint.href;
  return undefined;
}

/** A long string's folded text and how many characters the fold hides, or undefined when it is short. */
export function foldOf(
  value: unknown,
  hints: readonly Hint[],
): { readonly shown: string; readonly hidden: number } | undefined {
  const fold = hints.find((hint) => hint.kind === "fold");
  if (fold === undefined || typeof value !== "string") return undefined;
  return { shown: value.slice(0, foldedChars), hidden: value.length - foldedChars };
}

/** A tree row's attributes: a treeitem with its level, open state and selection; a closing bracket is presentation. */
export function rowAttrs(
  row: Row,
  at: { readonly id: string; readonly start: number; readonly active: boolean },
): Record<string, unknown> {
  const style = { "--row-y": `${String(at.start)}px`, "--depth": row.depth };
  if (row.role === "close") return { role: "none", "data-part": "row", style };
  const node = row.role === "node" ? row : undefined;
  return {
    id: at.id,
    role: "treeitem",
    "data-part": "row",
    "aria-level": row.depth + 1,
    "aria-expanded": node?.hasChildren === true ? node.expanded : undefined,
    "aria-selected": at.active,
    "data-selected": node?.selected === true ? "" : undefined,
    style,
  };
}

/** The text a hint shows beside its value: a unix time with its date, an ISO date's age, "View as tree", a function's
 * cell, an add-on's label; a link and a fold draw on the value itself, so they show nothing here. */
export function hintLabel(hint: Hint): string {
  switch (hint.kind) {
    case "time":
      return hint.source === "seconds" || hint.source === "milliseconds"
        ? `unix time, ${hint.absolute}`
        : hint.relative;
    case "json":
      return "View as tree";
    case "source":
      return `view source in ${hint.target.label}`;
    case "custom":
      return hint.label;
    default:
      return "";
  }
}
