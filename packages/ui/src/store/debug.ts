// The page's side of the debugger (03-api §4.9): the state the mirror keeps from notebook.get and the debug.* events,
// the frame the user chose on the paused stack, the watch expressions (per notebook, in this browser), and the debug
// commands sent through the daemon. Reads of a paused kernel (stack, scopes, variables, evaluations) go through here.
import type {
  CellId,
  DebugFrame,
  DebugPause,
  DebugScope,
  DebugState,
  DebugVariable,
} from "@jsnb/core";
import { defineStore } from "pinia";
import type { PauseClock } from "@jsnb/runtime-web";
import type { ComputedRef } from "vue";
import { computed, ref, shallowRef, watch } from "vue";

import { attempter, usePageReport } from "./attempt.js";
import { useNotebookStore } from "./notebook.js";
import { noDebug } from "./reduce.js";
import { useSessionStore } from "./socket.js";
import { useUiStore } from "./ui.js";

export type Control = "pause" | "resume" | "stepOver" | "stepInto" | "stepOut";

type BreakpointOptions = {
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
};

const watchKey = (notebook: string) => `jsnb.debug.watch:${notebook}`;

function readWatches(notebook: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(watchKey(notebook)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((each): each is string => typeof each === "string") : [];
  } catch {
    return [];
  }
}

function writeWatches(notebook: string, watches: readonly string[]): void {
  try {
    localStorage.setItem(watchKey(notebook), JSON.stringify(watches));
  } catch {
    // a browser that keeps nothing: the watches last as long as the page
  }
}

type Calls = {
  readonly client: () => ReturnType<ReturnType<typeof useSessionStore>["session"]>["client"];
  readonly notebook: () => string;
  readonly attempt: ReturnType<typeof attempter>;
};

/** The breakpoint commands, sent through the daemon (its debug.breakpoints event brings the new list). */
function breakpointCalls({ client, notebook, attempt }: Calls) {
  const set = (cell: CellId, line: number, options: BreakpointOptions = {}) =>
    attempt(() => client().debug.setBreakpoint({ notebook: notebook(), cell, line, ...options }));
  const remove = (breakpointId: string) =>
    attempt(() => client().debug.removeBreakpoint({ notebook: notebook(), breakpointId }));
  return {
    setBreakpoint: set,
    remove,
    removeAll: () =>
      attempt(() => client().debug.removeBreakpoint({ notebook: notebook(), all: true })),
    toggle: (state: DebugState, cell: CellId, line: number) => {
      const there = state.breakpoints.find((each) => each.cell === cell && each.line === line);
      return there === undefined ? set(cell, line) : remove(there.breakpointId);
    },
  };
}

/** The paused kernel's reads and the controls. An evaluation's failure is its answer (`type: "error"`), never a
 * toast: a watch shows it in place. */
function kernelCalls({ client, notebook, attempt }: Calls) {
  return {
    control: (verb: Control) => attempt(() => client().debug[verb]({ notebook: notebook() })),
    scopes: async (frameId: string): Promise<readonly DebugScope[]> =>
      (await attempt(() => client().debug.scope({ notebook: notebook(), frameId })))?.scopes ?? [],
    variables: async (ref: number): Promise<readonly DebugVariable[]> =>
      (await attempt(() => client().debug.variables({ notebook: notebook(), ref })))?.variables ??
      [],
    evaluate: async (expression: string, frameId?: string) => {
      const scoped = frameId === undefined ? {} : { frameId };
      try {
        return await client().debug.evaluate({ notebook: notebook(), expression, ...scoped });
      } catch (error) {
        return {
          repr: error instanceof Error ? error.message : String(error),
          type: "error",
          ref: 0,
        };
      }
    },
  };
}

/** The watch expressions, kept per notebook in this browser. */
function watchList(notebook: () => string) {
  const watches = ref<string[]>([]);
  return {
    watches,
    loadWatches: () => {
      watches.value = readWatches(notebook());
    },
    setWatches: (next: readonly string[]) => {
      watches.value = [...next];
      writeWatches(notebook(), next);
    },
  };
}

/** How long the kernel was paused in the debugger: a bridge call's timeout does not count it. */
function pauseClockOf(paused: ComputedRef<DebugPause | null>): PauseClock {
  let since: number | undefined;
  let held = 0;
  watch(paused, (now) => {
    if (now !== null) since ??= performance.now();
    else if (since !== undefined) {
      held += performance.now() - since;
      since = undefined;
    }
  });
  return { paused: () => since !== undefined, heldMs: () => held };
}

/** The stack of each pause, read once; the frame the user chose (null: the innermost); Run and Debug opened on the
 * first pause the page sees, as VS Code's opens when a session starts. */
function pausedStack(paused: ComputedRef<DebugPause | null>, calls: Calls) {
  const ui = useUiStore();
  const frames = shallowRef<readonly DebugFrame[]>([]);
  const chosen = ref<string | null>(null);
  const pauses = ref(0);
  let shown = false;
  watch(paused, async (now) => {
    chosen.value = null;
    frames.value = [];
    if (now === null) return;
    pauses.value += 1;
    if (!shown) ui.openPlace({ region: "side", view: "debug" });
    shown = true;
    const read = await calls.attempt(() =>
      calls.client().debug.stack({ notebook: calls.notebook() }),
    );
    if (paused.value === now) frames.value = read?.frames ?? [];
  });
  const frame = computed<DebugFrame | undefined>(
    () => frames.value.find((each) => each.frameId === chosen.value) ?? frames.value[0],
  );
  return { frames, chosen, pauses, frame };
}

export const useDebugStore = defineStore("debug", () => {
  const session = useSessionStore();
  const notebook = useNotebookStore();
  const ui = useUiStore();
  const calls: Calls = {
    client: () => session.session().client,
    notebook: () => session.session().notebook,
    attempt: attempter(usePageReport()),
  };
  const state = computed<DebugState>(() => notebook.mirror.notebook?.debug ?? noDebug);
  const paused = computed(() => state.value.paused);
  /** A breakpoint the gutter's right click asked to edit in Run and Debug. */
  const editRequest = shallowRef<{ readonly cell: CellId; readonly line: number } | null>(null);
  const breakpoints = breakpointCalls(calls);
  return {
    state,
    paused,
    ...pausedStack(paused, calls),
    pauseClock: pauseClockOf(paused),
    ...watchList(calls.notebook),
    ...kernelCalls(calls),
    ...breakpoints,
    editRequest,
    toggle: (cell: CellId, line: number) => breakpoints.toggle(state.value, cell, line),
    /** Opens Run and Debug on the breakpoint at `cell`'s `line`, set first when there is none, to edit it. */
    requestEdit: async (cell: CellId, line: number) => {
      const there = state.value.breakpoints.some(
        (each) => each.cell === cell && each.line === line,
      );
      if (!there) await breakpoints.setBreakpoint(cell, line);
      ui.openPlace({ region: "side", view: "debug" });
      editRequest.value = { cell, line };
    },
  };
});
