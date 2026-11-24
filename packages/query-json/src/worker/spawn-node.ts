// Starts an engine's query worker as a Node worker thread with a heap cap. node:worker_threads is reached through
// process.getBuiltinModule and the entry URL is not a literal, so a page bundle sees no node:* import.
import type { Worker as NodeWorker } from "node:worker_threads";

import type { QueryError } from "../errors.ts";
import { messageOf } from "../errors.ts";
import type { WorkerChannel, WorkerEvents, WorkerKind } from "./protocol.ts";

const entries = { jq: "./entry-jq-node", jsonpath: "./entry-jsonpath-node" } as const;

/** The engine's entry beside this file: the .ts source when running from src (tests), the emitted .js otherwise. */
const entryFile = (kind: WorkerKind): string =>
  `${entries[kind]}${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`;

const isOutOfMemory = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ERR_WORKER_OUT_OF_MEMORY";

const failureOf = (error: unknown): QueryError =>
  isOutOfMemory(error)
    ? {
        kind: "memory",
        message:
          "The query ran out of memory in the worker. Narrow the query or raise its memory cap.",
      }
    : {
        kind: "unavailable",
        message: `The query worker stopped (${messageOf(error)}). Run the query again to restart it.`,
      };

/** A worker thread channel whose heap is capped at `memoryMb`; unref'd so an idle worker never keeps Node alive. */
export const spawnNodeWorker = (
  kind: WorkerKind,
  memoryMb: number,
  events: WorkerEvents,
): WorkerChannel => {
  const { Worker } = process.getBuiltinModule("node:worker_threads");
  const worker: NodeWorker = new Worker(new URL(entryFile(kind), import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: memoryMb },
    stderr: true,
  });
  worker.stderr.resume(); // drained: emscripten prints "Aborted()" there, which is reported as a result instead
  worker.unref();
  worker.on("message", (reply: unknown) => {
    events.onReply(reply);
  });
  worker.on("error", (error) => {
    events.onFailure(failureOf(error));
  });
  worker.on("exit", (code) => {
    events.onFailure({
      kind: "unavailable",
      message: `The query worker exited (code ${String(code)}). Run the query again to restart it.`,
    });
  });
  return {
    post: (task) => {
      worker.postMessage(task);
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
};
