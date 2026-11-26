// The daemon harness: the real daemon in-process on port 0 over a test's workspace, with the kernel child
// from source, a user config folder inside the workspace, seeded ids, a typed WebSocket client subscribed to every event
// (the recorder's `until`), HTTP and extra socket clients on demand, and stop(), also run when the test ends.
// The caller hands it the server's startServer, so this package never depends on @jsnb/server: the server's own tests
// use the harness too, and a dependency would close a cycle. @jsnb/test-daemon binds it for the other packages; the
// server binds it in its src/fixtures/daemon.ts.
import type {
  Client,
  ClientKind,
  OpenSocket,
  SocketClient,
  SocketOptions,
  ValueRef,
} from "@jsnb/client";
import { connectSocket, createHttpClient, downloadValue } from "@jsnb/client";
import { onTestFinished } from "vitest";

import type { Ids } from "./ids.js";
import { createIds } from "./ids.js";
import type { EventRecorder } from "./recorder.js";
import { recorder } from "./recorder.js";
import { kernelEntry } from "./kernel.js";
import type { Workspace, WorkspaceOptions } from "./workspace.js";
import { beforeRemoval, withWorkspace, writeWorkspaceFiles } from "./workspace.js";

/** How a test client declares itself. */
export type Declaration = { readonly client?: ClientKind; readonly agent?: string };

/** A socket client's declaration and, for a test of reconnects, its socket and backoff. */
export type SocketDeclaration = Declaration &
  Partial<Pick<SocketOptions, "openSocket" | "reconnect">>;

/** The server options the harness sets itself; the test's DaemonOptions go over them. */
export type HarnessDefaults = {
  readonly workspace: string;
  readonly port: number;
  readonly userConfigDir: string;
  readonly kernelEntry: typeof kernelEntry;
  readonly ids: Ids;
};

/** What the harness uses of a running server. */
export type ServerHandle = {
  readonly url: string;
  readonly token: string;
  readonly stop: () => Promise<void>;
};

/** A test's options: the server's own `Options` but its workspace, the declaration, the id seed, and the files written
 * into the workspace before the daemon starts. */
export type DaemonOptions<Options> = Partial<Omit<Options, "workspace">> &
  Declaration & {
    /** The seed of the id generator; default 1. */
    readonly seed?: number;
    readonly files?: WorkspaceOptions;
  };

/** The server options of a test's DaemonOptions, without the harness's own keys. */
export type ServerPart<Options> = Omit<
  DaemonOptions<Options>,
  keyof Declaration | "seed" | "files"
>;

/** Starts the server with the test's options over the harness's defaults: `startServer({ ...defaults, ...options })`. */
export type StartServer<Options, Running extends ServerHandle> = (
  defaults: HarnessDefaults,
  options: ServerPart<Options>,
) => Promise<Running>;

export type Daemon<Running extends ServerHandle> = {
  readonly server: Running;
  readonly url: string;
  readonly token: string;
  /** A WebSocket client (declared as the options say, `cli` by default) subscribed to the workspace's events. */
  readonly client: SocketClient;
  readonly events: EventRecorder;
  /** A one-shot HTTP client, declared as given. */
  readonly http: (declaration?: Declaration) => Client;
  /** The full-value download through the client (`cli`), its streaming Response. */
  readonly download: (ref: ValueRef) => Promise<Response>;
  /** Another WebSocket client, closed at stop. */
  readonly socket: (declaration?: SocketDeclaration) => SocketClient;
  /** Closes the clients and stops the daemon; idempotent. */
  readonly stop: () => Promise<void>;
};

const withAgent = (agent: string | undefined): { readonly agent?: string } =>
  agent === undefined ? {} : { agent };

/** Socket and HTTP clients of one daemon, each declared as asked (`cli` by default); the sockets close at stop. */
function clientsOf(running: { readonly url: string; readonly token: string }) {
  const base = { url: running.url, token: running.token };
  const sockets: SocketClient[] = [];
  const declared = (declaration: Declaration) => ({
    ...base,
    client: declaration.client ?? "cli",
    ...withAgent(declaration.agent),
  });
  return {
    socket: (declaration: SocketDeclaration = {}): SocketClient => {
      const { openSocket, reconnect } = declaration;
      const opened = connectSocket({
        ...declared(declaration),
        ...(openSocket === undefined ? {} : { openSocket }),
        ...(reconnect === undefined ? {} : { reconnect }),
      });
      sockets.push(opened);
      return opened;
    },
    http: (declaration: Declaration = {}): Client => createHttpClient(declared(declaration)),
    closeAll: () => {
      for (const opened of sockets) opened.close();
    },
  };
}

