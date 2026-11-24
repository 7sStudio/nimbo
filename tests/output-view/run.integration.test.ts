// output-view's query runs (model/run.ts: runQuery, loadMode, registerRows) on the real engines in Node: JSONPath and
// Filter chips, jq, and SQL on DuckDB, with the failures exactly as those engines give them.
import { loadMode, registerRows, runQuery } from "@jsnb/output-view/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNodeEngines } from "./engines.node.js";
import { failingEngineStub } from "./fixtures/failingEngineStub.js";

const engines = createNodeEngines();
beforeAll(async () => {
  await Promise.all([engines.jsonpath.load(), engines.jq.load(), engines.sql.load()]);
});
afterAll(() => engines.dispose());

const cancelled = (): AbortSignal => AbortSignal.abort();
const events = { data: [{ n: 1, ok: true }, { n: 2 }] };

describe("runQuery select", () => {
  it("runs JSONPath and reads the engine's normalized paths as segments", async () => {
    expect(
      await runQuery(engines, { mode: "jsonpath", text: "$.data[?@.n > 1]", json: events }),
    ).toEqual({
      ok: true,
      value: { kind: "select", query: "$.data[?@.n > 1]", paths: [["data", 1]] },
    });
  });

  it("compiles Filter chips with the host's compiler, under `at`, and runs that", async () => {
    const run = {
      mode: "filter",
      text: "",
      chips: [{ key: "ok", op: "exists" }],
      at: "$.data",
      json: events,
    } as const;
    expect(await runQuery(engines, run)).toEqual({
      ok: true,
      value: { kind: "select", query: "$.data[?@.ok]", paths: [["data", 0]] },
    });
  });
});

describe("runQuery select failures", () => {
  it("reports a syntax error with its position, a cancelled run and one past its time", async () => {
    const big = Array.from({ length: 200_000 }, (_, i) => ({ i }));
    const outcomes = await Promise.all([
      runQuery(engines, { mode: "jsonpath", text: "$[", json: {} }),
      runQuery(engines, { mode: "jsonpath", text: "$.a", json: { a: 1 }, signal: cancelled() }),
      runQuery(engines, { mode: "jsonpath", text: "$..*", json: big, timeoutMs: 1 }),
    ]);
    expect(outcomes).toMatchObject([
      { ok: false, error: { kind: "syntax", position: 2 } },
      { ok: false, error: { kind: "aborted" } },
      { ok: false, error: { kind: "timeout" } },
    ]);
  });
});

describe("runQuery transform", () => {
  it("runs jq and returns the new value and its count", async () => {
    expect(await runQuery(engines, { mode: "jq", text: ".data[] | .n", json: events })).toEqual({
      ok: true,
      value: { kind: "transform", value: [1, 2], count: 2 },
    });
  });

  it("reports a syntax error with its position, a cancelled run and one past its time", async () => {
    const outcomes = await Promise.all([
      runQuery(engines, { mode: "jq", text: ".[", json: {} }),
      runQuery(engines, { mode: "jq", text: ".a", json: { a: 1 }, signal: cancelled() }),
      runQuery(engines, {
        mode: "jq",
        text: "[range(100000000)] | length",
        json: null,
        timeoutMs: 20,
      }),
    ]);
    expect(outcomes).toMatchObject([
      { ok: false, error: { kind: "syntax", position: 1 } },
      { ok: false, error: { kind: "aborted" } },
      { ok: false, error: { kind: "timeout" } },
    ]);
  });
});

describe("runQuery SQL", () => {
  it("runs SQL with the row limit and returns the rows, the exact total and the cut", async () => {
    const outcome = await runQuery(engines, {
      mode: "sql",
      text: "SELECT * FROM range(25)",
      json: {},
      limit: 10,
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: { kind: "rows", total: 25, truncated: true },
    });
    expect(outcome.ok && outcome.value.kind === "rows" ? outcome.value.rows.length : 0).toBe(10);
  });

  it("turns DuckDB's rejection into the error, with its reason and position, and a cancelled one too", async () => {
    const outcomes = await Promise.all([
      runQuery(engines, { mode: "sql", text: "SELEC 1", json: {} }),
      runQuery(engines, { mode: "sql", text: "SELECT 1", json: {}, signal: cancelled() }),
    ]);
    expect(outcomes).toMatchObject([
      { ok: false, error: { kind: "query", position: 0 } },
      { ok: false, error: { kind: "cancelled" } },
    ]);
  });
});

describe("loadMode", () => {
  it("loads the engine behind each mode, SQL with the run's signal", async () => {
    const signal = new AbortController().signal;
    const loaded = await Promise.all([
      loadMode(engines, "filter"),
      loadMode(engines, "jsonpath"),
      loadMode(engines, "jq"),
      loadMode(engines, "sql", undefined, signal),
    ]);
    expect(loaded).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
  });

  it("refuses Filter with JSONPath but no chip compiler, and runs nothing", async () => {
    expect(await loadMode({ jsonpath: engines.jsonpath }, "filter")).toMatchObject({
      ok: false,
      error: { kind: "unavailable" },
    });
    const chipsOnly = { chips: engines.chips };
    const run = {
      mode: "filter",
      text: "",
      chips: [{ key: "a", op: "exists" }],
      json: {},
    } as const;
    expect(await runQuery(chipsOnly, run)).toMatchObject({
      ok: false,
      error: { message: "The filter engine is not available here." },
    });
  });
});

describe("a download that fails", () => {
  // no real engine fails its download on demand: failingEngineStub's SQL does
  it("is the bar's error, not a crash", async () => {
    expect(await loadMode(failingEngineStub(new Error("network")), "sql")).toEqual({
      ok: false,
      error: { kind: "runtime", message: "network" },
    });
  });
});

describe("registerRows", () => {
  it("registers rows as t with the binding's alias, and a Blob of JSON", async () => {
    expect(await registerRows(engines, [{ n: 1 }, { n: 2 }], "events")).toMatchObject({
      ok: true,
      value: { table: "t", alias: "events", rowCount: 2 },
    });
    expect(await registerRows(engines, new Blob(['[{"n":1}]']))).toMatchObject({
      ok: true,
      value: { table: "t", rowCount: 1 },
    });
  });

  it("says why rows that are not JSON could not be loaded", async () => {
    const outcome = await registerRows(engines, new Blob(["not json"]));
    expect(outcome).toMatchObject({ ok: false, error: { kind: "query" } });
    expect(outcome.ok ? "" : outcome.error.message).toContain("Malformed JSON");
  });
});
