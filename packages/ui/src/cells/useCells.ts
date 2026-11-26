// The cell list's models from the stores: one CellModel per cell, the page every card shares and
// each card's own state, derived with computed and never stored, so the components render plain values and their tests
// build them by hand. The elapsed time of a running cell is redrawn every 100 ms while one runs.
import type { Cell, CellId } from "@jsnb/core";
import { computed } from "vue";

import { elapsedText } from "../app/models.js";
import { runsOff } from "../app/useShell.js";
import { useNow } from "../composables/useNow.js";
import { completionWords } from "../editor/completion.js";
import type { useNotebookStore } from "../store/notebook.js";
import { useRunCountStore } from "../store/runCounts.js";
import type { useContainersStore } from "../store/containers.js";
import type { useSettingsStore } from "../store/settings.js";
import type { useUiStore } from "../store/ui.js";
import type { CardPage } from "./card.js";
import { useStates } from "./cardStates.js";
import type { CellModel } from "./models.js";
import { autoRunOf, editedSince, routesOf, runFact, staleWhy } from "./models.js";
import { aboutOf, nameOf, nameOptionsOf } from "./names.js";
import type { OutputHost } from "./outputHost.js";
import { capRem } from "./resultLines.js";
import { routeHits } from "./routeHits.js";
import { remPx } from "../composables/useResize.js";
import { insideOf } from "./summary.js";
import { isFolded } from "../store/fold.js";
import { exportersOf } from "../panel/exporters.js";

type Stores = {
  readonly store: ReturnType<typeof useNotebookStore>;
  readonly ui: ReturnType<typeof useUiStore>;
  readonly settings: ReturnType<typeof useSettingsStore>;
  readonly containers: ReturnType<typeof useContainersStore>;
};

const tickMs = 100;
const numberSetting = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** The run models need the clock while a cell runs, and the running cell's number for "queued · after cell n". */
function useRunClock(store: Stores["store"]) {
  const running = computed(() => store.cellsInOrder.some((cell) => cell.status === "running"));
  const now = useNow(() => running.value, tickMs);
  return (cell: Cell): { elapsed: string | null; after: number | null } => {
    const started = Date.parse(store.lastExecutionOf(cell.id)?.startedAt ?? "");
    const ahead = store.cellsInOrder.findIndex((each) => each.status === "running");
    return {
      elapsed: Number.isNaN(started) ? null : elapsedText(now.value - started),
      after: ahead < 0 ? null : ahead + 1,
    };
  };
}

type Numbers = { readonly numberOf: (cell: CellId) => number; readonly off: () => boolean };

/** A route cell's requests and the status of the last one, from the event outputs its routes claim; null for a cell
 * that serves no route. */
function requestsOf(store: Stores["store"], cell: Cell) {
  const routes = store.mirror.routes.filter((route) => route.cell === cell.id);
  if (routes.length === 0) return null;
  const events = (store.lastExecutionOf(cell.id)?.outputs ?? []).flatMap((output) =>
    output.kind === "event" ? [output] : [],
  );
  const hits = routeHits(routes, events).routes.flatMap((each) => each.hits);
  const count = routes.reduce((sum, route) => sum + route.hits, 0);
  return { count, last: hits.at(-1)?.status ?? null };
}

