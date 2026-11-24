// The tree's state: which nodes are open and the rows they give, with toggles, expand all, collapse all and reveal.
import type { Path } from "@jsnb/core";
import type { Ref } from "vue";
import { computed } from "vue";

import type { Toggled } from "../model/expansion.js";
import {
  collapseAll,
  expandAll,
  expansion,
  revealPath,
  toggle,
  toggleDeep,
} from "../model/expansion.js";
import type { Focus, Row } from "../model/tree.js";
import { flatten } from "../model/tree.js";
import { keyed } from "./keyed.js";

export type TreeSource = {
  readonly json: Readonly<Ref<unknown>>;
  readonly expandDepth: Readonly<Ref<number>>;
  readonly focus: Readonly<Ref<Focus | undefined>>;
};

/** Rows of the value under the current expansion; the expansion resets when the expand depth changes. */
export function useTree(source: TreeSource) {
  // A new expand depth (an option change) starts the expansion over.
  const state = keyed(
    () => source.expandDepth.value,
    (depth) => expansion(depth),
  );
  const rows = computed<readonly Row[]>(() => {
    const focus = source.focus.value;
    return flatten(source.json.value, { expansion: state.value, ...(focus ? { focus } : {}) });
  });
  return {
    rows,
    toggle: (row: Toggled, deep: boolean) => {
      state.value = deep ? toggleDeep(state.value, row) : toggle(state.value, row);
    },
    expandAll: () => {
      state.value = expandAll();
    },
    collapseAll: () => {
      state.value = collapseAll();
    },
    reveal: (path: Path) => {
      state.value = revealPath(state.value, path);
    },
  };
}
