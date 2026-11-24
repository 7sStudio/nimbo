// The daemon harness of @jsnb/test-tools/daemon (09-testing §8) bound to @jsnb/server's startServer, for the tests of
// the packages that drive a real daemon (ui, cli, mcp). The server's own tests bind it in its src/fixtures/daemon.ts:
// this package depends on the server, so the server cannot depend on it.
import type { RunningServer, ServerOptions } from "@jsnb/server";
import { startServer } from "@jsnb/server";
import type { Daemon as DaemonOf, DaemonOptions as DaemonOptionsOf } from "@jsnb/test-tools/daemon";
import { daemonHarness } from "@jsnb/test-tools/daemon";

export type { Connected, Declaration, SocketDeclaration } from "@jsnb/test-tools/daemon";
export { connectDaemon, droppableSocket } from "@jsnb/test-tools/daemon";

export type Daemon = DaemonOf<RunningServer>;
export type DaemonOptions = DaemonOptionsOf<ServerOptions>;

export const { startDaemon, withDaemon } = daemonHarness<ServerOptions, RunningServer>(
  (defaults, options) => startServer({ ...defaults, ...options }),
);