/** One CellModel per cell, in order. */
function useModels(stores: Stores, { numberOf, off }: Numbers) {
  const { store, ui, containers } = stores;
  const counts = useRunCountStore();
  const clock = useRunClock(store);
  const pageAttached = computed(() => store.mirror.notebook?.realm.attached ?? false);
  const exporters = computed(() =>
    exportersOf(store.cellsInOrder, (cell) => store.mirror.graph.get(cell)?.exports),
  );
  // a marked range (⇧↑ ⇧↓) shows every cell of it selected; the selected cell alone holds the tab stop and edits
  const marked = computed(() => new Set(store.markedCells.map((cell) => cell.id)));
  return computed<readonly CellModel[]>(() =>
    store.cellsInOrder.map((cell, at): CellModel => {
      const entry = store.mirror.graph.get(cell.id);
      const about = aboutOf(cell, entry, {
        routes: store.mirror.routes,
        exporters: exporters.value,
      });
      const last = store.lastExecutionOf(cell.id);
      const pinned = ui.pinned === cell.id;
      const live = store.attach.state === "attached" && containers.cells.has(cell.id);
      return {
        id: cell.id,
        number: at + 1,
        type: cell.type,
        source: cell.source,
        status: cell.status,
        stale: cell.stale,
        count: counts.countOf(cell.id),
        selected: marked.value.has(cell.id),
        current: ui.selected === cell.id,
        editing: ui.selected === cell.id && ui.mode === "edit",
        runOff: off() || (cell.type === "client" && !pageAttached.value),
        name: nameOf(cell, entry, store.mirror.routes, nameOptionsOf(stores.settings)),
        about,
        staleWhy: cell.stale ? staleWhy(entry, store.mirror.graph, numberOf) : null,
        editedSince: editedSince(cell),
        routes: routesOf(cell.id, store.mirror.routes),
        run: runFact(cell, last, { ...clock(cell), numberOf }),
        autoRun: autoRunOf(cell.id, store.mirror.autoRun, last, numberOf),
        meta: cell.meta,
        folded: isFolded(cell, ui.foldAll, ui.opened),
        inside: insideOf({
          ...cell,
          about,
          requests: requestsOf(store, cell),
          outputs: last?.outputs ?? [],
          live: cell.type === "client" && live,
          pinned,
        }),
        pinned,
        renaming: ui.renaming === cell.id,
      };
    }),
  );
}

/** A result's height cap: seven lines unless the user or the workspace set outputs.maxHeightPx, whose px then rule. */
function capOf(settings: Stores["settings"]): Pick<CardPage, "maxHeight" | "sevenLines"> {
  const set = settings.values["outputs.maxHeightPx"];
  if (set !== undefined && set.source !== "default")
    return { maxHeight: numberSetting(set.value, 400), sevenLines: false };
  return { maxHeight: Math.round(capRem * remPx()), sevenLines: true };
}

/** What every card shares: the settings, the services, the words to complete. */
function usePage(
  { store, settings }: Stores,
  host: OutputHost,
  mac: boolean,
  { numberOf, off }: Numbers,
) {
  const words = computed(() => completionWords(store.cellsInOrder.map((cell) => cell.source)));
  return computed<CardPage>(() => ({
    mac,
    host,
    ...capOf(settings),
    wordWrap: settings.valueOf("editor.wordWrap") !== false,
    tabSize: numberSetting(settings.valueOf("editor.tabSize"), 2),
    words: () => words.value,
    off: off(),
    loadMore: async (cell, index, request) => {
      const slice = await store.outputValue(cell, index, request.path, request.offset);
      if (slice === undefined) throw new Error("The rest of the value could not be loaded.");
      return slice;
    },
    definedBy: (cell, by) => (by === cell ? "this cell" : `cell ${String(numberOf(by))}`),
    functionSource: (cell, name) => {
      const realm = store.byId.get(cell)?.type;
      const by = store.cellsInOrder.findLast(
        (each) => each.type === realm && store.mirror.graph.get(each.id)?.defines.includes(name),
      );
      return by === undefined
        ? undefined
        : { cell: by.id, label: `cell ${String(numberOf(by.id))}` };
    },
  }));
}

export function useCells(stores: Stores, host: OutputHost, mac: boolean) {
  const off = computed(() => runsOff(stores.store));
  const numbers = computed(
    () => new Map(stores.store.cellsInOrder.map((cell, at) => [cell.id, at + 1])),
  );
  const numbering: Numbers = {
    numberOf: (cell) => numbers.value.get(cell) ?? 0,
    off: () => off.value,
  };
  return {
    cells: useModels(stores, numbering),
    page: usePage(stores, host, mac, numbering),
    stateOf: useStates(stores),
    off,
  };
}
