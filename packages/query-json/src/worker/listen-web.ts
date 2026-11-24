// The worker side of the message loop in a Web Worker: each message on the scope is served and answered.
import type { Serve } from "./protocol.ts";

/** The part of a DedicatedWorkerGlobalScope (or a MessagePort) the loop uses. */
export type WebScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
};

/** Answers every message on `scope` (the worker's `self`) with `serve`. */
export const listenWeb = (scope: WebScope, serve: Serve): void => {
  scope.addEventListener("message", (event) => {
    void serve(event.data).then((reply) => {
      scope.postMessage(reply);
    }); // serve never rejects
  });
};
