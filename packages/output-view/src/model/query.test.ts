// Tests query.ts: the query bar's reducer, its pin (meta.outputQuery) and its history.
import { describe, expect, it } from "vitest";

import type { QueryResult } from "./query.js";
import {
  fromPin,
  historySize,
  initialQuery,
  pinOf,
  queryText,
  reduceQuery,
  resultCount,
  resultLabel,
  resultTime,
} from "./query.js";

const selected: QueryResult = { kind: "select", query: "$.a", paths: [["a"]] };
const done = reduceQuery(reduceQuery(initialQuery("jsonpath"), { type: "text", text: "$.a" }), {
  type: "succeeded",
  result: selected,
});

describe("reduceQuery editing", () => {
  it("starts closed and idle, with Only matches on", () => {
    expect(initialQuery("sql")).toMatchObject({
      mode: "sql",
      text: "",
      status: "idle",
      only: true,
      pinned: false,
    });
  });

  it("switches mode, clearing the text and the result; the same mode changes nothing", () => {
    const switched = reduceQuery(done, { type: "mode", mode: "jq" });
    expect(switched).toMatchObject({ mode: "jq", text: "", status: "idle", result: undefined });
    expect(reduceQuery(done, { type: "mode", mode: "jsonpath" })).toBe(done);
  });

  it("edits chips and the Only matches toggle", () => {
    const chips = [{ key: "a", op: "exists" as const }];
    expect(reduceQuery(initialQuery("filter"), { type: "chips", chips }).chips).toEqual(chips);
    expect(reduceQuery(done, { type: "only", only: false }).only).toBe(false);
  });

  it("goes back to the source on reset and keeps the query", () => {
    expect(reduceQuery({ ...done, pinned: true }, { type: "reset" })).toMatchObject({
      status: "idle",
      result: undefined,
      text: "$.a",
      pinned: false,
    });
  });
});

describe("reduceQuery running", () => {
  it("loads, runs and ends in a result or an error", () => {
    const loading = reduceQuery(initialQuery("sql"), { type: "loading" });
    const loaded = reduceQuery(loading, { type: "loaded", mode: "sql" });
    expect([loading.status, loaded.status, [...loaded.loaded]]).toEqual([
      "loading",
      "idle",
      ["sql"],
    ]);
    expect(
      reduceQuery(reduceQuery(done, { type: "running" }), { type: "loaded", mode: "jq" }).status,
    ).toBe("running");
    expect(reduceQuery(done, { type: "running" })).toMatchObject({
      status: "running",
      error: undefined,
    });
    expect(
      reduceQuery(
        { ...done, pinned: true },
        { type: "failed", error: { kind: "syntax", message: "x", position: 1 } },
      ),
    ).toMatchObject({
      status: "failed",
      result: undefined,
      error: { kind: "syntax", message: "x", position: 1 },
      pinned: false,
    });
  });
});

describe("reduceQuery history", () => {
  it("remembers each successful query once per mode, newest first, up to the history size", () => {
    let state = done;
    for (let i = 0; i < historySize + 5; i += 1)
      state = reduceQuery(reduceQuery(state, { type: "text", text: `$[${String(i % 60)}]` }), {
        type: "succeeded",
        result: selected,
      });
    state = reduceQuery(reduceQuery(state, { type: "text", text: "$[3]" }), {
      type: "succeeded",
      result: selected,
    });
    expect(state.history.jsonpath?.length).toBe(historySize);
    expect(state.history.jsonpath?.slice(0, 2)).toEqual(["$[3]", "$[54]"]);
  });
});

describe("pins", () => {
  it("pins a result, never a query that has not run", () => {
    expect(pinOf(reduceQuery(done, { type: "pin" }))).toEqual({ mode: "jsonpath", query: "$.a" });
    expect(pinOf(reduceQuery(initialQuery("jq"), { type: "pin" }))).toBeUndefined();
    expect(reduceQuery(reduceQuery(done, { type: "pin" }), { type: "unpin" }).pinned).toBe(false);
  });

  it("stores Filter mode as its Filter text and restores the chips", () => {
    const filter = reduceQuery(initialQuery("filter"), {
      type: "chips",
      chips: [{ key: "status", op: "=", value: "succeeded" }],
    });
    expect(queryText(filter)).toBe("status = succeeded");
    expect(fromPin({ mode: "filter", query: "status = succeeded" })).toMatchObject({
      mode: "filter",
      chips: [{ key: "status", op: "=", value: "succeeded" }],
      pinned: true,
    });
    expect(fromPin({ mode: "filter", query: "no operator" })).toMatchObject({
      chips: [],
      pinned: false,
    });
    expect(fromPin({ mode: "sql", query: "SELECT 1" })).toMatchObject({
      mode: "sql",
      text: "SELECT 1",
      pinned: true,
    });
  });
});

describe("resultLabel", () => {
  it("counts nodes, items and rows, with the SQL time and cap", () => {
    const sql = {
      kind: "rows" as const,
      columns: [],
      rows: [{}, {}],
      total: 48_120,
      truncated: true,
      durationMs: 41.2,
    };
    expect([
      resultLabel(selected),
      resultLabel({ kind: "transform", value: 1, count: 1 }),
      resultLabel(sql),
      resultLabel({ ...sql, total: 2, truncated: false }),
    ]).toEqual(["1 node", "1 item", "2 of 48,120 rows in 41 ms", "2 rows in 41 ms"]);
  });

  it("is the count and SQL's time, which the bar sets apart", () => {
    const sql = { kind: "rows" as const, columns: [], rows: [{}], total: 1, truncated: false };
    expect([
      [resultCount(selected), resultTime(selected)],
      [resultCount({ ...sql, durationMs: 0.4 }), resultTime({ ...sql, durationMs: 0.4 })],
      [resultCount({ ...sql, durationMs: 1234.5 }), resultTime({ ...sql, durationMs: 1234.5 })],
    ]).toEqual([
      ["1 node", undefined],
      ["1 row", "0 ms"],
      ["1 row", "1235 ms"],
    ]);
  });
});
