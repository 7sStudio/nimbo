// Public API of @jsnb/client: the typed client generated from the registry over HTTP or a WebSocket, with retries,
// reconnects, event subscriptions, the full-value download and the client's own errors (02-architecture §2).

// clients
export { createHttpClient } from "./http/client.js";
export { connectSocket } from "./socket/client.js";
export type { Client } from "./call/client.js";
export type { SocketClient } from "./socket/client.js";
export type { Commands } from "./generated.js";
export type { Caller, CallOptions } from "./call/caller.js";
export { openingClosed } from "./call/opening.js";

// options
export type { ClientKind, DaemonOptions } from "./daemon/address.js";
export type { HttpOptions, RetryNotice } from "./http/options.js";
export type { SocketOptions } from "./socket/connection.js";
export type { ConnectionStatus } from "./socket/status.js";
export type { OpenSocket, SocketEvents, SocketLike } from "./socket/socketLike.js";
export type { Backoff } from "./retry/backoff.js";

// the daemon's requests to the page, events, the download
export type {
  ServerRequestHandler,
  ServerRequestMethod,
  ServerRequests,
} from "./socket/requests.js";
export type { Subscription } from "./events/lifecycle.js";
export type { NotebookSubscriptionOptions } from "./events/notebook.js";
export type { WorkspaceSubscriptionOptions } from "./events/workspace.js";
export type { SeqGap } from "./events/workspaceOrder.js";
export { downloadValue } from "./http/download.js";
export type { ValueRef } from "./http/download.js";

// errors (03-api §7.6); daemon errors are core's ApiError subclasses
export {
  CallAborted,
  ConnectionClosed,
  ConnectionDropped,
  DaemonUnreachable,
  InvalidResponse,
} from "./errors/transport.js";
export { SubscriberFailed } from "./errors/subscriber.js";
export type { SubscriberCallback } from "./errors/subscriber.js";
export type { ReportError } from "./errors/report.js";
export { protocolErrorNames, unrecognizedFailure } from "./rpc/wireError.js";
