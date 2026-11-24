// The query bar's state for OutputQueryBar (11-query §4) over the model's reducer, with its actions (queryActions.ts),
// the elapsed time of a running query, and a pinned query run again when the view mounts.
import type { QueryMode } from "@jsnb/core";
import { computed, onMounted } from "vue";

import type { Chip } from "../model/chips.js";
import { availableModes } from "../model/engines.js";
import type { QueryAction } from "../model/query.js";
import type { QueryBarSource } from "./queryActions.js";
import {
  addChip,
  barOf,
  cancel,
  dispatch,
  engines,
  openBar,
  recall,
  reset,
  run,
  setMode,
} from "./queryActions.js";
import { useElapsed } from "./useElapsed.js";

export type { QueryBarSource } from "./queryActions.js";

export function useQueryBar(source: QueryBarSource) {
  const bar = barOf(source);
  const { state, open } = bar;
  // Side effect: a query pinned in `meta.outputQuery` shows its result again after a reload.
  onMounted(() => {
    if (state.value.pinned) void run(bar, true);
  });
  return {
    state,
    open,
    progress: bar.progress,
    elapsed: useElapsed(computed(() => state.value.status === "running")),
    modes: computed(() => availableModes(engines(bar))),
    dispatch: (action: QueryAction) => {
      dispatch(bar, action);
    },
    run: (pin = false) => run(bar, pin),
    reset: (close: boolean) => {
      reset(bar, close);
    },
    setMode: (mode: QueryMode) => setMode(bar, mode),
    cancel: () => {
      cancel(bar);
    },
    openBar: () => {
      openBar(bar);
    },
    recall: (direction: 1 | -1) => {
      recall(bar, direction);
    },
    addChip: (chip: Chip) => addChip(bar, chip),
  };
}

export type QueryBar = ReturnType<typeof useQueryBar>;
