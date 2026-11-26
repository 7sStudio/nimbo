// The JSONPath engine: the library loads on first use. A select runs in the calling thread only for a
// linear query over a value within the limits below (mainThreadNodeLimit nodes, 64 levels, 4 000 000 characters, names
// of 10 000), and for at most one time slice; it runs in the query worker otherwise, where the timeout, the abort and
// the heap cap apply. A held value (hold) is selected in by its key (selectHeld): sent to the worker once, parsed there
// once, and kept.
import type {
  HeldBound,
  HeldSelect,
  HoldingSelectEngine,
  RunOptions,
  SelectResult,
} from "../engine.ts";
import { queryDefaults } from "../engine.ts";
import type { Result } from "../errors.ts";
import { fail, messageOf, ok } from "../errors.ts";
import type { HeldValues } from "../held.ts";
import { boundOf, createHeldValues, heldTask, releaseHeld } from "../held.ts";
import { createLoader } from "../loader.ts";
import type { WorkerClient } from "../worker/client.ts";
import { createWorkerClient } from "../worker/client.ts";
import { cancelled, timeoutError } from "../worker/job.ts";
import type { SpawnWorker, TaskSource } from "../worker/protocol.ts";
import { isSelectResult, toJsonText } from "../worker/protocol.ts";
import { spawnWorker } from "../worker/spawn.ts";
import type * as Library from "./evaluate.ts";
import { measure } from "./size.ts";

export type JsonPathEngineOptions = {
  /** Wall-clock limit of a select (`query.timeoutMs`); default 5 000. */
  readonly timeoutMs?: number;
  /** The most nodes a value may have to be selected in the calling thread; default 100 000. */
  readonly mainThreadNodeLimit?: number;
  /** How long a select may hold the calling thread before it moves to the worker, in ms; default 100. */
  readonly mainThreadSliceMs?: number;
  /** Heap cap of the worker thread in Node, in MB; default 512. */
  readonly memoryMb?: number;
  /** What the worker may hold (`hold`), in bytes of JSON text; default 64 MiB, the oldest released first. */
  readonly heldMaxBytes?: HeldBound;
};

/** Normalized paths are copied at each step, so a deep value costs nodes × depth: deeper than this goes to the worker. */
const depthLimit = 64;

/**
 * The engine reads the clock between steps; these keep any one step short. Each result's normalized path is escaped
 * character by character (about 40 ns each), so with at most 64 levels of names of at most 10 000 characters a path
 * costs at most about 25 ms; the total of names and strings bounds every per-string operation and the JSON text.
 */
const charLimit = 4_000_000;
const nameLimit = 10_000;

type Selector = {
  readonly library: typeof Library;
  readonly client: WorkerClient;
  readonly held: HeldValues;
  readonly timeoutMs: number;
  readonly nodeLimit: number;
  readonly sliceMs: number;
};

const importLibrary = async (): Promise<Result<typeof Library>> => {
  try {
    return ok(await import("./evaluate.ts"));
  } catch (cause) {
    return fail(
      "unavailable",
      `The JSONPath engine failed to load (${messageOf(cause)}). Call load() again to retry.`,
    );
  }
};

const fitsCallingThread = (json: unknown, nodeLimit: number): boolean => {
  const limits = { nodes: nodeLimit, depth: depthLimit, chars: charLimit, longestName: nameLimit };
  const size = measure(json, limits);
  return (
    size.nodes <= nodeLimit &&
    size.depth <= depthLimit &&
    size.chars <= charLimit &&
    size.longestName <= nameLimit
  );
};

/** The worker's run, with what the calling thread left of the timeout; a timeout reports the whole of it. */
const inWorker = (
  on: Selector,
  task: TaskSource,
  run: RunOptions & { readonly spentMs: number },
): Promise<Result<SelectResult>> => {
  const timeoutMs = run.timeoutMs ?? on.timeoutMs;
  const left = timeoutMs - run.spentMs;
  if (left <= 0) return Promise.resolve({ ok: false, error: timeoutError(timeoutMs) });
  return on.client
    .run(task, isSelectResult, { timeoutMs: left, signal: run.signal })
    .then((result) =>
      !result.ok && result.error.kind === "timeout"
        ? { ok: false, error: timeoutError(timeoutMs) }
        : result,
    );
};

/** The task of a select over `json` itself: its JSON text with the query. */
const ownTask = (query: string, json: unknown): TaskSource => {
  const text = toJsonText(json);
  return () => (text.ok ? ok({ kind: "jsonpath", query, json: text.value }) : text);
};

/**
 * A linear query over a small, shallow value runs here for at most one slice; anything else runs in the worker, on the
 * value itself or, given its key, on the value the worker holds.
 */
const selectIn = (
  on: Selector,
  target: { readonly query: string; readonly linear: boolean; readonly key?: string },
  json: unknown,
  run: RunOptions,
): Promise<Result<SelectResult>> => {
  const { query, key } = target;
  // Built only on the way to the worker: a select that stays in the calling thread never writes the value's JSON text.
  const task = (): TaskSource =>
    key === undefined
      ? ownTask(query, json)
      : heldTask(on.held, { kind: "jsonpath-held", query, key }, json);
  if (run.signal?.aborted) return Promise.resolve({ ok: false, error: cancelled });
  if (!target.linear || !fitsCallingThread(json, on.nodeLimit)) {
    return inWorker(on, task(), { ...run, spentMs: 0 });
  }
  const started = performance.now();
  const sliceMs = Math.min(on.sliceMs, run.timeoutMs ?? on.timeoutMs);
  const outcome = on.library.selectPathsBefore(json, query, started + sliceMs);
  if (outcome !== "expired") return Promise.resolve(outcome);
  return inWorker(on, task(), { ...run, spentMs: performance.now() - started });
};

/** The compiled query's select over a value, and over the value held under a key. */
const selectors = (on: Selector, query: string, linear: boolean) => ({
  select: (json: unknown, run: RunOptions = {}) => selectIn(on, { query, linear }, json, run),
  selectHeld: (key: string, run: RunOptions = {}) => {
    const value = on.held.value(key);
    if (!value.ok) return Promise.resolve(value);
    return selectIn(on, { query, linear, key }, value.value, run);
  },
});

/** The RFC 9535 JSONPath engine, id "jsonpath"; Filter chips compile to it too. */
export const createJsonPathEngine = (options: JsonPathEngineOptions = {}): HoldingSelectEngine =>
  createJsonPathEngineWith(options, spawnWorker);

/** createJsonPathEngine over a given way to start its worker. */
export const createJsonPathEngineWith = (
  options: JsonPathEngineOptions,
  spawn: SpawnWorker,
): HoldingSelectEngine => {
  const client = createWorkerClient("jsonpath", options.memoryMb ?? queryDefaults.memoryMb, spawn);
  const loader = createLoader("JSONPath", importLibrary);
  const held = createHeldValues(boundOf(options.heldMaxBytes));
  const settings = {
    client,
    held,
    timeoutMs: options.timeoutMs ?? queryDefaults.timeoutMs,
    nodeLimit: options.mainThreadNodeLimit ?? queryDefaults.mainThreadNodeLimit,
    sliceMs: options.mainThreadSliceMs ?? queryDefaults.mainThreadSliceMs,
  };
  const compile = (query: string): Result<HeldSelect> => {
    const library = loader.loaded();
    if (!library.ok) return library;
    const checked = library.value.compileJsonPath(query);
    if (!checked.ok) return checked;
    return ok({
      query,
      ...selectors({ ...settings, library: library.value }, query, checked.value.linear),
    });
  };
  return {
    id: "jsonpath",
    mode: "select",
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
