// js-debug attached to a kernel's inspector as a second client beside the daemon's own session: the parent DAP session
// attaches by websocketAddress, js-debug answers with a startDebugging reverse request for the target, and the child
// session on a second connection is the one that pauses, steps and reads. Worker threads (the kernel's watchdog) are
// never attached.
import type { DebugProtocol } from "@vscode/debugprotocol";
import { ownCodeDirectories } from "@jsnb/kernel-node";

import type { Adapter } from "./adapter.js";
import { dap } from "./protocol.js";
import type { DapConnection } from "./dap.js";
import { DapFailed } from "./dap.js";
import { StartDebugging } from "./protocol.js";

export type Attached = {
  readonly url: string;
  readonly parent: DapConnection;
  readonly child: DapConnection;
};

const initialize: DebugProtocol.InitializeRequestArguments = {
  clientID: "nimbo",
  clientName: "nimbo",
  adapterID: "pwa-node",
  linesStartAt1: true,
  columnsStartAt1: true,
  pathFormat: "path",
  supportsVariableType: true,
  supportsStartDebuggingRequest: true,
};

/** The attach configuration: each setting is needed (a breakpoint in a cell that runs at once binds only with
 * pauseForSourceMap; autoAttachChildProcesses would rewrite the kernel's NODE_OPTIONS; the kernel's own code and Node's
 * are skipped when stepping). */
function attachConfig(url: string, cwd: string): Readonly<Record<string, unknown>> {
  return {
    type: "pwa-node",
    request: "attach",
    name: "nimbo kernel",
    websocketAddress: url,
    cwd,
    sourceMaps: true,
    pauseForSourceMap: true,
    autoAttachChildProcesses: false,
    showAsyncStacks: true,
    skipFiles: [...ownCodeDirectories.map((dir) => `${dir}**`), "<node_internals>/**"],
  };
}

const childTimeoutMs = 10_000;

/** The configuration js-debug's startDebugging asks the child session to attach with. */
const childConfigOf = (args: unknown): Readonly<Record<string, unknown>> | undefined =>
  StartDebugging.safeParse(args).data?.configuration;

/** The parent session's attach, resolved with the child's configuration. */
async function attachParent(
  parent: DapConnection,
  url: string,
  cwd: string,
): Promise<Readonly<Record<string, unknown>>> {
  let found: (config: Readonly<Record<string, unknown>>) => void = () => undefined;
  const child = new Promise<Readonly<Record<string, unknown>>>((resolve, reject) => {
    found = resolve;
    setTimeout(() => {
      reject(new DapFailed("attach", "js-debug found no target at the kernel's inspector"));
    }, childTimeoutMs).unref();
  });
  parent.onReverse((command, args) => {
    const config = command === "startDebugging" ? childConfigOf(args) : undefined;
    if (config) found(config);
    return Promise.resolve({});
  });
  parent.onEvent((event) => {
    if (event.event === "initialized")
      void dap.configurationDone(parent, {}).catch(() => undefined);
  });
  await dap.initialize(parent, initialize);
  const attached = dap.attach(parent, attachConfig(url, cwd));
  const config = await child;
  await attached;
  return config;
}

/**
 * Attaches js-debug to the inspector at `url`; `configure` sends the breakpoints on the child session before its
 * configurationDone, so a run that follows hits them. `onEvent` hears the child's events from the start.
 */
export async function attachJsDebug(
  adapter: Adapter,
  options: {
    readonly url: string;
    readonly cwd: string;
    readonly onEvent: (child: DapConnection, event: { event: string; body: unknown }) => void;
    readonly configure: (child: DapConnection) => Promise<void>;
  },
): Promise<Attached> {
  const parent = await adapter.connect();
  let child: DapConnection | undefined;
  try {
    const config = await attachParent(parent, options.url, options.cwd);
    const own = await adapter.connect();
    child = own;
    own.onReverse(() => Promise.resolve({}));
    const initialized = new Promise<void>((resolve) => {
      own.onEvent((event) => {
        if (event.event === "initialized") resolve();
        options.onEvent(own, event);
      });
    });
    await dap.initialize(own, initialize);
    const attached = dap.attach(own, config);
    await initialized;
    await options.configure(own);
    await dap.configurationDone(own, {});
    await attached;
    return { url: options.url, parent, child: own };
  } catch (error) {
    child?.close();
    parent.close();
    throw error;
  }
}

/** Ends both sessions, not waiting long for an answer js-debug may never send: the kernel goes on. */
export async function detachJsDebug(attached: Attached): Promise<void> {
  const quietly = (connection: DapConnection) =>
    Promise.race([
      dap.disconnect(connection, { terminateDebuggee: false }, 1_000).catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 150)),
    ]).finally(() => {
      connection.close();
    });
  await Promise.all([quietly(attached.child), quietly(attached.parent)]);
}
