// The recursive encoder behind encode and encodeStrict: one walk over a value with a mode, budgets and refs.
// Over 170 lines because every kind of the wire form (form.ts) has its branch here.
import { bytesOf, toBase64 } from "./bytes.js";
import type { Path } from "./form.js";
import {
  bigintMarker,
  bytesMarker,
  dateMarker,
  errorMarker,
  escapeKey,
  functionMarker,
  numberMarker,
  refMarker,
  regexpMarker,
  truncatedMarker,
  undefinedMarker,
} from "./form.js";
import type { Kind } from "./special.js";
import { className, kindOf } from "./special.js";

type Failure = { readonly path: Path; readonly type: string; readonly bytes?: number };

export type WalkOptions = {
  readonly strict: boolean;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxBytes: number;
  readonly bytesLimit: number;
  readonly redact: (text: string) => string;
};

type State = {
  readonly options: WalkOptions;
  readonly seen: Map<object, Path>;
  nodes: number;
  bytes: number;
  truncated: boolean;
  exhausted: boolean;
  failure: Failure | undefined;
};

type Cursor = { readonly path: Path; readonly depth: number };
type Visitor = (value: unknown, at: Cursor, state: State) => unknown;

const nodeCost = 8;

/** Walks `value` and returns its wire form; the state carries the budget flags and a strict-mode failure. */
export function walk(value: unknown, options: WalkOptions): { json: unknown; state: State } {
  const state: State = {
    options,
    seen: new Map(),
    nodes: 0,
    bytes: 0,
    truncated: false,
    exhausted: false,
    failure: undefined,
  };
  return { json: visit(value, { path: [], depth: 0 }, state), state };
}

/** The first value that cannot cross; `bytes` when it is bytes over the limit (plain data, only too large). */
const fail = (state: State, path: Path, type: string, bytes?: number): typeof undefinedMarker => {
  state.failure ??= bytes === undefined ? { path, type } : { path, type, bytes };
  return undefinedMarker;
};

const overBudget = (state: State): boolean =>
  !state.options.strict &&
  (state.nodes >= state.options.maxNodes || state.bytes > state.options.maxBytes);

const encoder = new TextEncoder();
/** Captured when the module loads: user code that replaces JSON.stringify cannot break the encoder. */
const stringify = JSON.stringify.bind(JSON);

/** The UTF-8 bytes a string occupies once JSON-escaped, without its quotes. */
const jsonBytes = (value: string): number => encoder.encode(stringify(value)).length - 2;

/** The escaped UTF-8 bytes of a control character: the short escapes cost 2, the rest `\\u00XX`. */
const controlCost = (point: number): number =>
  point === 8 || point === 9 || point === 10 || point === 12 || point === 13 ? 2 : 6;

/** The escaped UTF-8 bytes one code point costs inside a JSON string (a lone surrogate is escaped). */
function escapedCost(point: number): number {
  if (point === 0x22 || point === 0x5c) return 2;
  if (point < 0x20) return controlCost(point);
  if (point < 0x80) return 1;
  if (point < 0x800) return 2;
  if (point >= 0xd800 && point <= 0xdfff) return 6;
  return point < 0x10000 ? 3 : 4;
}

/** The longest prefix of `value`, cut between code points, that fits `budget` escaped bytes. */
function fit(value: string, budget: number): string {
  let used = 0;
  let end = 0;
  for (const char of value) {
    const cost = escapedCost(char.codePointAt(0) ?? 0);
    if (used + cost > budget) break;
    used += cost;
    end += char.length;
  }
  return value.slice(0, end);
}

/** A string (value, key or error message) charged to the byte budget in JSON-escaped UTF-8 bytes; one that
 * does not fit is cut to what is left and ends the walk, so the form never exceeds `maxBytes` (04-kernel §5.4). */
const text = (value: string, state: State): string => {
  const redacted = state.options.redact(value);
  const size = jsonBytes(redacted);
  const remaining = state.options.maxBytes - state.bytes - 2;
  if (state.options.strict || size <= remaining) {
    state.bytes += size + 2;
    return redacted;
  }
  state.bytes = state.options.maxBytes;
  state.truncated = true;
  state.exhausted = true;
  return fit(redacted, Math.max(0, remaining));
};