/** The clients of a running daemon: a socket subscribed to the workspace's events, HTTP and more sockets on demand. */
export type Connected = Pick<
  Daemon<ServerHandle>,
  "client" | "events" | "http" | "download" | "socket"
> & {
  /** Closes every socket. */
  readonly close: () => void;
};

/** Connects to the daemon at `url` with `token` (one in-process, or a process started from the built dist/main.js). */
export async function connectDaemon(
  daemon: { readonly url: string; readonly token: string },
  declaration: Declaration = {},
): Promise<Connected> {
  const { url, token } = daemon;
  const clients = clientsOf(daemon);
  const events = recorder();
  const client = clients.socket({
    client: declaration.client ?? "cli",
    ...withAgent(declaration.agent),
  });
  const ignore = (): undefined => undefined; // the recorder's tests read events; gaps and errors fail them there
  await client.subscribeWorkspace({ onEvent: events.push, onGap: ignore, onError: ignore });
  return {
    client,
    events,
    http: clients.http,
    download: (ref) => downloadValue({ url, token, client: "cli" }, ref),
    socket: clients.socket,
    close: clients.closeAll,
  };
}

/** A socket opener whose live socket a test can drop, to watch the client reconnect and resync. */
export function droppableSocket(): { readonly openSocket: OpenSocket; readonly drop: () => void } {
  let current: WebSocket | undefined;
  const openSocket: OpenSocket = (url, events) => {
    const socket = new WebSocket(url);
    current = socket;
    socket.addEventListener("open", () => {
      events.open();
    });
    socket.addEventListener("message", (event) => {
      events.message(event.data);
    });
    socket.addEventListener("close", (event) => {
      events.close(event.code);
    });
    return {
      send: (text) => {
        socket.send(text);
      },
      close: (code) => {
        socket.close(code);
      },
    };
  };
  return {
    openSocket,
    drop: () => {
      current?.close(4000);
    },
  };
}

/** Starts the daemon over `ws`; it stops when the test ends if the test did not stop it. */
async function launch<Options, Running extends ServerHandle>(
  startServer: StartServer<Options, Running>,
  ws: Workspace,
  options: DaemonOptions<Options>,
): Promise<Daemon<Running>> {
  const { client: kind = "cli", agent, seed = 1, files = {}, ...server } = options;
  await writeWorkspaceFiles(ws, files);
  const defaults = { workspace: ws.dir, port: 0, userConfigDir: ws.path(".user-config") };
  const running = await startServer({ ...defaults, kernelEntry, ids: createIds(seed) }, server);
  const connected = await connectDaemon(running, { client: kind, ...withAgent(agent) });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      connected.close();
      await running.stop();
    })());
  onTestFinished(stop);
  beforeRemoval(ws.dir, stop); // and before its folder is removed, whichever comes first
  const { client, events, http, download, socket } = connected;
  return {
    server: running,
    url: running.url,
    token: running.token,
    client,
    events,
    http,
    download,
    socket,
    stop,
  };
}

/** startDaemon and withDaemon over the given start, which calls @jsnb/server's startServer. */
export function daemonHarness<Options, Running extends ServerHandle>(
  startServer: StartServer<Options, Running>,
) {
  return {
    /** Starts the daemon over `ws`; it stops when the test ends if the test did not stop it. */
    startDaemon: (ws: Workspace, options: DaemonOptions<Options> = {}): Promise<Daemon<Running>> =>
      launch(startServer, ws, options),
    /** Runs `fn` with a daemon over a fresh workspace, both gone afterwards. */
    withDaemon: <T>(
      fn: (daemon: Daemon<Running>, ws: Workspace) => Promise<T>,
      options: DaemonOptions<Options> = {},
    ): Promise<T> =>
      withWorkspace(async (ws) => {
        const daemon = await launch(startServer, ws, options);
        try {
          return await fn(daemon, ws);
        } finally {
          await daemon.stop();
        }
      }),
  };
}
