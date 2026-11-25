// The registry's commands as page commands: every command that is not internal, its `notebook` and `cell`
// filled from the page (the open notebook, the selected cell), runs sent without waiting, a failure reported as the
// stores report theirs (store/attempt.ts), a restart while a cell runs confirmed first. Mutating and destructive
// commands are called only here and in store/ (08-code-standards §8 rule 2); a delete goes through the store so it can
// be undone.
import type { AnyCommand } from "@jsnb/core";
import { publicCommands } from "@jsnb/core";

import { useNotebookStore } from "../store/notebook.js";
import { usePageReport } from "../store/attempt.js";
import { consented } from "./consent.js";
import { neighbourOf } from "../store/marked.js";
import { useSessionStore } from "../store/socket.js";
import { useUiStore } from "../store/ui.js";
import type { Args, Command } from "./command.js";
import { titleOf } from "./command.js";
import { registryTitles } from "./labels.js";

/** The toast a finished command leaves: only where the page shows no other sign of it. */
const doneToasts: Readonly<Record<string, string>> = { "kernel.restart": "Kernel restarted" };

const has = (command: AnyCommand, key: string) => key in command.input.shape;

/** The page's own argument of `kernel.restart`: the user answered the confirm, never sent. */
const consentKey = "consent";

/** The arguments the page supplies for `command` when the caller did not; the page's own argument left out. */
function filled(
  command: AnyCommand,
  given: Args,
  page: { notebook: string; cell: string | null },
): Args {
  const args = Object.fromEntries(Object.entries(given).filter(([key]) => key !== consentKey));
  return {
    ...(has(command, "notebook") ? { notebook: page.notebook } : {}),
    ...(has(command, "cell") && page.cell !== null ? { cell: page.cell } : {}),
    // the page never blocks on a run: its progress arrives as events
    ...(has(command, "wait") ? { wait: false } : {}),
    ...args,
  };
}

type Notebook = ReturnType<typeof useNotebookStore>;

/** cell.delete through the store, so it can be undone: D D on a marked range deletes all of it; a cell
 * the caller named is that cell alone. */
function deleteThroughStore(
  notebook: Notebook,
  ui: ReturnType<typeof useUiStore>,
  args: Args | undefined,
  cell: string,
) {
  const marked = args?.cell === undefined ? notebook.markedCells : [];
  const ids = marked.length <= 1 ? [cell] : marked.map((each) => each.id);
  // the selection moves to the neighbour now, not once the daemon's answer arrives: a key pressed meanwhile (D D then
  // X) acts on the cell the user sees selected, never on the one going away ("Cell not found")
  if (ui.selected !== null && ids.includes(ui.selected)) {
    const order = notebook.cellsInOrder.map((each) => each.id);
    const kept = new Set(order.filter((id) => !ids.includes(id)));
    ui.follow(neighbourOf(order, kept, ui.selected));
  }
  if (ids.length === 1) return notebook.remove(notebook.cellsInOrder, cell);
  return notebook.removeAll(notebook.cellsInOrder, ids);
}

/** Restarting while a cell runs asks first (Confirm); the confirm sends it again, answered. Restart all
 * also resets the page, so a running client cell asks too. True when the confirm was opened instead of the restart. */
function askedToRestart(
  notebook: Notebook,
  ui: ReturnType<typeof useUiStore>,
  args: Args | undefined,
  all: boolean,
): boolean {
  const client = all
    ? (notebook.cellsInOrder.find((cell) => cell.type === "client" && cell.status === "running")
        ?.id ?? null)
    : null;
  const running = notebook.runningCell ?? client;
  if (running === null || consented(args)) return false;
  ui.overlay = { kind: "confirmRestart", running, all };
  return true;
}

/** Sends `command` with `data`; a failure is reported as the stores report theirs and answers undefined. */
function caller(
  session: ReturnType<typeof useSessionStore>,
  ui: ReturnType<typeof useUiStore>,
  report: ReturnType<typeof usePageReport>,
) {
  return async (command: AnyCommand, data: Readonly<Record<string, unknown>>) => {
    try {
      const answer = await session.session().client.call(command, data);
      const done = doneToasts[command.name];
      if (done !== undefined) ui.toast({ kind: "success", title: done });
      return answer;
    } catch (error) {
      report(error);
      return undefined;
    }
  };
}

/** Every public registry command as a page command. */
export function registryCommands(): readonly Command[] {
  const session = useSessionStore();
  const ui = useUiStore();
  const notebook = useNotebookStore();
  const report = usePageReport();
  const page = () => ({ notebook: session.session().notebook, cell: ui.selected });
  const parse = (command: AnyCommand, args: Args = {}) =>
    command.input.safeParse(filled(command, args, page()));
  const call = caller(session, ui, report);

  return publicCommands().map((command): Command => ({
    id: command.name,
    title: registryTitles[command.name] ?? titleOf(command.name),
    source: "registry",
    writes: command.tags.mutating || command.tags.destructive,
    when: (args) =>
      !command.tags.planned && session.current !== null && parse(command, args).success,
    run: async (args) => {
      const parsed = parse(command, args);
      if (!parsed.success) return undefined;
      const { data } = parsed;
      if (command.name === "cell.delete" && typeof data.cell === "string") {
        return deleteThroughStore(notebook, ui, args, data.cell);
      }
      if (
        command.name === "kernel.restart" &&
        askedToRestart(notebook, ui, args, data.all === true)
      )
        return undefined;
      return call(command, data);
    },
  }));
}
