// The editor's text on its way to the store: every keystroke is a draft at once,
// cell.update goes out 300 ms after the last one and on blur (a run sends the draft itself, commands/cells.ts), and the
// draft is dropped once the cell's source equals it, so the editor never shows the old text in between; an update
// refused or failed keeps its draft, sent again once the page may write again.
import type { CellId } from "@jsnb/core";
import { textHash } from "@jsnb/core";
import { onBeforeUnmount, watch } from "vue";

import { runsOff } from "../app/useShell.js";
import type { useNotebookStore } from "../store/notebook.js";
import { useSettingsStore } from "../store/settings.js";
import type { useUiStore } from "../store/ui.js";

/** The editor's pause before a draft is sent. */
const draftDelayMs = 300;

/** Drops a draft once the store's source caught up with it (the cell.updated event of our own update or run), never
 * before, so the editor keeps the typed text throughout. */
function dropCaughtUp(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
  sent: Map<CellId, string>,
): void {
  // Side effect: the draft goes with the event that brought its text.
  watch(
    () => store.cellsInOrder.map((cell) => [cell.id, cell.source] as const),
    (cells) => {
      for (const [id, source] of cells) {
        if (ui.draftOf(id) === source) {
          ui.setDraft(id, null);
          sent.delete(id);
        }
      }
    },
  );
}

/** Sends every unsent draft again once the page may write again (a socket back, the page taken again). */
function resendWhenBack(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
  flush: (cell: CellId) => Promise<boolean>,
): void {
  // Side effect: writes coming back send what was typed while they were off.
  watch(
    () => runsOff(store),
    (off) => {
      if (off) return;
      for (const cell of store.cellsInOrder)
        if (ui.draftOf(cell.id) !== undefined) void flush(cell.id);
    },
  );
}

/** Best effort: a tab that goes away sends what was typed in its last 300 ms; returns the way to stop listening. */
function onLeave(send: () => Promise<unknown>): () => void {
  if (typeof window === "undefined") return () => undefined;
  const leave = () => void send();
  window.addEventListener("pagehide", leave);
  return () => {
    window.removeEventListener("pagehide", leave);
  };
}

/** files.autoSave "onFocusChange", as VS Code's: the window losing the focus (another app, another tab) saves;
 * returns the way to stop listening. */
function onFocusLost(save: () => Promise<unknown>): () => void {
  if (typeof window === "undefined") return () => undefined;
  const lost = () => void save();
  const hidden = () => {
    if (document.visibilityState === "hidden") lost();
  };
  window.addEventListener("blur", lost);
  document.addEventListener("visibilitychange", hidden);
  return () => {
    window.removeEventListener("blur", lost);
    document.removeEventListener("visibilitychange", hidden);
  };
}

/** cell.update with the draft and the text it was typed on; true once the daemon took it. A draft sent before this
 * one's answer is typed on this one's text, as the daemon has it by then: drafts in flight chain, however many. */
async function sendDraft(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
  cell: CellId,
  text: string,
): Promise<boolean> {
  const typedOn = ui.draftBaseOf(cell) ?? store.byId.get(cell)?.source ?? "";
  ui.draftSent(cell, text);
  const done = (await store.update(cell, { source: text, base: textHash(typedOn) })) !== undefined;
  if (!done) ui.draftRefused(cell, text, typedOn);
  return done;
}

/** The draft sender of useDrafts. */
function sender(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
  timers: Map<CellId, ReturnType<typeof setTimeout>>,
  sent: Map<CellId, string>,
) {
  /** Sends the cell's draft; true once it went. A refused or failed update is not "sent", so the draft goes again on
   * the next flush, and on its own once writes are back (resendWhenBack). */
  return async (cell: CellId): Promise<boolean> => {
    clearTimeout(timers.get(cell));
    timers.delete(cell);
    const text = ui.draftOf(cell);
    if (text === undefined || text === sent.get(cell)) return false;
    if (text === store.byId.get(cell)?.source) {
      ui.setDraft(cell, null);
      return false;
    }
    // writes off (the socket away, a view-only tab): kept for resendWhenBack, as the editor is read-only meanwhile
    if (runsOff(store)) return false;
    sent.set(cell, text);
    const done = await sendDraft(store, ui, cell, text);
    if (!done && sent.get(cell) === text) sent.delete(cell);
    return done;
  };
}

export function useDrafts(
  store: ReturnType<typeof useNotebookStore>,
  ui: ReturnType<typeof useUiStore>,
) {
  const timers = new Map<CellId, ReturnType<typeof setTimeout>>();
  /** The text last sent per cell: a timer that fires after a run sent the same text sends nothing. */
  const sent = new Map<CellId, string>();

  const flush = sender(store, ui, timers, sent);

  function change(cell: CellId, text: string): void {
    ui.setDraft(cell, text, store.byId.get(cell)?.source);
    clearTimeout(timers.get(cell));
    timers.set(
      cell,
      setTimeout(() => void flush(cell), draftDelayMs),
    );
  }

  dropCaughtUp(store, ui, sent);
  resendWhenBack(store, ui, flush);
  const flushAll = () =>
    Promise.all(
      store.cellsInOrder
        .filter((cell) => ui.draftOf(cell.id) !== undefined)
        .map((cell) => flush(cell.id)),
    );
  ui.flushDrafts.run = flushAll;
  const away = onLeave(flushAll);
  const unfocused = onFocusLost(async () => {
    if (useSettingsStore().valueOf("files.autoSave") !== "onFocusChange") return;
    await flushAll();
    // only unsaved edits: a failed or conflicting save has its banner, and saving again would toast at every blur
    if (store.mirror.saveState === "writing") await store.save();
  });
  onBeforeUnmount(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    ui.flushDrafts.run = () => Promise.resolve();
    away();
    unfocused();
  });
  return { change, flush };
}
