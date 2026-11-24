// Tests search.ts: keys and values found across every kind of node, with ranges, scope, limit and navigation.
import { beforeAll, describe, expect, it } from "vitest";

import type { SearchOptions, SearchResult } from "./search.js";
import { matchesById, search, step } from "./search.js";
import { localIso } from "./time.js";

// ICU loads its time zone data on a process's first DateTimeFormat (about 12 ms): setup, not any one test's time.
beforeAll(() => {
  localIso(0, "Europe/Paris");
});

const run = (json: unknown, query: string, options: SearchOptions = {}): SearchResult => {
  const outcome = search(json, query, { timeZone: "Europe/Paris", ...options });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
};
const found = (json: unknown, query: string, options?: SearchOptions): string[] =>
  run(json, query, options).matches.map((m) => `${m.in} ${m.id}`);

const payment = {
  id: "pi_1",
  customer: "cus_9",
  metadata: { cus_ref: 7, plan: "pro" },
  amount: 2000,
};

describe("search", () => {
  it("finds keys and values, case-insensitively, with ranges", () => {
    expect(found(payment, "CUS")).toEqual([
      "key $.customer",
      "value $.customer",
      "key $.metadata.cus_ref",
    ]);
    expect(run(payment, "cus").matches[1]?.ranges).toEqual([[0, 3]]);
  });

  it("limits the scope to keys or values", () => {
    expect(found(payment, "cus", { scope: "keys" })).toEqual([
      "key $.customer",
      "key $.metadata.cus_ref",
    ]);
    expect(found(payment, "cus", { scope: "values" })).toEqual(["value $.customer"]);
  });

  it("matches numbers by their digits only when the query could be a number", () => {
    expect(found(payment, "200")).toEqual(["value $.amount"]);
    expect(found([1, 2, true, null], "/^(1|true|null)$/")).toEqual([
      "value $[0]",
      "value $[2]",
      "value $[3]",
    ]);
  });

  it("reads markers as the tree shows them and never matches refs or truncation", () => {
    const json = {
      d: { $type: "date", iso: "2026-10-10T14:02:11.000Z" },
      b: { $type: "bigint", value: "12" },
      r: { $type: "ref", path: ["d"] },
      t: { $type: "truncated" },
    };
    expect(found(json, "16:02")).toEqual(["value $.d"]);
    expect(found(json, "12n")).toEqual(["value $.b"]);
    expect(found(json, "truncated")).toEqual([]);
  });
});

describe("search in Maps, Sets and instances", () => {
  it("matches Map keys on the entry's row and Set members by position", () => {
    const json = {
      $type: "map",
      entries: [
        ["plan", { $type: "set", values: ["pro"] }],
        [7, "seven"],
        [{ k: 1 }, "x"],
      ],
    };
    expect(found(json, "plan")).toEqual(["key $.entries[0][1]"]);
    expect(found(json, "pro")).toEqual(["value $.entries[0][1].values[0]"]);
    expect(found(json, "7")).toEqual(["key $.entries[1][1]"]);
  });

  it("skips an instance's $class and unescapes keys", () => {
    expect(found({ $class: "Price", $$type: "x" }, "$")).toEqual(["key $['$$type']"]);
  });
});

describe("search results", () => {
  it("keeps `limit` matches and counts them all", () => {
    const result = run(["a", "a", "a"], "a", { limit: 2 });
    expect([result.matches.length, result.total]).toEqual([2, 3]);
  });

  it("matches nothing for an empty query and reports a bad pattern", () => {
    expect(run(payment, "")).toEqual({ query: "", matches: [], total: 0 });
    expect(search(payment, "/(/").ok).toBe(false);
  });

  it("steps forward and back, wrapping around", () => {
    const result = run(["a", "a", "a"], "a");
    expect([
      step(result, 0, 1),
      step(result, 2, 1),
      step(result, 0, -1),
      step(run([], "a"), 0, 1),
    ]).toEqual([1, 0, 2, -1]);
  });

  it("groups matches by row", () => {
    const byId = matchesById(run({ ab: "ab" }, "a"));
    expect(byId.get("$.ab")?.map((m) => m.in)).toEqual(["key", "value"]);
  });
});
