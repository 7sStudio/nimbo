// The last run's fact of a cell for each status, with its duration and when it started, its error's name and line, or
// its syntax error's place.
import type { Cell, Execution } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { runFact } from "./models.js";

const cell = (patch: Partial<Cell> = {}): Cell => ({
  id: "c1",
  type: "server",
  source: "1",
  index: 0,
  meta: {},
  status: "idle",
  stale: false,
  lastExecution: null,
  ...patch,
});
const run = (patch: Partial<Execution> = {}): Execution => ({
  id: "x1",
  cell: "c1",
  status: "ok",
  startedAt: "2026-11-02T10:00:00.000Z",
  outputs: [],
  ...patch,
});
const none = { elapsed: null, after: null };

describe("runFact", () => {
  it("reads each status, the duration from the execution or the summary", () => {
    const summary = {
      id: "x1",
      status: "ok" as const,
      startedAt: "2026-11-02T09:00:00.000Z",
      hasError: false,
      defines: [],
      durationMs: 5,
    };
    expect(runFact(cell(), undefined, none)).toEqual({ kind: "none" });
    expect(runFact(cell({ status: "ok", lastExecution: summary }), undefined, none)).toEqual({
      kind: "ok",
      ms: 5,
      at: "2026-11-02T09:00:00.000Z",
    });
    expect(runFact(cell({ status: "ok" }), undefined, none)).toEqual({
      kind: "ok",
      ms: null,
      at: null,
    });
    expect(runFact(cell({ status: "ok" }), run({ durationMs: 412 }), none)).toEqual({
      kind: "ok",
      ms: 412,
      at: "2026-11-02T10:00:00.000Z",
    });
  });
});

describe("runFact on a run that never started", () => {
  it("says Run all stopped it at the cell whose run failed, by that cell's number", () => {
    const stopped = run({ status: "interrupted", durationMs: 0, stoppedBy: "c_aaaaab" });
    const numberOf = (id: string) => (id === "c_aaaaab" ? 3 : 0);
    expect(runFact(cell({ status: "interrupted" }), stopped, { ...none, numberOf })).toEqual({
      kind: "notRun",
      stoppedAt: 3,
    });
    // the cell that failed is gone, or the page has no numbers to give
    expect(
      runFact(cell({ status: "interrupted" }), stopped, { ...none, numberOf: () => 0 }),
    ).toEqual({ kind: "notRun", stoppedAt: null });
    expect(runFact(cell({ status: "interrupted" }), stopped, none)).toEqual({
      kind: "notRun",
      stoppedAt: null,
    });
  });

  it("tells a run an interrupt took off the queue from one it stopped while it ran", () => {
    const cleared = run({ status: "interrupted", durationMs: 0 });
    expect(runFact(cell({ status: "interrupted" }), cleared, none)).toEqual({
      kind: "interrupted",
      ms: 0,
      unstarted: true,
    });
    const stream = { kind: "stream", stream: "stdout", text: "x" } as const;
    const stopped = run({ status: "interrupted", durationMs: 0, outputs: [stream] });
    expect(runFact(cell({ status: "interrupted" }), stopped, none)).toMatchObject({
      unstarted: false,
    });
    expect(
      runFact(
        cell({ status: "interrupted" }),
        run({ status: "interrupted", durationMs: 38 }),
        none,
      ),
    ).toEqual({ kind: "interrupted", ms: 38, unstarted: false });
  });
});

describe("runFact on a run that did not end", () => {
  it("reads a run that was interrupted, is going on or waits", () => {
    expect(runFact(cell({ status: "interrupted" }), undefined, none)).toEqual({
      kind: "interrupted",
      ms: null,
      unstarted: false,
    });
    expect(runFact(cell({ status: "running" }), undefined, none)).toEqual({
      kind: "running",
      elapsed: "0.0 s",
    });
    expect(
      runFact(cell({ status: "running" }), undefined, { elapsed: "1.2 s", after: null }),
    ).toEqual({ kind: "running", elapsed: "1.2 s" });
    expect(runFact(cell({ status: "queued" }), undefined, { elapsed: null, after: 4 })).toEqual({
      kind: "queued",
      after: 4,
    });
  });
});

describe("runFact on errors", () => {
  it("names a thrown error with the line of its first frame and places a syntax error", () => {
    const error = (name: string, frames: { cell?: string; line: number; col: number }[] = []) =>
      run({ status: "error", error: { name, message: "bad", raw: "", frames } });
    expect(runFact(cell({ status: "error" }), error("TypeError"), none)).toEqual({
      kind: "error",
      name: "TypeError",
      ms: null,
      line: null,
    });
    expect(
      runFact(
        cell({ status: "error" }),
        {
          ...error("RangeError", [
            { cell: "c1", line: 3, col: 7 },
            { cell: "c1", line: 9, col: 1 },
          ]),
          durationMs: 38,
        },
        none,
      ),
    ).toEqual({ kind: "error", name: "RangeError", ms: 38, line: 3 });
    expect(runFact(cell({ status: "error" }), undefined, none)).toEqual({
      kind: "error",
      name: "Error",
      ms: null,
      line: null,
    });
    expect(
      runFact(cell({ status: "error" }), error("SyntaxError", [{ line: 1, col: 11 }]), none),
    ).toEqual({
      kind: "syntax",
      place: { line: 1, col: 11, message: "bad" },
    });
  });
});

describe("runFact on a name a client cell defines", () => {
  it("offers ↩'s switch on a server cell's DefinedInClient only while it is a server cell", () => {
    const failed = run({
      status: "error",
      error: { name: "DefinedInClient", message: "m", raw: "", frames: [] },
    });
    expect(runFact(cell({ status: "error" }), failed, none)).toEqual({
      kind: "error",
      name: "DefinedInClient",
      ms: null,
      line: null,
      switchable: true,
    });
    expect(runFact(cell({ status: "error", type: "client" }), failed, none)).toEqual({
      kind: "error",
      name: "DefinedInClient",
      ms: null,
      line: null,
    });
  });
});

describe("runFact on a throw from elsewhere", () => {
  const thrown = (frames: { cell?: string; line: number; col: number }[]) =>
    run({ status: "error", error: { name: "RangeError", message: "bad", raw: "", frames } });

  it("names the line of this cell the error came through, not another cell's", () => {
    const through = thrown([
      { cell: "c0", line: 2, col: 1 },
      { cell: "c1", line: 7, col: 1 },
    ]);
    expect(runFact(cell({ status: "error" }), through, none)).toMatchObject({ line: 7 });
  });

  it("names no line when no frame is this cell's", () => {
    for (const frame of [
      { cell: "c0", line: 2, col: 1 },
      { line: 2, col: 1 },
    ])
      expect(runFact(cell({ status: "error" }), thrown([frame]), none)).toMatchObject({
        line: null,
      });
  });
});
