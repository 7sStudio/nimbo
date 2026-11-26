// The routes suite's world: a daemon of its own (in-process, the real kernel child), a
// notebook, and the helpers a webhook test needs: a server cell run to ok, a raw request below the notebook's routes
// as a sender without the token makes it, kernel.routes, the routes.changed events and the `event` outputs a cell got.
import type { EventOf, Execution, Output, Route } from "@jsnb/core";
import { notebookName } from "@jsnb/core";
import type { Daemon, DaemonOptions } from "./daemon.js";
import { withDaemon } from "./daemon.js";
import type { Workspace, WorkspaceOptions } from "@jsnb/test-tools/workspace";

import type { TestNotebook } from "./notebook.js";
import { createNotebook } from "./notebook.js";
import type { RawAnswer, RawRequest } from "./raw.js";
import { rawHttp } from "./raw.js";

type EventOutput = Extract<Output, { kind: "event" }>;
type Changed = EventOf<"routes.changed">;

export type RoutesWorld = {
  readonly daemon: Daemon;
  readonly workspace: Workspace;
  readonly book: TestNotebook;
  readonly notebook: string;
  /** `/n/<name>`, the notebook's route base below the daemon's root. */
  readonly base: string;
  /** Adds a server cell, runs it and answers its id once its run ended ok. */
  readonly cell: (source: string) => Promise<string>;
  /** Runs `cell` again, waiting for its terminal status. */
  readonly rerun: (cell: string) => Promise<Execution>;
  /** One raw request to `base` + `path`, without the token, exactly as given. */
  readonly send: (path: string, init?: Omit<RawRequest, "path">) => Promise<RawAnswer>;
  readonly routes: () => Promise<readonly Route[]>;
  /** The routes.changed events received so far, oldest first. */
  readonly changes: () => readonly Changed[];
  /**
   * The first routes.changed whose routes `accept` accepts, received before or after the call, among those after the
   * first `since` (a count `changes().length` took before the step that should cause it).
   */
  readonly changed: (
    accept: (routes: readonly Route[]) => boolean,
    since?: number,
  ) => Promise<Changed>;
  /** The `event` outputs of `cell` once `count` of them arrived, oldest first. */
  readonly eventsOn: (cell: string, count: number) => Promise<readonly EventOutput[]>;
};

type Options = DaemonOptions & {
  readonly files?: WorkspaceOptions;
  /** The notebook's ref; `hooks.jsnb` by default. */
  readonly notebook?: string;
};

/** The `event` outputs the daemon reported for `cell`. */
function eventOutputs(daemon: Daemon, cell: string): EventOutput[] {
  return daemon.events.all().flatMap((event) => {
    if (event.type !== "cell.output" || event.data.cell !== cell) return [];
    const { output } = event.data;
    return output.kind === "event" ? [output] : [];
  });
}

/** The helpers over a notebook of `daemon`. */
function worldOf(daemon: Daemon, workspace: Workspace, book: TestNotebook): RoutesWorld {
  const { notebook } = book;
  const base = `/n/${notebookName(notebook)}`;
  const isChanged = (event: { readonly type: string }): event is Changed =>
    event.type === "routes.changed";
  const rerun = async (cell: string) =>
    (await daemon.client.cell.run({ notebook, cell })).execution;
  return {
    daemon,
    workspace,
    book,
    notebook,
    base,
    rerun,
    cell: async (source) => {
      const { cell, execution } = await book.ran(source);
      if (execution.status !== "ok") throw new Error(`the cell ended ${execution.status}`);
      return cell;
    },
    send: (path, init = {}) => rawHttp(daemon.server.port, { ...init, path: `${base}${path}` }),
    routes: async () => (await daemon.client.kernel.routes({ notebook })).routes,
    changes: () => daemon.events.all().filter(isChanged),
    changed: (accept, since = 0) => {
      const after = (event: Changed) =>
        daemon.events.all().filter(isChanged).indexOf(event) >= since;
      return daemon.events.until(
        "routes.changed",
        (event) => after(event) && accept(event.data.routes),
      );
    },
    eventsOn: async (cell, count) => {
      await daemon.events.until("cell.output", () => eventOutputs(daemon, cell).length >= count);
      return eventOutputs(daemon, cell);
    },
  };
}

/** Runs `test` in a world of its own: a daemon over a fresh workspace and one open notebook. */
export function withRoutes(
  test: (world: RoutesWorld) => Promise<void>,
  options: Options = {},
): Promise<void> {
  const { notebook = "hooks.jsnb", ...daemonOptions } = options;
  return withDaemon(async (daemon, workspace) => {
    const book = await createNotebook(daemon, notebook);
    await test(worldOf(daemon, workspace, book));
  }, daemonOptions);
}
