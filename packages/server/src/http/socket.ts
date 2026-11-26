// One WebSocket connection: concurrent calls answered by id, a notification carried out unanswered,
// event notifications sent, the page's answers to the daemon's own requests matched (pageRequests.ts), a frame that is
// no message answered -32700 or -32600; when the socket closes its pending requests fail.
import type { WebSocket } from "ws";

import type { Declaration, Peer } from "../commands/context.js";
import type { Dispatch } from "../commands/dispatch.js";
import type { Log } from "../events/log.js";
import type { Incoming, RpcId } from "./frames.js";
import { readIncoming, writeAnswer, writeError } from "./frames.js";
import type { Pending } from "./pageRequests.js";
import { createPeer, failPending, send, settle } from "./pageRequests.js";

export type SocketOptions = {
  readonly dispatch: Dispatch;
  readonly log: Log;
  readonly declaration: Declaration;
  /** Hands each call under way to the server, whose stop answers it before closing the socket. */
  readonly track: (work: Promise<void>) => void;
};

type Connection = {
  readonly ws: WebSocket;
  readonly options: SocketOptions;
  readonly peer: Peer;
  readonly pending: Map<RpcId, Pending>;
};

/** Runs a call or a notification; resolves with its answer and the tasks to run once it is answered. */
async function run(connection: Connection, method: string, params: unknown) {
  const tasks: (() => void)[] = [];
  const context = {
    declaration: connection.options.declaration,
    peer: connection.peer,
    afterAnswer: (task: () => void) => tasks.push(task),
  };
  const answer = await connection.options.dispatch(method, params, context);
  const after = (): void => {
    for (const task of tasks) task();
  };
  return { answer, after };
}

async function answerCall(
  connection: Connection,
  frame: Extract<Incoming, { kind: "call" }>,
): Promise<void> {
  const { answer, after } = await run(connection, frame.method, frame.params);
  send(connection.ws, writeAnswer(frame.id, answer), after);
}

/** A notification: carried out, never answered (JSON-RPC 2.0 §4.1); a failure is logged. */
async function runNotification(
  connection: Connection,
  frame: Extract<Incoming, { kind: "notification" }>,
): Promise<void> {
  const { answer, after } = await run(connection, frame.method, frame.params);
  if (!answer.ok) {
    connection.options.log.warn(
      { method: frame.method, error: answer.error },
      "a notification failed",
    );
  }
  after();
}

function receive(connection: Connection, text: string): void {
  const frame = readIncoming(text);
  switch (frame.kind) {
    case "call":
      connection.options.track(answerCall(connection, frame)); // the dispatcher never rejects: a failure is its answer
      return;
    case "notification":
      connection.options.track(runNotification(connection, frame)); // as answerCall: the dispatcher never rejects
      return;
    case "answer":
      settle(connection.pending, connection.options.log, frame.id, { result: frame.result });
      return;
    case "failure":
      settle(connection.pending, connection.options.log, frame.id, { error: frame.error });
      return;
    case "invalid":
      send(connection.ws, writeError(frame.id, frame.error));
  }
}

/** A message's text, whatever shape ws hands it in. */
const textOf = (data: Buffer | ArrayBuffer | Buffer[]): string => {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.from(data).toString("utf8");
};

/** Serves one accepted socket until it closes. */
export function serveSocket(ws: WebSocket, options: SocketOptions): Peer {
  const controller = new AbortController();
  const pending = new Map<RpcId, Pending>();
  const peer = createPeer(ws, pending, controller.signal);
  const connection: Connection = { ws, options, peer, pending };
  ws.on("message", (data, isBinary) => {
    if (isBinary)
      send(ws, writeError(null, { code: -32700, message: "Binary frames are not JSON-RPC." }));
    else receive(connection, textOf(data));
  });
  ws.on("close", () => {
    controller.abort();
    failPending(pending);
  });
  return peer;
}
