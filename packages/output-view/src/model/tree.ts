// Flattens a wire-form value into the rows the tree view renders, walking only open nodes.
import type { Path } from "@jsnb/core";

import type { Expansion } from "./expansion.js";
import { deepOf, expansion, isOpen } from "./expansion.js";
import { segmentText } from "./path.js";
import type { RowKey, WireKind } from "./wire.js";
import { childCount, children, isContainer, kindOf } from "./wire.js";

/** A node of the value: `id` is its path in the copy-path form, `value` its wire-form node. */
export type NodeRow = {
  readonly role: "node";
  readonly id: string;
  readonly path: Path;
  readonly depth: number;
  readonly key: RowKey;
  readonly value: unknown;
  readonly kind: WireKind;
  readonly hasChildren: boolean;
  readonly count: number;
  readonly expanded: boolean;
  readonly selected: boolean;
};

/** The closing bracket line of an open container. */
export type CloseRow = {
  readonly role: "close";
  readonly id: string;
  readonly path: Path;
  readonly depth: number;
  readonly kind: WireKind;
};

/** "n hidden": the children of `path` a search or an "Only matches" query left out. */
export type HiddenRow = {
  readonly role: "hidden";
  readonly id: string;
  readonly path: Path;
  readonly depth: number;
  readonly count: number;
};

export type Row = NodeRow | CloseRow | HiddenRow;

/**
 * Rows to bring forward: `ids` are selected (search matches, query results), `within` are their ancestors, opened so
 * the selection is visible; with `only`, nodes neither selected, above a selection nor inside one are hidden.
 */
export type Focus = {
  readonly ids: ReadonlySet<string>;
  readonly within: ReadonlySet<string>;
  readonly only: boolean;
};

export type FlattenOptions = { readonly expansion?: Expansion; readonly focus?: Focus };

type Walk = {
  readonly rows: Row[];
  readonly expansion: Expansion;
  readonly focus: Focus | undefined;
};

type At = {
  readonly id: string;
  readonly path: Path;
  readonly depth: number;
  readonly key: RowKey;
  readonly inherited: boolean | undefined;
  readonly inside: boolean;
};

const segmentsText = (segments: Path): string => {
  let text = "";
  for (const segment of segments) text += segmentText(segment);
  return text;
};

const isShown = (focus: Focus | undefined, id: string, inside: boolean): boolean =>
  focus === undefined || !focus.only || inside || focus.ids.has(id) || focus.within.has(id);

function visitChildren(walk: Walk, node: unknown, kind: WireKind, parent: At): void {
  let hidden = 0;
  for (const child of children(node, kind)) {
    const id = parent.id + segmentsText(child.segments);
    if (!isShown(walk.focus, id, parent.inside)) {
      hidden += 1;
      continue;
    }
    const path = [...parent.path, ...child.segments];
    visit(walk, child.node, { ...parent, id, path, depth: parent.depth + 1, key: child.key });
  }
  if (hidden > 0) {
    walk.rows.push({
      role: "hidden",
      id: `${parent.id}#hidden`,
      path: parent.path,
      depth: parent.depth + 1,
      count: hidden,
    });
  }
}

function visit(walk: Walk, node: unknown, at: At): void {
  const kind = kindOf(node);
  const count = isContainer(kind) ? childCount(node, kind) : 0;
  const selected = walk.focus?.ids.has(at.id) ?? false;
  const reveal = walk.focus?.within.has(at.id) ?? false;
  const open = count > 0 && isOpen(walk.expansion, at, at.inherited, reveal);
  const { id, path, depth, key } = at;
  walk.rows.push({
    role: "node",
    id,
    path,
    depth,
    key,
    value: node,
    kind,
    hasChildren: count > 0,
    count,
    expanded: open,
    selected,
  });
  if (!open) return;
  const inherited = deepOf(walk.expansion, id, at.inherited);
  visitChildren(walk, node, kind, { ...at, inherited, inside: at.inside || selected });
  walk.rows.push({ role: "close", id: `${id}#close`, path, depth, kind });
}

/**
 * The rows of a value: the root first, then the children of every open node in order, a closing row after each open
 * container and an "n hidden" row where a focus left children out. Closed nodes are not walked, so the cost follows
 * what is shown, not the size of the value.
 */
export function flatten(json: unknown, options: FlattenOptions = {}): Row[] {
  const walk: Walk = {
    rows: [],
    expansion: options.expansion ?? expansion(),
    focus: options.focus,
  };
  visit(walk, json, {
    id: "$",
    path: [],
    depth: 0,
    key: { kind: "root" },
    inherited: undefined,
    inside: false,
  });
  return walk.rows;
}
