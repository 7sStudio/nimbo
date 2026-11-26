// The client over a WebSocket, what the UI and the MCP server keep open: the generated methods, `call`,
// the connection status, the daemon's requests to the page, event subscriptions and close.
import type { Client } from "../call/client.js";
import { createCaller } from "../call/caller.js";
import type { EventFeed, Subscription } from "../events/lifecycle.js";
import type { NotebookSubscriptionOptions } from "../events/notebook.js";
import { subscribeNotebook } from "../events/notebook.js";
import type { WorkspaceSubscriptionOptions } from "../events/workspace.js";
import { subscribeWorkspace } from "../events/workspace.js";
import { bindCommands } from "../generated.js";
import type { SocketOptions } from "./connection.js";
import { SocketConnection } from "./connection.js";
import type { ServerRequestHandler, ServerRequestMethod } from "./requests.js";
import type { ConnectionStatus } from "./status.js";

export type SocketClient = Client & {
  readonly status: () => ConnectionStatus;
  /** Called on every status change; returns its removal. */
  readonly onStatus: (listener: (status: ConnectionStatus) => void) => () => void;
  /** Answers the daemon's requests of one method on this connection, across reconnects; returns its removal. */
  readonly handle: <M extends ServerRequestMethod>(
    method: M,
    respond: ServerRequestHandler<M>,
  ) => () => void;
  /** A notebook's state, then its events in seq order, resynced on gaps and reconnects. */
  readonly subscribeNotebook: (options: NotebookSubscriptionOptions) => Promise<Subscription>;
  /** Every notebook's events as they arrive, with gaps reported. */
  readonly subscribeWorkspace: (options: WorkspaceSubscriptionOptions) => Promise<Subscription>;
  /** Closes for good; pending and later calls fail with ConnectionClosed. */
  readonly close: () => void;
};

/** Opens a connection at once; calls made before it is live wait for it. */
export function connectSocket(options: SocketOptions): SocketClient {
  const connection = new SocketConnection(options);
  const call = createCaller((outgoing) => connection.request(outgoing));
  const feed: EventFeed = {
    call,
    status: () => connection.status,
    closeReason: () => connection.closeReason,
    onStatus: (listener) => connection.onStatus(listener),
    onEvent: (listener) => connection.onEvent(listener),
    report: (error) => {
      connection.report(error);
    },
  };
  return {
    ...bindCommands(call),
    call,
    status: feed.status,
    onStatus: feed.onStatus,
    handle: (method, respond) => connection.handle(method, respond),
    subscribeNotebook: (subscription) => subscribeNotebook(feed, subscription),
    subscribeWorkspace: (subscription) => subscribeWorkspace(feed, subscription),
    close: () => {
      connection.close();
    },
  };
}
