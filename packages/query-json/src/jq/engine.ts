// The jq engine: jq's WebAssembly build in the query worker, started by load() and kept for the
// engine's life; every program runs there under the timeout and the heap cap. A held value (hold) is sent to the
// worker once and queried by its key (transformHeld) after that.
import type { HeldBound, HeldTransform, HoldingTransformEngine, RunOptions } from "../engine.ts";
import { queryDefaults } from "../engine.ts";
import type { QueryError, Result } from "../errors.ts";
import { fail, ok } from "../errors.ts";
import type { HeldValues } from "../held.ts";
import { boundOf, createHeldValues, heldTask, releaseHeld } from "../held.ts";
import { createLoader } from "../loader.ts";
import type { WorkerClient } from "../worker/client.ts";
import { createWorkerClient } from "../worker/client.ts";
import type { SpawnWorker } from "../worker/protocol.ts";
import { isReady, isTransformResult, toJsonText } from "../worker/protocol.ts";
import { spawnWorker } from "../worker/spawn.ts";

export type JqEngineOptions = {
  /** Wall-clock limit of one program run (`query.timeoutMs`); default 5 000. */
  readonly timeoutMs?: number;
  /** Heap cap of the worker thread in Node, in MB; default 512. jq's WebAssembly heap is capped at 256 MB anyway. */
  readonly memoryMb?: number;
  /** What the worker may hold (`hold`), in bytes of JSON text; default 64 MiB, the oldest released first. */
  readonly heldMaxBytes?: HeldBound;
};

/** Starting the worker and compiling jq's WebAssembly is not a query, so query.timeoutMs does not bound it. */
const loadTimeoutMs = 30_000;

/** The load's own failure text: raising query.timeoutMs would not help, since it does not bound loading. */
const loadFailure = (error: QueryError): string =>
  error.kind === "timeout"
    ? `jq did not start within ${String(loadTimeoutMs / 1000)} s. Reload the page or restart the daemon, then call load() again.`
    : `jq did not load: ${error.message}`;

type Runner = {
  readonly client: WorkerClient;
  readonly held: HeldValues;
  readonly timeoutMs: number;
};

/** The compiled program's transform over a value, and over the value held under a key. */
const transformers = (on: Runner, program: string): Omit<HeldTransform, "query"> => {
  const options = (run: RunOptions) => ({
    timeoutMs: run.timeoutMs ?? on.timeoutMs,
    signal: run.signal,
  });
  return {
    transform: (json, run = {}) => {
      const text = toJsonText(json);
      if (!text.ok) return Promise.resolve(text);
      const task = { kind: "jq", program, json: text.value } as const;
      return on.client.run(task, isTransformResult, options(run));
    },
    transformHeld: (key, run = {}) => {
      const value = on.held.value(key);
      if (!value.ok) return Promise.resolve(value);
      const task = heldTask(on.held, { kind: "jq-held", program, key }, value.value);
      return on.client.run(task, isTransformResult, options(run));
    },
  };
};

/** The jq engine, id "jq". `compile` accepts any program: jq reports syntax errors, with their position, when run. */
export const createJqEngine = (options: JqEngineOptions = {}): HoldingTransformEngine =>
  createJqEngineWith(options, spawnWorker);

/** createJqEngine over a given way to start its worker. */
export const createJqEngineWith = (
  options: JqEngineOptions,
  spawn: SpawnWorker,
): HoldingTransformEngine => {
  const client = createWorkerClient("jq", options.memoryMb ?? queryDefaults.memoryMb, spawn);
  const loader = createLoader("jq", async (): Promise<Result<null>> => {
    const warm = await client.run({ kind: "warm-jq" }, isReady, { timeoutMs: loadTimeoutMs });
    return warm.ok ? warm : fail("unavailable", loadFailure(warm.error));
  });
  const held = createHeldValues(boundOf(options.heldMaxBytes));
  const runner = { client, held, timeoutMs: options.timeoutMs ?? queryDefaults.timeoutMs };
  const compile = (program: string): Result<HeldTransform> => {
    const loaded = loader.loaded();
    return loaded.ok ? ok({ query: program, ...transformers(runner, program) }) : loaded;
  };
  return {
    id: "jq",
    mode: "transform",
    load: loader.load,
    compile,
    hold: held.hold,
    release: (key) => {
      releaseHeld(held, client, key);
    },
    dispose: async () => {
      loader.reset();
      held.clear();
      await client.dispose();
    },
  };
};
