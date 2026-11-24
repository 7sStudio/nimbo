// What a card's events do: a command goes through the dispatcher on its own cell (selected first);
// the editor's text is a draft sent after the pause or on blur; its focus enters edit mode and a click elsewhere leaves
// it; ↑ and ↓ at an edge move to the neighbour's editor; the viewer's meta changes, copies, jumps and handled requests;
// the card's own copies (an error, a route's URL) through the clipboard with their toast.
import type { CellId } from "@jsnb/core";

import type { Dispatcher } from "../commands/dispatch.js";
import type { Leave } from "../editor/keymap.js";
import { copyText } from "../store/clipboard.js";
import type { useUiStore } from "../store/ui.js";
import type { MetaPatch } from "./card.js";
import { leaveEditOnBlur, watchPresses } from "./editBlur.js";
import type { useDrafts } from "./useDrafts.js";

type Deps = {
  readonly dispatcher: Pick<Dispatcher, "dispatch">;
  readonly ui: ReturnType<typeof useUiStore>;
  readonly drafts: ReturnType<typeof useDrafts>;
};

/** The editor's events: its text is a draft, its focus enters edit mode, its caret goes to the status bar. */
function editorEvents(cell: CellId, { dispatcher, ui, drafts }: Deps) {
  return {
    change: (text: string) => {
      drafts.change(cell, text);
    },
    focus: () => {
      ui.select(cell);
      if (ui.mode !== "edit") ui.setMode("edit");
    },
    blur: () => {
      void drafts.flush(cell);
      leaveEditOnBlur(ui, cell);
    },
    caret: (line: number, column: number) => {
      ui.setCaretAt({ cell, line, column });
    },
    leave: (edge: Leave) => {
      void drafts.flush(cell);
      void dispatcher.dispatch(edge === "previous" ? "ui.edit.previous" : "ui.edit.next");
    },
  };
}

/** The handlers of one card's events. */
export function cellEvents(cell: CellId, deps: Deps) {
  const { dispatcher, ui } = deps;
  watchPresses();
  return {
    command: (id: string, args?: Record<string, unknown>) => {
      ui.select(cell);
      void dispatcher.dispatch(id, args);
    },
    ...editorEvents(cell, deps),
    meta: (patch: MetaPatch) => {
      void dispatcher.dispatch("cell.update", { cell, meta: patch });
    },
    copy: (event: { readonly what: string }) => {
      ui.toast({ kind: "success", title: `Copied ${event.what === "json" ? "JSON" : event.what}` });
    },
    copyText: (text: string, what: string) => {
      void copyText(ui, text, what);
    },
    jump: (target: { readonly cell: string }) => {
      void dispatcher.dispatch("ui.select", { cell: target.cell });
    },
    handled: () => {
      if (ui.fullscreen?.cell === cell) ui.fullscreen = null;
      if (ui.outputRequest?.cell === cell) ui.outputRequest = null;
    },
  };
}
