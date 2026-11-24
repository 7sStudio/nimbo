// Which tree nodes are open: a default depth, the user's per-node toggles and ⌘-toggles that open or close a subtree.
import type { Path } from "@jsnb/core";

import { ancestorIds } from "./path.js";

/**
 * `depth`: nodes shallower than this are open by default (the root is depth 0, so 2 shows the root's children and
 * theirs). `overrides`: a node the user toggled. `deep`: a node whose whole subtree the user opened or closed.
 */
export type Expansion = {
  readonly depth: number;
  readonly overrides: ReadonlyMap<string, boolean>;
  readonly deep: ReadonlyMap<string, boolean>;
};

/** The default of `options.expandDepth`. */
export const defaultExpandDepth = 2;

/** Nodes open down to `depth` (default 2) and nothing toggled. */
export const expansion = (depth = defaultExpandDepth): Expansion => ({
  depth,
  overrides: new Map(),
  deep: new Map(),
});

/** Every node open. */
export const expandAll = (): Expansion => expansion(Number.POSITIVE_INFINITY);

/** Only the root open, so its children show collapsed with their counts. */
export const collapseAll = (): Expansion => expansion(1);

/** A row's identity and state as the toggles need it. */
export type Toggled = { readonly id: string; readonly expanded: boolean };

/** Whether `id` names `ancestor` or a node below it in the copy-path form. */
const within = (id: string, ancestor: string): boolean =>
  id === ancestor ||
  (id.startsWith(ancestor) &&
    (id.charAt(ancestor.length) === "." || id.charAt(ancestor.length) === "["));

const without = (map: ReadonlyMap<string, boolean>, ancestor: string): Map<string, boolean> =>
  new Map([...map].filter(([id]) => !within(id, ancestor)));

/** Opens a closed node or closes an open one. */
export const toggle = (state: Expansion, row: Toggled): Expansion => ({
  ...state,
  overrides: new Map([...state.overrides, [row.id, !row.expanded]]),
});

/** ⌘ + chevron: opens or closes the node and its whole subtree, forgetting earlier toggles inside it. */
export const toggleDeep = (state: Expansion, row: Toggled): Expansion => ({
  depth: state.depth,
  overrides: without(state.overrides, row.id),
  deep: new Map([...without(state.deep, row.id), [row.id, !row.expanded]]),
});

/**
 * Whether a node is open. `inherited` is the nearest ⌘-toggle above it; `reveal` forces it open because a search
 * match or a query result lies below it. A node the user toggled keeps the user's choice.
 */
export function isOpen(
  state: Expansion,
  at: { readonly id: string; readonly depth: number },
  inherited: boolean | undefined,
  reveal: boolean,
): boolean {
  const own = state.overrides.get(at.id);
  if (own !== undefined) return own;
  if (reveal) return true;
  const deep = state.deep.get(at.id) ?? inherited;
  return deep ?? at.depth < state.depth;
}

/** The ⌘-toggle a node passes to its children: its own, else the one it inherited. */
export const deepOf = (
  state: Expansion,
  id: string,
  inherited: boolean | undefined,
): boolean | undefined => state.deep.get(id) ?? inherited;

/** Opens every node on the way to `path`, so a jump (a breadcrumb, a ref, a search match) lands on a visible row. */
export function revealPath(state: Expansion, path: Path): Expansion {
  const opened = ancestorIds(path).map((id) => [id, true] as const);
  return { ...state, overrides: new Map([...state.overrides, ...opened]) };
}
