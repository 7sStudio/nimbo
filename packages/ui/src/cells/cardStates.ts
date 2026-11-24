// Each card's own state: its last run's outputs and the error it threw, the page's ⌘F / ⌘⇧F / ⌘⇧O
// request for it, its live container when this page holds the realm, the routes it serves, its values view and its
// editor's draft and caret.
import type { CellId, ErrorInfo } from "@jsnb/core";

import type { useContainersStore } from "../store/containers.js";
import { inClientOf, missingNames } from "../store/missing.js";
import type { useNotebookStore } from "../store/notebook.js";
import type { Overlay } from "../store/overlay.js";
import type { useUiStore } from "../store/ui.js";
import type { CardState, OutputKeys } from "./card.js";
import type { CellModel } from "./models.js";

type Stores = {
  readonly store: ReturnType<typeof useNotebookStore>;
  readonly ui: ReturnType<typeof useUiStore>;
  readonly containers: ReturnType<typeof useContainersStore>;
};

/** The error as the run's error block shows it: an error with an excerpt keeps only that of its data, since its place
 * is the frame (Jump) and its detail the message; any other error is shown as it is, a cell's id in its data said as
 * the cell's number ("cell 2"), never as the id (c_vstpht). */
export function shown(error: ErrorInfo, numberOf: (cell: CellId) => number): ErrorInfo {
  const excerpt = error.data?.excerpt;
  if (typeof excerpt === "string") return { ...error, data: { excerpt } };
  if (error.data === undefined) return error;
  const named = (value: unknown): unknown => {
    if (typeof value !== "string" || !isCellId(value)) return value;
    const number = numberOf(value);
    return number > 0 ? `cell ${String(number)}` : "a cell that is gone";
  };
  return {
    ...error,
    data: Object.fromEntries(Object.entries(error.data).map(([key, value]) => [key, named(value)])),
  };
}

const isCellId = (text: string): boolean => /^c_[0-9a-z]{6}$/u.test(text);

/** The menu of `cell` open now: the cell menu or the type menu, else null (its opener's aria-expanded). */
function menuOf(overlay: Overlay | null, cell: CellId): CardState["menu"] {
  if (overlay?.kind === "cellMenu" && overlay.cell === cell) return "cell";
  return overlay?.kind === "typeMenu" && overlay.cell === cell ? "type" : null;
}

/** The language service's list for the cell, or null while it gave none. */
const diagnosticsOf = (store: Stores["store"], cell: CellId) =>
  store.mirror.diagnostics.get(cell) ?? null;

/** The error the last run of `cell` ended with, as its block shows it; null when the run did not throw. */
function errorOf(store: Stores["store"], cell: CellId): ErrorInfo | null {
  const error = store.lastExecutionOf(cell)?.error;
  /** A cell's place in the notebook, 1-based; 0 when it is gone. */
  const numberOf = (id: CellId): number =>
    store.cellsInOrder.findIndex((each) => each.id === id) + 1;
  return error === undefined ? null : shown(error, numberOf);
}

/** Each card's own state: its outputs, the page's request to them, its live container, values, draft and open menu. */
export function useStates({ store, ui, containers }: Stores) {
  /** The page's ⌘F / ⌘⇧F / ⌘⇧O request for `cell`, if it is the one asked. */
  const requestOf = (cell: CellId): OutputKeys | null => {
    if (ui.fullscreen?.cell === cell) return { kind: "fullscreen", at: ui.fullscreen.index };
    const asked = ui.outputRequest;
    return asked?.cell === cell ? { kind: asked.kind, at: asked.at } : null;
  };
  const lives = new Map<CellId, NonNullable<CardState["live"]>>();
  const liveOf = (cell: CellId) => {
    const made = lives.get(cell) ?? {
      slotInto: (into: HTMLElement) => containers.slot(cell, into),
      release: (from: HTMLElement) => {
        containers.release(cell, from);
      },
    };
    lives.set(cell, made);
    return made;
  };
  const outputsOf = (cell: CellId) => store.lastExecutionOf(cell)?.outputs ?? [];
  return (cell: CellModel, values: CardState["values"]): CardState => {
    const execution = store.lastExecutionOf(cell.id);
    const holds = store.attach.state === "attached" && containers.cells.has(cell.id);
    return {
      outputs: outputsOf(cell.id),
      error: errorOf(store, cell.id),
      routes: store.mirror.routes.filter((route) => route.cell === cell.id),
      execution: execution?.id ?? null,
      request: requestOf(cell.id),
      live: cell.type === "client" && holds ? liveOf(cell.id) : null,
      values,
      caret: cell.editing ? ui.caret : null,
      draft: ui.draftOf(cell.id),
      diagnostics: diagnosticsOf(store, cell.id),
      missing: missingNames(execution?.error),
      inClient: cell.type === "server" ? inClientOf(execution?.error) : null,
      menu: menuOf(ui.overlay, cell.id),
    };
  };
}
