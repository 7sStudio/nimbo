// Starts an engine's query worker for this runtime: a Web Worker in the page, a worker thread in Node.
import type { WorkerChannel, WorkerEvents, WorkerKind } from "./protocol.ts";
import { spawnNodeWorker } from "./spawn-node.ts";
import { spawnWebWorker } from "./spawn-web.ts";

/** A new worker for one engine; `memoryMb` caps its heap where the runtime allows it (Node). */
export const spawnWorker = (
  kind: WorkerKind,
  memoryMb: number,
  events: WorkerEvents,
): WorkerChannel =>
  typeof Worker === "function"
    ? spawnWebWorker(kind, events)
    : spawnNodeWorker(kind, memoryMb, events);
