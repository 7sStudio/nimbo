// Tests compareRuns (cell.compare): value paths added, removed and changed with arrays by index and markers whole, the
// printed lines, the error and the cap on changes.
import { describe, expect, it } from "vitest";

import type { Output } from "../model/output.js";
import type { ComparedRun } from "./compareRuns.js";
import { compareRuns, diffValues, lastValue } from "./compareRuns.js";

const value = (json: unknown, truncated = false): Output => ({
  kind: "value",
  json,
  repr: "",
  truncated,
});
const run = (outputs: Output[], extra: Partial<ComparedRun> = {}): ComparedRun => ({
  status: "ok",
  outputs,
  ...extra,
});

describe("diffValues", () => {
  it("names changed, added and removed paths in document order", () => {
    const before = { a: 1, list: [1, 2, 3], "odd key": { x: true }, gone: null };
    const after = { a: 2, list: [1, 5], "odd key": { x: true, y: "n" }, extra: [] };
    expect(diffValues(before, after).changes).toEqual([
      { kind: "changed", path: "$.a", before: 1, after: 2 },
      { kind: "changed", path: "$.list[1]", before: 2, after: 5 },
      { kind: "removed", path: "$.list[2]", before: 3 },
      { kind: "added", path: '$["odd key"].y', after: "n" },
      { kind: "removed", path: "$.gone", before: null },
      { kind: "added", path: "$.extra", after: [] },
    ]);
  });

  it("compares a wire marker whole and a type change at its path", () => {
    const date = (iso: string) => ({ $type: "date", iso });
    expect(diffValues({ d: date("2026-01-01") }, { d: date("2026-01-02") }).changes).toEqual([
      { kind: "changed", path: "$.d", before: date("2026-01-01"), after: date("2026-01-02") },
    ]);
    expect(diffValues([1], { 0: 1 }).changes).toEqual([
      { kind: "changed", path: "$", before: [1], after: { 0: 1 } },
    ]);
  });

  it("keeps the first `limit` changes and counts the rest", () => {
    const result = diffValues(
      Array.from({ length: 10 }, () => 0),
      Array.from({ length: 10 }, () => 1),
      3,
    );
    expect(result.changes).toHaveLength(3);
    expect(result.more).toBe(7);
  });
});

describe("compareRuns", () => {
  it("is the same when only the duration differs", () => {
    const outputs = [{ kind: "stream", stream: "stdout", text: "a\n" } as const, value({ n: 1 })];
    const result = compareRuns(run(outputs, { durationMs: 1 }), run(outputs, { durationMs: 9 }));
    expect(result.same).toBe(true);
    expect(result.durationMs).toEqual({ before: 1, after: 9 });
    expect(result.text).toEqual([{ kind: "same", text: "a", before: 1, after: 1 }]);
  });

  it("reads the last value, a display.table's JSON included, and the error", () => {
    const table: Output = {
      kind: "display",
      mime: "application/vnd.jsnb.table+json",
      data: JSON.stringify([{ id: 1 }]),
    };
    expect(lastValue([value(1), table])?.json).toEqual([{ id: 1 }]);
    const error = { name: "TypeError", message: "boom", frames: [], raw: "" };
    const result = compareRuns(run([value(1, true)]), run([], { status: "error", error }));
    expect(result.same).toBe(false);
    expect(result.status).toEqual({ before: "ok", after: "error" });
    expect(result.value).toEqual({
      changes: [{ kind: "removed", path: "$", before: 1 }],
      more: 0,
      truncated: true,
    });
    expect(result.error).toEqual({ after: "TypeError: boom" });
    expect(compareRuns(run([]), run([])).value).toBeNull();
  });
});