function visit(value: unknown, at: Cursor, state: State): unknown {
  if (state.failure) return undefinedMarker;
  if (overBudget(state)) {
    state.truncated = true;
    state.exhausted = true;
    return truncatedMarker;
  }
  state.nodes += 1;
  state.bytes += nodeCost;
  const kind = kindOf(value);
  const leaf = leaves[kind];
  if (leaf) return leaf(value, at, state);
  return typeof value === "object" && value !== null
    ? reference(value, kind, at, state)
    : undefinedMarker;
}

const leaves: Partial<Record<Kind, Visitor>> = {
  primitive: (value, _at, state) => (typeof value === "string" ? text(value, state) : value),
  undefined: () => undefinedMarker,
  symbol: () => undefinedMarker,
  specialNumber: (value) => (typeof value === "number" ? numberMarker(value) : undefinedMarker),
  bigint: (value) => (typeof value === "bigint" ? bigintMarker(value) : undefinedMarker),
  function: (value, at, state) => {
    if (typeof value !== "function") return undefinedMarker;
    return state.options.strict ? fail(state, at.path, "Function") : functionMarker(value.name);
  },
  date: (value) => (value instanceof Date ? dateMarker(value) : undefinedMarker),
  regexp: (value) => (value instanceof RegExp ? regexpMarker(value) : undefinedMarker),
  error: (value, at, state) => {
    if (!(value instanceof Error)) return undefinedMarker;
    if (state.options.strict) return fail(state, at.path, className(value));
    return errorMarker(value.name, text(value.message, state));
  },
  bytes: (value, at, state) => {
    const object = typeof value === "object" && value !== null ? value : undefined;
    const view = object ? bytesOf(object) : undefined;
    if (!object || !view) return undefinedMarker;
    if (state.options.strict && view.length > state.options.bytesLimit) {
      return fail(state, at.path, className(object), view.length); // the value's own class: Buffer, Float64Array
    }
    const base64 = toBase64(view.subarray(0, state.options.bytesLimit));
    state.bytes += base64.length;
    return bytesMarker(view.length, base64);
  },
};

/** Containers: a repeated object becomes a ref, a too-deep one a truncated marker, the rest is walked. */
function reference(value: object, kind: Kind, at: Cursor, state: State): unknown {
  const first = state.seen.get(value);
  if (first) return refMarker(first);
  if (!state.options.strict && at.depth >= state.options.maxDepth) {
    state.truncated = true;
    return truncatedMarker;
  }
  state.seen.set(value, at.path);
  if (kind === "instance" && state.options.strict) return fail(state, at.path, className(value));
  const inner = { path: at.path, depth: at.depth + 1 };
  if (Array.isArray(value)) return list(value, inner, state);
  if (value instanceof Map) return entries(value, inner, state);
  if (value instanceof Set) {
    return {
      $type: "set",
      values: list([...value], { ...inner, path: [...at.path, "values"] }, state),
    };
  }
  return fields(value, kind === "instance" ? { $class: className(value) } : {}, inner, state);
}

function fields(value: object, out: Record<string, unknown>, at: Cursor, state: State): unknown {
  for (const key of Object.keys(value)) {
    const field: unknown = Reflect.get(value, key);
    if (typeof field === "symbol") continue;
    const written = escapeKey(text(key, state));
    out[written] = visit(field, { ...at, path: [...at.path, written] }, state);
    if (state.exhausted) break;
  }
  return out;
}

function list(items: readonly unknown[], at: Cursor, state: State): unknown[] {
  const out: unknown[] = [];
  for (const [index, item] of items.entries()) {
    out.push(visit(item, { ...at, path: [...at.path, index] }, state));
    if (state.exhausted) break;
  }
  return out;
}

function entries(map: Map<unknown, unknown>, at: Cursor, state: State): unknown {
  const out: unknown[][] = [];
  for (const [index, [key, item]] of [...map].entries()) {
    const entry = [...at.path, "entries", index];
    const pair = [
      visit(key, { ...at, path: [...entry, 0] }, state),
      visit(item, { ...at, path: [...entry, 1] }, state),
    ];
    out.push(pair);
    if (state.exhausted) break;
  }
  return { $type: "map", entries: out };
}
