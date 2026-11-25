// The CLI's failures to reach its workspace's daemon (03-api §8, 07-file-format §6), each exit 3 but nothingToStop's
// line: none runs, its server.json cannot be read, it would not start, or the one server.json names serves another
// folder (a copied workspace).
import { JsnbError } from "@jsnb/core";

import type { Cause } from "./cli.js";

/** What `nimbo stop` and `nimbo workspace stop` say when no daemon runs: its aim holds already (exit 0). */
export const nothingToStop = (workspace: string): string =>
  `No daemon runs for ${workspace}; nothing to stop.\n`;

/** A command that does not start one found no daemon for the workspace (03-api §8; exit 3). */
export class DaemonNotRunning extends JsnbError {
  declare readonly data: { readonly workspace: string };
  constructor(data: { readonly workspace: string }, options: Cause = {}) {
    super({
      name: "DaemonNotRunning",
      message: `No nimbo daemon runs for ${data.workspace}. Start it with nimbo open or nimbo serve; commands that change something (not those that delete or stop) start it themselves.`,
      data,
      ...options,
    });
  }
}

/** `.jsnb/server.json` is there but cannot be read (another user's, a folder): no daemon can be reached (exit 3). */
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

/** The daemon a mutating command started ended before its listening line (exit 3). */
export class DaemonStartFailed extends JsnbError {
  declare readonly data: StartFailure;
  constructor(data: StartFailure, said?: string, options: Cause = {}) {
    super({ name: "DaemonStartFailed", message: startFailedMessage(data, said), data, ...options });
  }
}

/**
 * Where the server.json of a copied workspace leads: the folder the CLI is in, the one its daemon serves, and that
 * daemon's pid; `gone` when that folder no longer exists (it was moved or deleted while its daemon ran).
 */
export type ForeignData = {
  readonly workspace: string;
  readonly root: string;
  readonly serverFile: string;
  readonly pid: number;
  readonly gone: boolean;
};

const foreignMessage = (data: ForeignData): string => {
  const start = `a command that changes something, such as nimbo open <path>, starts ${data.workspace}'s own daemon`;
  return data.gone
    ? `The nimbo daemon that ${data.serverFile} names served ${data.root}, and the folder it served is gone: moved or deleted? That daemon still runs and stops by itself within a few seconds; nothing was sent to it. Try again then, or stop it now (kill ${String(data.pid)}; taskkill /PID ${String(data.pid)} on Windows); ${start}.`
    : `The nimbo daemon that ${data.serverFile} names serves ${data.root}, not ${data.workspace} (this folder is a copy of that one, or was moved here and a folder made again at its old path), so nothing was sent to it. A${start.slice(1)}.`;
};

/**
 * The daemon server.json names serves another folder: the workspace was copied with its `.jsnb/` while that daemon ran
 * (cp -R, Finder's Duplicate, rsync), or moved (the folder it served is gone, and the daemon stops by itself once it
 * sees so). A command that does not start a daemon sends it nothing (exit 3); one that changes something
 * starts the workspace's own (after the moved folder's daemon has stopped).
 */
export class DaemonForeign extends JsnbError {
  declare readonly data: ForeignData;
  constructor(data: ForeignData, options: Cause = {}) {
    super({ name: "DaemonForeign", message: foreignMessage(data), data, ...options });
  }
}

/** The daemon answered workspace.stop but its process had not ended 15 s later (a hook still running, exit 4). */
export class DaemonStillRunning extends JsnbError {
  declare readonly data: { readonly pid: number };
  constructor(data: { readonly pid: number }, options: Cause = {}) {
    super({
      name: "DaemonStillRunning",
      message: `The daemon was asked to stop but its process ${String(data.pid)} still runs after 15 s. Wait, or end it with kill ${String(data.pid)}.`,
      data,
      ...options,
    });
  }
}
