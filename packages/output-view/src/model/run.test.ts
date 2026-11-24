// Tests run.ts without an engine: what a run says when an engine is missing, and how a rejection and the engine's paths
// are read. Every run on the real engines, with their answers and failures, and a download that fails, is tested in
// tests/output-view (run.integration.test.ts).
import { describe, expect, it } from "vitest";

import { loadMode, pathsOf, registerRows, rejected, runQuery } from "./run.js";

describe("runQuery without engines", () => {
  it("says which engine is missing", async () => {
    const json = {};
    const outcomes = await Promise.all([
      runQuery({}, { mode: "jsonpath", text: "$", json }),
      runQuery({}, { mode: "filter", text: "", json }),
      runQuery({}, { mode: "jq", text: ".", json }),
      runQuery({}, { mode: "sql", text: "x", json }),
    ]);
    expect(outcomes.map((o) => (o.ok ? "ok" : o.error.message))).toEqual([
      "The JSONPath engine is not available here.",
      "The filter engine is not available here.",
      "The jq engine is not available here.",
      "The sql engine is not available here.",
    ]);
  });
});

describe("loadMode and registerRows without engines", () => {
  it("fail as unavailable", async () => {
    expect(await loadMode({}, "jq")).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(await registerRows({}, [])).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  });
});

describe("rejected", () => {
  it("reads a QueryError's reason and position, and keeps the text of anything else thrown", () => {
    const queryError = Object.assign(new Error("Parser Error"), {
      position: 7,
      data: { reason: "query" },
    });
    expect([rejected(queryError), rejected("closed")]).toEqual([
      { ok: false, error: { kind: "query", message: "Parser Error", position: 7 } },
      { ok: false, error: { kind: "runtime", message: "closed" } },
    ]);
  });
});

describe("pathsOf", () => {
  it("reads normalized paths as segments and drops one that does not parse", () => {
    expect(pathsOf(["$['data'][0]", "not a path", "$"])).toEqual([["data", 0], []]);
  });
});
