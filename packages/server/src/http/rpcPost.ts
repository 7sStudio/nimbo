// `POST /rpc` of 03-api §7.3: one JSON-RPC call per request, `Authorization: Bearer <token>` (401 without it), the
// connection declared by `X-Jsnb-Client` / `X-Jsnb-Agent`; the answer is a JSON-RPC body with status 200. A
// notification (no id) is carried out and answered 204 with no body, its failure logged (JSON-RPC 2.0 §4.1).
import type { IncomingMessage, ServerResponse } from "node:http";

import type { CallContext } from "../commands/context.js";
import type { Dispatch } from "../commands/dispatch.js";
import type { Log } from "../events/log.js";
import { bearerOf, isToken } from "./auth.js";
import { declarationOf, headerValue } from "./declaration.js";
import type { Incoming } from "./frames.js";
import { readIncoming, writeAnswer, writeError } from "./frames.js";
import { readBody, sendJson, sendStatus, sendUnauthorized } from "./respond.js";

export type RpcPostOptions = {
  readonly token: string;
  readonly dispatch: Dispatch;
  readonly log: Log;
};

type Call = Extract<Incoming, { kind: "call" | "notification" }>;

/** The call a request carries, or undefined once the refusal (405, 401, 413, -32700, -32600) was sent. */
async function callOf(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
): Promise<Call | undefined> {
  if (request.method !== "POST") {
    sendStatus(response, 405, { allow: "POST" });
    return undefined;
  }
  if (!isToken(bearerOf(request), token)) {
    sendUnauthorized(response);
    return undefined;
  }
  const body = await readBody(request);
  if (body === undefined) {
    const error = { code: -32600, message: "The request is too large." };
    sendJson(response, 413, writeError(null, error));
    return undefined;
  }
  const frame = readIncoming(body);
  if (frame.kind === "call" || frame.kind === "notification") return frame;
  const error =
    frame.kind === "invalid"
      ? frame.error
      : { code: -32600, message: "POST /rpc carries calls only." };
  sendJson(response, 200, writeError(frame.id, error));
  return undefined;
}

/** Answers one HTTP request to `/rpc`. */
export async function answerRpcPost(
  request: IncomingMessage,
  response: ServerResponse,
  options: RpcPostOptions,
): Promise<void> {
  const call = await callOf(request, response, options.token);
  if (!call) return;
  const tasks: (() => void)[] = [];
  const context: CallContext = {
    declaration: declarationOf(
      headerValue(request.headers["x-jsnb-client"]),
      headerValue(request.headers["x-jsnb-agent"]),
    ),
    peer: undefined,
    afterAnswer: (task) => tasks.push(task),
  };
  const answer = await options.dispatch(call.method, call.params, context);
  // `close` comes once the answer is written or the caller went away: a received workspace.stop stops either way.
  response.once("close", () => {
    for (const task of tasks) task();
  });
  if (call.kind === "call") {
    sendJson(response, 200, writeAnswer(call.id, answer));
    return;
  }
  if (!answer.ok)
    options.log.warn({ method: call.method, error: answer.error }, "a notification failed");
  sendStatus(response, 204);
}
