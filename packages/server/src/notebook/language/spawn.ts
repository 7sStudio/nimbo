// The daemon's side of the language worker: started on first use, one request at a time
// in its order, answers correlated by id. A worker that dies is started again once; if it dies again within a minute,
// requests fail with LanguageUnavailable until the minute has passed.
import type { Worker as NodeWorker } from "node:worker_threads";

import { LanguageUnavailable } from "@jsnb/core";

import type { WorkerData, WorkerReply, WorkerTask } from "./protocol.js";

export type LanguageWorker = {
  readonly request: (task: WorkerTask) => Promise<unknown>;
  /** Ends the worker; the next request starts a new one. */
  readonly stop: () => Promise<void>;
  /** A worker thread is running (a close or a reset has nothing to do without one). */
  readonly running: () => boolean;
};

export type WorkerOptions = WorkerData & {
  /** Heap cap of the worker thread, in MB. */
  readonly memoryMb?: number;
  /** Hears each worker started (the tests terminate it to see the restart). */
  readonly onStart?: (worker: NodeWorker) => void;
  readonly now?: () => number;
};

/**
 * From source (the tests), the worker's entry is TypeScript whose imports name `.js` files and whose workspace
 * packages resolve through their `development` condition: a data: module registers that resolution in the worker
 * thread, as tools/test/resolve-ts.mjs does for a kernel child, then imports the entry. Built, it is worker.js.
 */
function entryOf(): URL {
  if (!import.meta.url.endsWith(".ts")) return new URL("./worker.js", import.meta.url);
  const entry = new URL("./worker.ts", import.meta.url).href;
  const bootstrap = [
    'import { existsSync } from "node:fs";',
    'import { registerHooks } from "node:module";',
    'import { fileURLToPath } from "node:url";',
    "registerHooks({ resolve(specifier, context, next) {",
    '  const conditions = [...new Set([...context.conditions, "development"])];',
    '  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {',
    '    const ts = new URL(specifier.replace(/\\.js$/, ".ts"), context.parentURL);',
    "    if (existsSync(fileURLToPath(ts))) return next(ts.href, { ...context, conditions });",
    "  }",
    "  return next(specifier, { ...context, conditions });",
    "} });",
    `await import(${JSON.stringify(entry)});`,
  ].join("\n");
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`);
}
const restartWindowMs = 60_000;

type Pending = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

/** The requests waiting for the worker's answers, by id. */
function pendingRequests() {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  return {
    add: (waiting: Pending): number => {
      const id = nextId;
      nextId += 1;
      pending.set(id, waiting);
      return id;
    },
    answer: (reply: WorkerReply): void => {
      const waiting = pending.get(reply.id);
      pending.delete(reply.id);
      if (!waiting) return;
      if (reply.ok) waiting.resolve(reply.value);
      else waiting.reject(new Error(reply.message));
    },
    failAll: (reason: string): void => {
      for (const waiting of pending.values()) waiting.reject(new LanguageUnavailable({ reason }));
      pending.clear();
    },
  };
}

/** A new worker thread, its answers and its exit wired. */
function startWorker(
  options: WorkerOptions,
  onReply: (reply: WorkerReply) => void,
  onExit: (worker: NodeWorker) => void,
): NodeWorker {
  const { Worker } = process.getBuiltinModule("node:worker_threads");
  const started: NodeWorker = new Worker(entryOf(), {
    workerData: { root: options.root, fallbackTypeRoots: options.fallbackTypeRoots },
    resourceLimits: { maxOldGenerationSizeMb: options.memoryMb ?? 1536 },
  });
  started.unref();
  started.on("message", onReply);
  started.on("error", () => undefined); // the exit that follows reports it
  started.on("exit", () => {
    onExit(started);
  });
  options.onStart?.(started);
  return started;
}

export function createLanguageWorker(options: WorkerOptions): LanguageWorker {
  const now = options.now ?? Date.now;
  const pending = pendingRequests();
  let worker: NodeWorker | undefined;
  let deaths: number[] = [];
  const recentDeaths = (): number[] => deaths.filter((at) => now() - at < restartWindowMs);
  const onExit = (exited: NodeWorker): void => {
    if (worker !== exited) return;
    worker = undefined;
    deaths = [...recentDeaths(), now()];
    pending.failAll("the language worker stopped; the next request starts it again.");
  };
  const running = (): NodeWorker => {
    if (worker) return worker;
    if (recentDeaths().length >= 2)
      throw new LanguageUnavailable({
        reason: "the language worker failed twice within a minute.",
      });
    worker = startWorker(options, pending.answer, onExit);
    return worker;
  };
  return {
    request: (task) =>
      new Promise((resolve, reject) => {
        const target = running();
        target.postMessage({ ...task, id: pending.add({ resolve, reject }) });
      }),
    running: () => worker !== undefined,
    stop: async () => {
      const current = worker;
      worker = undefined;
      pending.failAll("the language service stopped.");
      await current?.terminate();
    },
  };
}
