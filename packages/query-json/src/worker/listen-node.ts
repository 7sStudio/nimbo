// The worker side of the message loop in a Node worker thread: each message on the port is served and answered.
import type { Serve } from "./protocol.ts";

/** The part of a worker_threads MessagePort the loop uses. */
export type NodePort = {
  on(event: "message", listener: (value: unknown) => void): unknown;
  postMessage(value: unknown): void;
};

/** Answers every message on `port` (the worker's parentPort; null outside a worker) with `serve`. */
export const listenNode = (port: NodePort | null, serve: Serve): void => {
  port?.on("message", (task) => {
    void serve(task).then((reply) => {
      port.postMessage(reply);
    }); // serve never rejects
  });
};
