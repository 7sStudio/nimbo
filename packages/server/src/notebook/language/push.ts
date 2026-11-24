// When diagnostics are pushed: a notebook is warm once a language.lsp or a
// notebook.diagnostics call arrived for it; for a warm notebook the daemon recomputes after each edit, move, deletion,
// install and change of `.env` names, debounced, and emits cell.diagnostics for each cell whose list changed. Each
// recompute carries the notebook's edit generation, and a result older than the current one is discarded.
import type { CellDiagnostics, CellId, EventEnvelope } from "@jsnb/core";

import type { EventBus } from "../../events/bus.js";
import { workspaceStream } from "../../events/bus.js";
import type { Log } from "../../events/log.js";

export type Pusher = {
  /** Marks a notebook warm. */
  readonly warm: (notebook: string) => void;
  /** Records lists the caller already has (notebook.diagnostics), so they are not pushed again. */
  readonly sent: (notebook: string, lists: readonly CellDiagnostics[]) => void;
  /** Recomputes every warm notebook (an install, a change of `.env` names). */
  readonly everyWarm: () => void;
  readonly stop: () => void;
};

type Options = {
  readonly bus: EventBus;
  readonly log: Log;
  readonly compute: (notebook: string) => Promise<readonly CellDiagnostics[]>;
  readonly close: (notebook: string) => void;
  /** An install finished: the projects are built again before the recomputes. */
  readonly reset: () => void;
  /** No warm notebook is left: the worker can end. */
  readonly idle: () => void;
  /** `editor.diagnostics`: off, nothing is pushed. */
  readonly enabled: () => boolean;
  readonly debounceMs?: number;
};

const triggers = new Set(["cell.added", "cell.updated", "cell.moved", "cell.deleted"]);

type Warm = {
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  readonly last: Map<CellId, string>;
};

/** Emits cell.diagnostics for each cell whose list differs from the last one sent, and forgets cells gone. */
function emitChanged(
  bus: EventBus,
  notebook: string,
  state: Warm,
  lists: readonly CellDiagnostics[],
): void {
  const live = new Set(lists.map((list) => list.cell));
  // a cell that left the lists (deleted, or now markdown) gets an empty one, so a page drops its rows
  for (const cell of state.last.keys()) {
    if (live.has(cell)) continue;
    state.last.delete(cell);
    bus.emit(notebook, "cell.diagnostics", { cell, diagnostics: [] });
  }
  for (const list of lists) {
    const text = JSON.stringify(list.diagnostics);
    if (state.last.get(list.cell) === text) continue;
    state.last.set(list.cell, text);
    bus.emit(notebook, "cell.diagnostics", list);
  }
}

/** The warm notebooks and their debounced, generation-checked recomputes. */
function warmTable(options: Options) {
  const warm = new Map<string, Warm>();
  const delay = options.debounceMs ?? 150;
  const recompute = async (notebook: string, state: Warm, generation: number): Promise<void> => {
    try {
      const lists = await options.compute(notebook);
      if (warm.get(notebook) !== state || state.generation !== generation) return; // latest wins
      emitChanged(options.bus, notebook, state, lists);
    } catch (error) {
      options.log.debug({ err: error, notebook }, "the diagnostics could not be computed");
    }
  };
  const schedule = (notebook: string): void => {
    const state = warm.get(notebook);
    if (!state || !options.enabled()) return;
    state.generation += 1;
    const generation = state.generation;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => void recompute(notebook, state, generation), delay);
    state.timer.unref();
  };
  const forget = (notebook: string): void => {
    const state = warm.get(notebook);
    if (!state) return;
    clearTimeout(state.timer);
    warm.delete(notebook);
    options.close(notebook);
    if (warm.size === 0) options.idle();
  };
  return { warm, schedule, forget };
}

export function createPusher(options: Options): Pusher {
  const { warm, schedule, forget } = warmTable(options);
  const everyWarm = (): void => {
    for (const notebook of warm.keys()) schedule(notebook);
  };
  const unlisten = options.bus.listen((event: EventEnvelope) => {
    if (event.type === "notebook.closed" || event.type === "notebook.moved") forget(event.notebook);
    else if (event.type === "packages.done" && event.notebook === workspaceStream) {
      options.reset();
      everyWarm();
    } else if (triggers.has(event.type)) schedule(event.notebook);
  });
  return {
    warm: (notebook) => {
      if (!warm.has(notebook))
        warm.set(notebook, { generation: 0, timer: undefined, last: new Map() });
    },
    sent: (notebook, lists) => {
      const state = warm.get(notebook);
      for (const list of state ? lists : [])
        state?.last.set(list.cell, JSON.stringify(list.diagnostics));
    },
    everyWarm,
    stop: () => {
      unlisten();
      for (const state of warm.values()) clearTimeout(state.timer);
      warm.clear();
    },
  };
}
