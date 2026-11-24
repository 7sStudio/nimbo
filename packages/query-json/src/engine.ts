// The QueryEngine interface hosts program against (11-query §2) and the registry they look engines up in.
import type { Result } from "./errors.ts";

/** An RFC 9535 §2.7 normalized path such as `$['data'][3]`. */
export type NormalizedPath = string;

/**
 * The defaults of `query.timeoutMs` (03-api §4.10), the main-thread node limit and time budget of 11-query §2, and the
 * worker heap cap.
 */
export const queryDefaults = {
  timeoutMs: 5000,
  mainThreadNodeLimit: 100_000,
  mainThreadSliceMs: 100,
  memoryMb: 512,
} as const;

/**
 * The longest query a JSONPath compile accepts. compile() runs in the calling thread and the parser takes up to about
 * 2.6 ms per 1 000 characters (more under coverage), so 10 000 characters, some 450 ids in an `||` list, compile in
 * about 25 ms at worst.
 */
export const maxQueryLength = 10_000;

/** Per-run options: an AbortSignal and a timeout that overrides the engine's `query.timeoutMs`. */
export type RunOptions = { readonly signal?: AbortSignal; readonly timeoutMs?: number };

/** What a select engine returns: the paths of the selected nodes, in the engine's order. */
export type SelectResult = { readonly paths: readonly NormalizedPath[] };

/** What a transform engine returns: the only output when `count` is 1, else the array of all outputs. */
export type TransformResult = { readonly value: unknown; readonly count: number };

/** A compiled select query; `select` never throws and never rejects. */
export type CompiledSelect = {
  readonly query: string;
  select(json: unknown, options?: RunOptions): Promise<Result<SelectResult>>;
};

/** A compiled transform program; `transform` never throws and never rejects. */
export type CompiledTransform = {
  readonly query: string;
  transform(json: unknown, options?: RunOptions): Promise<Result<TransformResult>>;
};

/**
 * What every engine shares. `load()` is idempotent, shares one promise between concurrent calls and never rejects:
 * a failure shows up as an `unavailable` error from `compile()`, and a later `load()` tries again. `dispose()`
 * stops any worker; a later `load()` starts again.
 */
type EngineBase = {
  readonly id: string;
  load(): Promise<void>;
  dispose(): Promise<void>;
};

/** An engine whose results are paths into the value (JSONPath, Filter chips). */
export type SelectEngine = EngineBase & {
  readonly mode: "select";
  compile(query: string): Result<CompiledSelect>;
};

/** An engine whose result is a new value (jq). */
export type TransformEngine = EngineBase & {
  readonly mode: "transform";
  compile(query: string): Result<CompiledTransform>;
};

/**
 * Values held in an engine's worker: an extension of QueryEngine that this package's engines implement
 * (a third-party engine need not; 02-architecture §9). `hold` keeps `json` under `key` for the `…Held` queries: it
 * is sent to the engine's worker with the first query of `key` there (and again after a timeout or a crash replaced
 * that worker), never with each query; what the worker holds stays within the engine's `heldMaxBytes` of JSON text,
 * the oldest released first. `release` forgets `key`, in the worker too; a later query of it fails until it is held
 * again.
 */
export type ValueHolder = {
  hold(key: string, json: unknown): void;
  release(key: string): void;
};

/** A compiled select that also selects in a held value; `selectHeld` never throws and never rejects. */
export type HeldSelect = CompiledSelect & {
  selectHeld(key: string, options?: RunOptions): Promise<Result<SelectResult>>;
};

/** A compiled transform that also transforms a held value; `transformHeld` never throws and never rejects. */
export type HeldTransform = CompiledTransform & {
  transformHeld(key: string, options?: RunOptions): Promise<Result<TransformResult>>;
};

/** A select engine that holds values: its compiled queries select in them too. */
export type HoldingSelectEngine = Omit<SelectEngine, "compile"> &
  ValueHolder & { compile(query: string): Result<HeldSelect> };

/** A transform engine that holds values: its compiled programs transform them too. */
export type HoldingTransformEngine = Omit<TransformEngine, "compile"> &
  ValueHolder & { compile(query: string): Result<HeldTransform> };

/** The bound of what an engine's worker holds (`hold`), in bytes of JSON text: a number, or read at each send. */
export type HeldBound = number | (() => number);

export type QueryEngine = SelectEngine | TransformEngine;

/** Engines are registered, not imported: the viewer asks `engines.for(id)` (11-query §2). */
export type EngineRegistry = {
  register(engine: QueryEngine): void;
  for(id: string): QueryEngine | undefined;
  ids(): readonly string[];
};

/** A registry holding the given engines; registering an id again replaces the earlier engine. */
export const createEngineRegistry = (engines: readonly QueryEngine[] = []): EngineRegistry => {
  const byId = new Map<string, QueryEngine>();
  const register = (engine: QueryEngine): void => {
    byId.set(engine.id, engine);
  };
  engines.forEach(register);
  return {
    register,
    for: (id) => byId.get(id),
    ids: () => [...byId.keys()],
  };
};
