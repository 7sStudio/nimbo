// Routes one frame from the daemon (03-api §7.2): answers settle pending calls, `event` notifications reach the
// listeners, the daemon's requests are answered on the socket they came on, unreadable frames get a JSON-RPC error.
import type { ReportError } from "../errors/report.js";
import { notifyAll } from "../errors/report.js";
import { InvalidResponse } from "../errors/transport.js";
import type { Incoming } from "../rpc/frames.js";
import { readFrame, writeError } from "../rpc/frames.js";
import { toApiError } from "../rpc/wireError.js";
import type { PendingCalls } from "./pending.js";
import type { RequestHandlers } from "./requests.js";
import type { SocketLike } from "./socketLike.js";

/** Where a frame can go. */
export type Routes = {
  readonly socket: SocketLike;
  readonly pending: PendingCalls;
  readonly requests: RequestHandlers;
  readonly events: ReadonlySet<(params: unknown) => void>;
  /** Whether `socket` is still the connection's, when an answer to the daemon is ready. */
  readonly isCurrent: () => boolean;
  /** Where a throwing event listener's error goes; the other listeners still run. */
  readonly report: ReportError;
};

type Request = Extract<Incoming, { readonly kind: "request" }>;

async function answer(routes: Routes, request: Request): Promise<void> {
  const frame = await routes.requests.answer(request.id, request.method, request.params);
  // The daemon forgets the requests of a socket that dropped; an answer to one has nowhere to go.
  if (routes.isCurrent()) routes.socket.send(frame);
}

type Answer = Extract<Incoming, { readonly kind: "result" | "error" | "badAnswer" }>;

/** Settles the call an answer names; an answer no call waits for (to an aborted call) is dropped. */
function settle(answer: Answer, pending: PendingCalls): void {
  const call = pending.take(answer.id);
  if (!call) return;
  if (answer.kind === "result") call.resolve(answer.result);
  else if (answer.kind === "error") call.reject(toApiError(answer.error));
  else call.reject(new InvalidResponse({ method: call.method, issues: answer.issues }));
}

function route(frame: Incoming, routes: Routes): void {
  switch (frame.kind) {
    case "notification":
      if (frame.method === "event") notifyAll(routes.events, frame.params, routes.report);
      return;
    case "request":
      void answer(routes, frame); // answer() never rejects: a handler's failure becomes the error frame
      return;
    case "invalid":
      routes.socket.send(
        writeError(frame.id, {
          code: frame.code,
          message: "Unreadable frame.",
          data: { issues: frame.issues },
        }),
      );
      return;
    default:
      settle(frame, routes.pending);
  }
}

/**
 * Routes one message from the daemon; a notification other than `event` is dropped, since JSON-RPC never answers one.
 */
export function dispatch(frame: unknown, routes: Routes): void {
  if (typeof frame !== "string") {
    routes.socket.send(
      writeError(null, { code: -32700, message: "Only text frames carry JSON-RPC." }),
    );
    return;
  }
  route(readFrame(frame), routes);
}
