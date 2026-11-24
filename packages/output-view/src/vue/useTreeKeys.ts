// The tree's keyboard: ↑ ↓ move, → opens or steps in, ← closes or steps out, ↩
// toggles, ⌘C copies the value, ⌘⇧C and ⌥⌘C copy the path. The tree keeps focus; the active row is aria-activedescendant.
import type { Ref } from "vue";

import type { NodeRow, Row } from "../model/tree.js";
import { keyed } from "./keyed.js";

export type TreeActions = {
  readonly toggle: (row: NodeRow, deep: boolean) => void;
  readonly copyValue: (row: NodeRow) => void;
  readonly copyPath: (row: NodeRow) => void;
  readonly showAll: () => void;
  readonly scrollTo: (index: number) => void;
};

const isMod = (event: KeyboardEvent): boolean => event.metaKey || event.ctrlKey;

/** The index of the next row in `direction` that is not a closing bracket, or `from` when there is none. */
function nextIndex(rows: readonly Row[], from: number, direction: 1 | -1): number {
  for (let index = from + direction; index >= 0 && index < rows.length; index += direction) {
    if (rows[index]?.role !== "close") return index;
  }
  return from;
}

/** The index of the row's parent: the nearest row above it one level up. */
function parentIndex(rows: readonly Row[], from: number): number {
  const depth = rows[from]?.depth ?? 0;
  for (let index = from - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.role === "node" && row.depth < depth) return index;
  }
  return from;
}

/** ↑ ↓ Home End: the row each key moves to. */
const moves: Readonly<Partial<Record<string, (rows: readonly Row[], at: number) => number>>> = {
  ArrowDown: (rows, at) => nextIndex(rows, at, 1),
  ArrowUp: (rows, at) => nextIndex(rows, at, -1),
  Home: () => 0,
  End: (rows) => nextIndex(rows, rows.length, -1),
};

/** The tree's rows and its value: a new value (full screen going down) puts the active row back on the first. */
export type TreeKeysSource = {
  readonly rows: Readonly<Ref<readonly Row[]>>;
  readonly value: () => unknown;
};

export function useTreeKeys({ rows, value }: TreeKeysSource, actions: TreeActions) {
  const active = keyed(value, (): number => 0);
  const moveTo = (index: number): void => {
    active.value = index;
    actions.scrollTo(index);
  };

  function horizontal(row: NodeRow, opening: boolean): void {
    if (opening && row.hasChildren && !row.expanded) actions.toggle(row, false);
    else if (opening && row.expanded) moveTo(nextIndex(rows.value, active.value, 1));
    else if (!opening && row.expanded) actions.toggle(row, false);
    else if (!opening) moveTo(parentIndex(rows.value, active.value));
  }

  function onNode(event: KeyboardEvent, row: NodeRow): boolean {
    const key = event.key.toLowerCase();
    if (key === "c" && isMod(event)) {
      if (event.shiftKey || event.altKey) actions.copyPath(row);
      else actions.copyValue(row);
      return true;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      horizontal(row, event.key === "ArrowRight");
      return true;
    }
    if (event.key !== "Enter" || !row.hasChildren) return false;
    actions.toggle(row, isMod(event));
    return true;
  }

  function onKeydown(event: KeyboardEvent): void {
    const row = rows.value[active.value];
    const move = moves[event.key];
    let handled = true;
    if (move) moveTo(move(rows.value, active.value));
    else if (row?.role === "hidden" && event.key === "Enter") actions.showAll();
    else handled = row?.role === "node" && onNode(event, row);
    if (handled) event.preventDefault();
  }

  return { active, onKeydown };
}
