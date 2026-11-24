// A notebook in a test daemon (03-api §4.2, §4.3): created, with cells added and run through the daemon's client, the
// decoded value of a run, and waits on a run's status through the event recorder (09-testing §1: no sleeps).
import type { CellType, ExecStatus, Execution } from "@jsnb/core";
import { decode } from "@jsnb/core";
import type { Daemon } from "./daemon.js";

/** The decoded first value output of a run. */
export const valueOf = (execution: Execution | null | undefined): unknown => {
  const output = execution?.outputs.find((each) => each.kind === "value");
  return output?.kind === "value" ? decode(output.json) : undefined;
};

export type TestNotebook = {
  readonly notebook: string;
  /** Adds a cell (server by default) and answers its id. */
  readonly add: (source: string, type?: CellType) => Promise<string>;
  /** Adds a server cell with `run`, answering its id and its run. */
  readonly ran: (
    source: string,
  ) => Promise<{ readonly cell: string; readonly execution: Execution }>;
  /** cell.run without waiting: the queued run. */
  readonly start: (cell: string) => Promise<Execution>;
  /** Resolves once the run `execution` reached `status`. */
  readonly reaches: (execution: string, status: ExecStatus) => Promise<void>;
  /** Resolves once a run of `cell` reached `status`. */
  readonly cellReaches: (cell: string, status: ExecStatus) => Promise<void>;
};

/** Creates `notebook` in the daemon's workspace. */
export async function createNotebook(daemon: Daemon, notebook = "a.jsnb"): Promise<TestNotebook> {
  const { client, events } = daemon;
  await client.notebook.create({ path: notebook });
  return {
    notebook,
    add: async (source, type = "server") =>
      (await client.cell.add({ notebook, type, source })).cell.id,
    ran: async (source) => {
      const added = await client.cell.add({ notebook, type: "server", source, run: true });
      if (!added.execution) throw new Error("cell.add with run answered no execution");
      return { cell: added.cell.id, execution: added.execution };
    },
    start: async (cell) => (await client.cell.run({ notebook, cell, wait: false })).execution,
    reaches: async (execution, status) => {
      await events.until(
        "cell.status",
        (e) => e.data.execution === execution && e.data.status === status,
      );
    },
    cellReaches: async (cell, status) => {
      await events.until("cell.status", (e) => e.data.cell === cell && e.data.status === status);
    },
  };
}
