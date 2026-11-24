// The debugger's page commands, as VS Code's keys run them: Ctrl Shift F5 runs the selected cell under the debugger,
// F5 continues, F6 pauses, F10, F11 and Shift F11 step, Shift F5 stops the run, F9 toggles a breakpoint on the caret's
// line. Their keys' when clauses name the debug context keys (debugSession), so each key is the browser's elsewhere.
import type { CellId } from "@jsnb/core";

import type { Control } from "../store/debug.js";
import { useDebugStore } from "../store/debug.js";
import { useNotebookStore } from "../store/notebook.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { uiCommand } from "./command.js";

type Place = { readonly cell: CellId; readonly line: number };
type Stores = {
  readonly debug: ReturnType<typeof useDebugStore>;
  readonly ui: ReturnType<typeof useUiStore>;
  readonly notebook: ReturnType<typeof useNotebookStore>;
};

const writing = (command: Command): Command => ({ ...command, writes: true });

/** "paused" while the kernel is paused in the debugger, "running" while a run goes with the debugger attached. */
export type DebugSession = "paused" | "running";

export function debugSession(
  debug: Pick<Stores["debug"], "state">,
  notebook: Pick<Stores["notebook"], "runningCell">,
): DebugSession | undefined {
  if (debug.state.state === "paused") return "paused";
  return debug.state.state === "running" && notebook.runningCell !== null ? "running" : undefined;
}

/** The caret's cell and line in the edited code cell. */
function caretPlace({ ui, notebook }: Stores): Place | undefined {
  const at = ui.caretAt;
  if (ui.mode !== "edit" || at?.cell !== ui.selected) return undefined;
  const type = notebook.byId.get(at.cell)?.type;
  return type === "server" || type === "client" ? { cell: at.cell, line: at.line } : undefined;
}

/** The cell and line F9 or a gutter click names: the arguments, else the caret. */
function placeOf(args: Args | undefined, stores: Stores): Place | undefined {
  const cell = args?.cell;
  const line = args?.line;
  return typeof cell === "string" && typeof line === "number" ? { cell, line } : caretPlace(stores);
}

/** Start Debugging: the selected code cell's run, which pauses on its breakpoints. */
function start({ ui, notebook }: Stores): Command {
  const runSelected = () => {
    const cell = notebook.selectedCell;
    return cell === undefined || cell.type === "markdown"
      ? undefined
      : notebook.run(cell.id, ui.draftOf(cell.id));
  };
  return writing(
    uiCommand(
      "ui.debug.start",
      "Run the selected cell under the debugger",
      runSelected,
      () => (notebook.selectedCell?.type ?? "markdown") !== "markdown",
    ),
  );
}

/** Continue, pause, the steps and stop. */
function controls({ debug, notebook }: Stores): Command[] {
  const isPaused = () => debug.state.state === "paused";
  const step = (id: string, title: string, verb: Control) =>
    writing(uiCommand(id, title, () => debug.control(verb), isPaused));
  return [
    writing(uiCommand("ui.debug.continue", "Continue", () => debug.control("resume"), isPaused)),
    writing(
      uiCommand(
        "ui.debug.pause",
        "Pause the kernel",
        () => debug.control("pause"),
        () => debug.state.state === "running",
      ),
    ),
    step("ui.debug.stepOver", "Step over", "stepOver"),
    step("ui.debug.stepInto", "Step into", "stepInto"),
    step("ui.debug.stepOut", "Step out", "stepOut"),
    writing(
      uiCommand(
        "ui.debug.stop",
        "Stop the run",
        () => notebook.interrupt(),
        () => debugSession(debug, notebook) !== undefined,
      ),
    ),
  ];
}

/** Toggle, edit and remove breakpoints. */
function breakpointCommands(stores: Stores): Command[] {
  const { debug } = stores;
  const onPlace = (id: string, title: string, run: (place: Place) => unknown) =>
    writing(
      uiCommand(
        id,
        title,
        (args) => {
          const place = placeOf(args, stores);
          return place === undefined ? undefined : run(place);
        },
        (args) => placeOf(args, stores) !== undefined,
      ),
    );
  return [
    onPlace("ui.debug.toggleBreakpoint", "Toggle a breakpoint on the line", (place) =>
      debug.toggle(place.cell, place.line),
    ),
    onPlace("ui.debug.editBreakpoint", "Edit the breakpoint on the line", (place) =>
      debug.requestEdit(place.cell, place.line),
    ),
    writing(
      uiCommand(
        "ui.debug.removeAll",
        "Remove every breakpoint",
        () => debug.removeAll(),
        () => debug.state.breakpoints.length > 0,
      ),
    ),
  ];
}

export function debugCommands(): readonly Command[] {
  const stores = { debug: useDebugStore(), ui: useUiStore(), notebook: useNotebookStore() };
  return [start(stores), ...controls(stores), ...breakpointCommands(stores)];
}
