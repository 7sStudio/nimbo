// Compare with previous run (03-api §4.3 cell.compare): what changed between two runs of a cell, read
// from their outputs. The last value (a value output, or the JSON of a display.json or display.table) is compared as its
// wire form, node by node: added, removed and changed paths in JSONPath (`$.items[2].price`), arrays by index, a marker
// object (`{ "$type": … }`, a class instance's fields aside) as one leaf. What the run printed is compared as lines.
// Pure, so the daemon answers agents with it and the page shows the same thing.
import type { ExecStatus } from "../model/execution.js";
import type { ErrorInfo, Output } from "../model/output.js";
import type { DiffLine } from "./lineDiff.js";
import { lineDiff } from "./lineDiff.js";

/** The parts of a run a comparison reads: an Execution or a saved run. */
export type ComparedRun = {
  readonly status: ExecStatus;
  readonly durationMs?: number | undefined;
  readonly outputs: readonly Output[];
  readonly error?: ErrorInfo | undefined;
};

export type ValueChange =
  | { readonly kind: "added"; readonly path: string; readonly after: unknown }
  | { readonly kind: "removed"; readonly path: string; readonly before: unknown }
  | {
      readonly kind: "changed";
      readonly path: string;
      readonly before: unknown;
      readonly after: unknown;
    };

export type RunComparison = {
  /** Nothing a reader would see differs: status, value, printed text and error (the duration aside). */
  readonly same: boolean;
  readonly status: { readonly before: ExecStatus; readonly after: ExecStatus };
  readonly durationMs: { readonly before?: number; readonly after?: number };
  /** The last values' changes, at most `limit` of them and how many more; null when neither run has a value. */
  readonly value: {
    readonly changes: readonly ValueChange[];
    readonly more: number;
    /** Either value was cut by the output limits: a change past the cut is not seen. */
    readonly truncated: boolean;
  } | null;
  /** stdout and stderr of each run, as one text, line by line; empty when neither printed. */
  readonly text: readonly DiffLine[];
  readonly error: { readonly before?: string; readonly after?: string };
};

const defaultLimit = 200;

type LastValue = { readonly json: unknown; readonly truncated: boolean };

const jsonMimes: ReadonlySet<string> = new Set([
  "application/json",
  "application/vnd.jsnb.table+json",
]);

/** The run's last value: a value output, or the JSON a display.json or display.table carries. */
export function lastValue(outputs: readonly Output[]): LastValue | undefined {
  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const output = outputs[index];
    if (output?.kind === "value") return { json: output.json, truncated: output.truncated };
    if (output?.kind === "display" && jsonMimes.has(output.mime)) {
      try {
        const json: unknown = JSON.parse(output.data);
        return { json, truncated: false };
      } catch {
        // not JSON after all: an earlier output may be
      }
    }
  }
  return undefined;
}

/** What a run printed, its last newline off (it ends the last line, it is not an empty line after it). */
const printed = (outputs: readonly Output[]): string =>
  outputs
    .flatMap((output) => (output.kind === "stream" ? [output.text] : []))
    .join("")
    .replace(/\n$/u, "");

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A marker of the wire form (`$type`) is one value, compared whole. */
const isLeaf = (value: unknown): boolean =>
  !Array.isArray(value) && (!isPlainObject(value) || typeof value.$type === "string");

const identifier = /^[A-Za-z_$][\w$]*$/u;

const child = (path: string, key: string | number): string => {
  if (typeof key === "number") return `${path}[${String(key)}]`;
  return identifier.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every change from `before` to `after`, in document order, the first `limit` kept and the rest counted. */
export function diffValues(
  before: unknown,
  after: unknown,
  limit = defaultLimit,
): { readonly changes: readonly ValueChange[]; readonly more: number } {
  const changes: ValueChange[] = [];
  let count = 0;
  const push = (change: ValueChange): void => {
    count += 1;
    if (changes.length < limit) changes.push(change);
  };
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (Array.isArray(a) && Array.isArray(b)) {
      // by index: the common part walked, the rest added or removed
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const where = child(path, index);
        if (index >= b.length) push({ kind: "removed", path: where, before: a[index] });
        else if (index >= a.length) push({ kind: "added", path: where, after: b[index] });
        else walk(a[index], b[index], where);
      }
    } else if (!isLeaf(a) && !isLeaf(b) && isPlainObject(a) && isPlainObject(b)) {
      // by key: the keys of `a` in order (kept or removed), then the keys only `b` has
      for (const key of Object.keys(a)) {
        const where = child(path, key);
        if (Object.hasOwn(b, key)) walk(a[key], b[key], where);
        else push({ kind: "removed", path: where, before: a[key] });
      }
      for (const key of Object.keys(b))
        if (!Object.hasOwn(a, key)) push({ kind: "added", path: child(path, key), after: b[key] });
    } else if (!same(a, b)) push({ kind: "changed", path, before: a, after: b });
  };
  walk(before, after, "$");
  return { changes, more: count - changes.length };
}

const errorLine = (error: ErrorInfo | undefined): string | undefined =>
  error === undefined ? undefined : `${error.name}: ${error.message}`;

const withDuration = (before: ComparedRun, after: ComparedRun): RunComparison["durationMs"] => ({
  ...(before.durationMs === undefined ? {} : { before: before.durationMs }),
  ...(after.durationMs === undefined ? {} : { after: after.durationMs }),
});

function valueComparison(before: ComparedRun, after: ComparedRun, limit: number) {
  const a = lastValue(before.outputs);
  const b = lastValue(after.outputs);
  if (a === undefined && b === undefined) return null;
  const truncated = a?.truncated === true || b?.truncated === true;
  if (a === undefined)
    return { changes: [{ kind: "added", path: "$", after: b?.json }] as const, more: 0, truncated };
  if (b === undefined)
    return {
      changes: [{ kind: "removed", path: "$", before: a.json }] as const,
      more: 0,
      truncated,
    };
  return { ...diffValues(a.json, b.json, limit), truncated };
}

/** The printed lines' diff; a run that printed nothing has no lines (not one empty line). */
function printedDiff(before: string, after: string): readonly DiffLine[] {
  if (before === "" && after === "") return [];
  if (before === "")
    return after.split("\n").map((text, index) => ({ kind: "added", text, after: index + 1 }));
  if (after === "")
    return before.split("\n").map((text, index) => ({ kind: "removed", text, before: index + 1 }));
  return lineDiff(before, after);
}

/** What changed from the `before` run to the `after` run of one cell. */
export function compareRuns(
  before: ComparedRun,
  after: ComparedRun,
  limit = defaultLimit,
): RunComparison {
  const value = valueComparison(before, after, limit);
  const beforeText = printed(before.outputs);
  const afterText = printed(after.outputs);
  const text = printedDiff(beforeText, afterText);
  const errorBefore = errorLine(before.error);
  const errorAfter = errorLine(after.error);
  const error = {
    ...(errorBefore === undefined ? {} : { before: errorBefore }),
    ...(errorAfter === undefined ? {} : { after: errorAfter }),
  };
  const unchanged =
    before.status === after.status &&
    (value === null || value.changes.length === 0) &&
    text.every((line) => line.kind === "same") &&
    errorBefore === errorAfter;
  return {
    same: unchanged,
    status: { before: before.status, after: after.status },
    durationMs: withDuration(before, after),
    value,
    text,
    error,
  };
}
