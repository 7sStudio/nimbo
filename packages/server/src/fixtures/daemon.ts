// The daemon harness of @jsnb/test-tools/daemon bound to this package's own startServer, for the
// server's tests. The other packages take the same binding from @jsnb/test-daemon, which depends on the server and so
// cannot be one of its dependencies.
import type { Daemon as DaemonOf, DaemonOptions as DaemonOptionsOf } from "@jsnb/test-tools/daemon";
import { daemonHarness } from "@jsnb/test-tools/daemon";

import type { ServerOptions } from "../options.js";
import type { RunningServer } from "../server.js";
import { startServer } from "../server.js";

export type { Connected } from "@jsnb/test-tools/daemon";
export { connectDaemon, droppableSocket } from "@jsnb/test-tools/daemon";

export type Daemon = DaemonOf<RunningServer>;
export type DaemonOptions = DaemonOptionsOf<ServerOptions>;

export const { startDaemon, withDaemon } = daemonHarness<ServerOptions, RunningServer>(
  (defaults, options) => startServer({ ...defaults, ...options }),
);
