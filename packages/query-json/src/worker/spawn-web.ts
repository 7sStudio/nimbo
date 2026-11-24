// Starts an engine's query worker as a module Web Worker. Keep one `new Worker(new URL("./entry-….js",
// import.meta.url), { type: "module" })` literal per engine: Vite bundles each worker from its literal, with only that
// engine inside (and resolves the .js name to the .ts source when running from source).
import type { WorkerChannel, WorkerEvents, WorkerKind } from "./protocol.ts";

const create = (kind: WorkerKind): Worker =>
  kind === "jq"
    ? new Worker(new URL("./entry-jq-web.js", import.meta.url), { type: "module" })
    : new Worker(new URL("./entry-jsonpath-web.js", import.meta.url), { type: "module" });

/** A Web Worker channel; browsers offer no heap cap, jq's own 256 MB WebAssembly cap still applies. */
export const spawnWebWorker = (kind: WorkerKind, events: WorkerEvents): WorkerChannel => {
  const worker = create(kind);
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    events.onReply(event.data);
  });
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    events.onFailure({
      kind: "unavailable",
      message: `The query worker stopped (${event.message || "it failed to start"}). Run the query again to restart it.`,
    });
  });
  return {
    post: (task) => {
      worker.postMessage(task);
    },
    terminate: () => {
      worker.terminate();
      return Promise.resolve();
    },
  };
};
