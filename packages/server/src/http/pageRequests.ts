// The daemon's own requests to a page on its socket: realm.execute, realm.reset, realm.snapshot and
// realm.interrupt with ids of the daemon's (`s1`, `s2`…), the page's answers matched to them, an error answer as
// PageRequestFailed, and every pending request failed with PageGone once the socket closes.
import { randomUUID } from "node:crypto";

import { JsnbError } from "@jsnb/core";
import type { WebSocket } from "ws";

import type { Peer } from "../commands/context.js";
import type { WireError } from "../commands/wireError.js";
import type { Log } from "../events/log.js";
import type { RpcId } from "./frames.js";
import { writeNotification, writeRequest } from "./frames.js";

type Refusal = { readonly method: string; readonly code: number; readonly data?: unknown };

/** A page answered one of the daemon's requests with a JSON-RPC error (its message is the page's). */
class PageRequestFailed extends JsnbError {
  declare readonly data: Refusal;
  constructor(message: string, data: Refusal) {
    super({
      name: "PageRequestFailed",
      message: `The page could not answer ${data.method}: ${message}`,
      data,
    });
  }
}

/** The socket closed before the page answered one of the daemon's requests. */
class PageGone extends JsnbError {
  declare readonly data: { readonly method: string };
  constructor(data: { readonly method: string }) {
    super({
      name: "PageGone",
      message: `The page closed its connection before it answered ${data.method}.`,
      data,
    });
  }
}

export type Pending = {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
};

/**
 * Sends `text` while the socket is open; `then` runs once it is written, or at once when it cannot be (the peer went
 * away: a received workspace.stop stops whether or not its caller reads the answer).
 */
export function send(ws: WebSocket, text: string, then?: () => void): void {
  if (ws.readyState === ws.OPEN) ws.send(text, () => then?.());
  else then?.();
}

/** Matches a page's answer to the daemon's pending request `id`; an answer to none is dropped and logged. */
export function settle(
  pending: Map<RpcId, Pending>,
  log: Log,
  id: RpcId | null,
  outcome: { result: unknown } | { error: WireError },
): void {
  const waiting = id === null ? undefined : pending.get(id);
  if (!waiting) {
    log.debug({ id }, "an answer to no pending request of the daemon was dropped");
    return;
  }
  if (id !== null) pending.delete(id);
  if ("result" in outcome) waiting.resolve(outcome.result);
  else
    waiting.reject(
      new PageRequestFailed(outcome.error.message, { method: waiting.method, ...outcome.error }),
    );
}

/** Fails every pending request: the socket closed before the page answered. */
export function failPending(pending: Map<RpcId, Pending>): void {
  for (const [id, waiting] of pending) {
    pending.delete(id);
    waiting.reject(new PageGone({ method: waiting.method }));
  }
}

const reasonOf = (signal: AbortSignal | undefined, method: string): Error =>
  signal?.reason instanceof Error ? signal.reason : new PageGone({ method });

export function createPeer(ws: WebSocket, pending: Map<RpcId, Pending>, closed: AbortSignal): Peer {
  let next = 1;
  const request = (method: string, params: unknown, signal?: AbortSignal): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (closed.aborted || signal?.aborted === true) {
        reject(reasonOf(signal, method));
        return;
      }
      const id = `s${String(next++)}`;
      const onAbort = (): void => {
        if (pending.delete(id)) reject(reasonOf(signal, method));
      };
      const done = (): void => signal?.removeEventListener("abort", onAbort);
      pending.set(id, {
        method,
        resolve: (result) => {
          done();
          resolve(result);
        },
        reject: (error) => {
          done();
          reject(error);
        },
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      send(ws, writeRequest(id, method, params));
    });
  return {
    id: randomUUID(),
    notify: (event) => {
      send(ws, writeNotification("event", event));
    },
    request,
    closed,
  };
}
