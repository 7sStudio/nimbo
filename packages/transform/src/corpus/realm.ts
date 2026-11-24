// The test realm of 04 §3.3: the scope Proxy over a record, running a cell by indirect eval, and mapping its frames back.
import {
  GREATEST_LOWER_BOUND,
  LEAST_UPPER_BOUND,
  TraceMap,
  generatedPositionFor,
  originalPositionFor,
} from "@jridgewell/trace-mapping";

export type Realm = {
  /** What a cell receives as `__scope`. */
  readonly scope: Record<string, unknown>;
  /** The names cells defined, by name. */
  readonly record: Record<string, unknown>;
  /** Exported name → local name, as `__scope.__export` recorded them. */
  readonly exports: Map<string, string>;
};

/** A 1-based line and column, as 03 §5 `Frame` reports them. */
export type FramePosition = {
  readonly line: number;
  readonly col: number;
};

type CellFunction = (scope: Record<string, unknown>) => unknown;

const isCellFunction = (value: unknown): value is CellFunction => typeof value === "function";

/** The realm's loader: a relative specifier resolves against this module, a bare one through Node (04 §8.1 is the kernel's). */
const load = (specifier: string): Promise<unknown> =>
  import(specifier.startsWith(".") ? new URL(specifier, import.meta.url).href : specifier);

/**
 * The scope of 04 §3.3: plumbing first (never shadowed), then the record, the builtins, the realm's globals,
 * else `ReferenceError`; every write lands in the record, so `globalThis` stays clean.
 */
export function createRealm(builtins: Record<string, unknown>): Realm {
  const record: Record<string, unknown> = {};
  const exports = new Map<string, string>();
  const globals: Record<string, unknown> = globalThis;
  const peek = (name: string): unknown => {
    if (Object.hasOwn(record, name)) return record[name];
    if (Object.hasOwn(builtins, name)) return builtins[name];
    return name in globals ? globals[name] : undefined;
  };
  const plumbing: Record<string, unknown> = {
    __import: load,
    __export: (name: string, from: string = name) => {
      exports.set(name, from);
    },
    $peek: peek,
  };
  const scope = new Proxy(record, {
    get(target, name) {
      if (typeof name !== "string") return undefined;
      if (Object.hasOwn(plumbing, name)) return plumbing[name];
      if (Object.hasOwn(target, name)) return target[name];
      if (Object.hasOwn(builtins, name)) return builtins[name];
      if (name in globals) return globals[name];
      throw new ReferenceError(`${name} is not defined`);
    },
    set(target, name, value) {
      if (typeof name === "string") target[name] = value;
      return true;
    },
    has: () => true,
  });
  return { scope, record, exports };
}

/** Evaluates the compiled cell through indirect eval, so `//# sourceURL` names its frames, and runs it on the realm. */
export function runCell(realm: Realm, code: string): Promise<unknown> {
  const evaluate: (text: string) => unknown = globalThis.eval;
  const fn = evaluate(code);
  if (!isCellFunction(fn)) throw new Error("the compiled cell is not a function");
  return Promise.resolve(fn(realm.scope));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

type MapShape = { readonly file?: string; readonly sources: readonly string[] };

const isMapShape = (value: unknown): value is MapShape =>
  typeof value === "object" && value !== null && "sources" in value && Array.isArray(value.sources);

/** The fields of the map the realm reads; the tracer takes the JSON text itself. */
function parseMap(map: string): MapShape {
  const parsed: unknown = JSON.parse(map);
  if (!isMapShape(parsed)) throw new Error("not a source map");
  return parsed;
}

/** The original position of a generated one (1-based line and column), or undefined when the map has nothing there. */
function toOriginal(map: string, line: number, col: number): FramePosition | undefined {
  const tracer = new TraceMap(map);
  for (const bias of [GREATEST_LOWER_BOUND, LEAST_UPPER_BOUND] as const) {
    const hit = originalPositionFor(tracer, { line, column: col - 1, bias });
    if (hit.line !== null) return { line: hit.line, col: hit.column + 1 };
  }
  return undefined;
}

/** The first generated position for an original line (1-based line and column), or undefined. */
export function toGenerated(map: string, originalLine: number): FramePosition | undefined {
  const source = parseMap(map).sources[0] ?? "";
  const hit = generatedPositionFor(new TraceMap(map), {
    source,
    line: originalLine,
    column: 0,
    bias: LEAST_UPPER_BOUND,
  });
  return hit.line === null ? undefined : { line: hit.line, col: hit.column + 1 };
}

/** The first stack frame of `error` inside the cell the map describes, mapped back to the TypeScript source. */
export function firstCellFrame(error: unknown, map: string): FramePosition | undefined {
  const stack = error instanceof Error ? (error.stack ?? "") : String(error);
  const { file } = parseMap(map);
  const frame = new RegExp(`${escapeRegExp(file ?? "")}:(\\d+):(\\d+)`);
  for (const line of stack.split("\n")) {
    const match = frame.exec(line);
    if (match) return toOriginal(map, Number(match[1]), Number(match[2]));
  }
  return undefined;
}
