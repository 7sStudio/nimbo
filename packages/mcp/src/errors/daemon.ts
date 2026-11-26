// The MCP server's failures to reach its workspace's daemon (as the CLI's): none runs, its server.json
// cannot be read, it would not start, or the daemon server.json names serves another folder (a copied or moved
// workspace). Each reaches the agent as the tool's error result; the words name tools, not CLI commands.
import { JsnbError } from "@jsnb/core";

import type { Cause } from "./mcp.js";

/** What workspace_stop answers when no daemon runs: its aim holds already. */
export const nothingToStop = (workspace: string): string =>
  `No daemon runs for ${workspace}; nothing to stop.`;

/** A tool that does not start one found no daemon for the workspace. */
export class DaemonNotRunning extends JsnbError {
  declare readonly data: { readonly workspace: string };
  constructor(data: { readonly workspace: string }, options: Cause = {}) {
    super({
      name: "DaemonNotRunning",
      message: `No nimbo daemon runs for ${data.workspace}. Tools that change something (notebook_open, cell_add, …; not those that delete or stop) start it themselves.`,
      data,
      ...options,
    });
  }
}

/** `.jsnb/server.json` is there but cannot be read (another user's, a folder): no daemon can be reached. */
export class ServerFileUnreadable extends JsnbError {
  declare readonly data: { readonly path: string; readonly code: string };
  constructor(data: { readonly path: string; readonly code: string }, options: Cause = {}) {
    const owner =
      data.code === "EACCES" || data.code === "EPERM"
        ? " It may belong to another user (a daemon started with sudo): stop that daemon as its user, or remove the file."
        : " Remove it if no daemon runs here.";
    super({
      name: "ServerFileUnreadable",
      message: `${data.path} cannot be read (${data.code}).${owner}`,
      data,
      ...options,
    });
  }
}

/** What the daemon's entry said or did when it did not start: its error line, else how it ended. */
export type StartFailure = {
  readonly workspace: string;
  /** The daemon's error name (`WorkspaceUnusable`, …), or `DaemonExited` when it printed none. */
  readonly reason: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
};

const startFailedMessage = (data: StartFailure, said: string | undefined): string => {
  const how = data.signal === null ? `exit code ${String(data.exitCode)}` : `signal ${data.signal}`;
  return said === undefined
    ? `The nimbo daemon for ${data.workspace} ended (${how}) before it listened. Run nimbo serve there to see why.`
    : `The nimbo daemon for ${data.workspace} did not start: ${said}`;
};

/** What a start that stayed silent past the guard says (DaemonSilent), the daemon having said nothing. */
export const silentStart = (seconds: number): string =>
  `it did not listen within ${String(seconds)} s, so the MCP server stopped it. Run nimbo serve there to see why.`;

/** The daemon a mutating tool started ended before its listening line. */
export class DaemonStartFailed extends JsnbError {
  declare readonly data: StartFailure;
  constructor(data: StartFailure, said?: string, options: Cause = {}) {
    super({ name: "DaemonStartFailed", message: startFailedMessage(data, said), data, ...options });
  }
}

/**
 * Where the server.json of a copied workspace leads: the folder the MCP server is in, the one its daemon serves, and
 * that daemon's pid; `gone` when that folder no longer exists (it was moved or deleted while its daemon ran).
 */
export type ForeignData = {
  readonly workspace: string;
  readonly root: string;
  readonly serverFile: string;
  readonly pid: number;
  readonly gone: boolean;
};

const foreignMessage = (data: ForeignData): string => {
  const start = `a tool that changes something, such as notebook_open, starts ${data.workspace}'s own daemon`;
  return data.gone
    ? `The nimbo daemon that ${data.serverFile} names served ${data.root}, and the folder it served is gone: moved or deleted? That daemon still runs and stops by itself within a few seconds; nothing was sent to it. Try again then, or stop it now (kill ${String(data.pid)}; taskkill /PID ${String(data.pid)} on Windows); ${start}.`
    : `The nimbo daemon that ${data.serverFile} names serves ${data.root}, not ${data.workspace} (this folder is a copy of that one, or was moved here and a folder made again at its old path), so nothing was sent to it. A${start.slice(1)}.`;
};

/**
 * The daemon server.json names serves another folder: the workspace was copied with its `.jsnb/`
 * while that daemon ran, or moved. A tool that does not start a daemon sends it nothing; one that changes something
 * starts the workspace's own (after the moved folder's daemon has stopped).
 */
export class DaemonForeign extends JsnbError {
  declare readonly data: ForeignData;
  constructor(data: ForeignData, options: Cause = {}) {
    super({ name: "DaemonForeign", message: foreignMessage(data), data, ...options });
  }
}

/** server.json names a live daemon of the workspace that does not answer (stopped or hung): workspace_stop leaves it. */
export class DaemonUnresponsive extends JsnbError {
  declare readonly data: { readonly workspace: string; readonly pid: number };
  constructor(data: { readonly workspace: string; readonly pid: number }) {
    super({
      name: "DaemonUnresponsive",
      message: `The nimbo daemon for ${data.workspace} (pid ${String(data.pid)}) runs but does not answer (stopped or hung). Run nimbo stop --force there to end it; its unsaved edits are lost.`,
      data,
    });
  }
}
