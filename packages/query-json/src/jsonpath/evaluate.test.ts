// Tests of evaluate.ts: syntax and type errors as QueryErrors, the cost classification, failures while selecting.
import { describe, expect, it } from "vitest";

import { compileJsonPath, selectPaths, selectPathsBefore } from "./evaluate.ts";

describe("compileJsonPath", () => {
  it("accepts a valid query", () => {
    expect(compileJsonPath(`$.data[?@.amount > 1000 && search(@.id, "^ch_")]`)).toEqual({
      ok: true,
      value: { linear: false },
    });
  });

  it("points at the first character the grammar cannot take, with what it expected", () => {
    expect(compileJsonPath("$.a]")).toEqual({
      ok: false,
      error: {
        kind: "syntax",
        message:
          'JSONPath syntax error at position 3: unexpected "]"; expected "[", "*", "_", ".", "..". Fix the query at the marked position.',
        position: 3,
      },
    });
  });

  it("says when the query ends too early", () => {
    const result = compileJsonPath("$.a[");
    expect(result).toMatchObject({ ok: false, error: { kind: "syntax", position: 4 } });
    expect(result.ok ? "" : result.error.message).toMatch(
      /^JSONPath syntax error at position 4: unexpected end of query; expected "\[", "\*"/,
    );
  });

  it("reports a well-typedness error without a position", () => {
    expect(compileJsonPath("$[?length(@.*) < 3]")).toEqual({
      ok: false,
      error: {
        kind: "syntax",
        message:
          "Invalid JSONPath expression: Function length() requires ValueType argument, got non-singular query. Fix the query and run it again.",
      },
    });
  });
});

describe("compileJsonPath on long queries", () => {
  it("refuses a query over 10 000 characters, naming the limit and what to do", () => {
    expect(compileJsonPath(`$${".a".repeat(10_000)}`)).toEqual({
      ok: false,
      error: {
        kind: "syntax",
        message:
          "The JSONPath query is 20001 characters long, over the limit of 10000. Shorten it, for example by asking for fewer ids at a time.",
        position: 10_000,
      },
    });
  });

  it("gives a failed query over 500 characters its position without the expected tokens", () => {
    const query = `$${".a".repeat(300)}]`;
    expect(compileJsonPath(query)).toEqual({
      ok: false,
      error: {
        kind: "syntax",
        message:
          'JSONPath syntax error at position 601: unexpected "]". Fix the query at the marked position.',
        position: 601,
      },
    });
  });
});

describe("compileJsonPath cost classification (11-query §2)", () => {
  it.each([
    "$",
    "$.a.b",
    "$..id",
    "$..*",
    `$.data[?@.status == "succeeded" && @.amount > 1000]`,
    "$['a'][1][0:2][*]",
    "$[?@.a.b[0]]",
    "$[?@ == 1]",
    "$[?!(@.a > 1) || @.b == null]",
    "$[?@.a][?'x' == @.b]",
    "$..[?@.a == 1]",
  ])("runs %s in the calling thread: its cost is linear in the value", (query) => {
    expect(compileJsonPath(query)).toEqual({ ok: true, value: { linear: true } });
  });

  it.each([
    "$..a..b",
    "$[0,0]",
    "$[*,*]",
    "$['a','a']",
    "$..[0,0]",
    "$[?@.a == 1, ?@.a == 1]",
    "$['a',1][0:2][*]",
    "$[?count($[*]) > 0]",
    "$[?$.a]",
    "$[?@.a == $.b]",
    "$[?@.a == @.b]",
    "$[?@.a[*]]",
    "$[?@[?@.a]]",
    `$[?match(@, "a+")]`,
    `$[?search(@.a, "x")]`,
    "$[?length(@) > 1]",
    "$[?value(@.a) == 1]",
  ])("sends %s to the worker: its cost is not linear in the value", (query) => {
    expect(compileJsonPath(query)).toEqual({ ok: true, value: { linear: false } });
  });
});

describe("selectPaths", () => {
  it("returns normalized paths in document order", () => {
    expect(selectPaths({ a: [{ b: 1 }, { b: 2 }], "it's": 3 }, "$..b")).toEqual({
      ok: true,
      value: { paths: ["$['a'][0]['b']", "$['a'][1]['b']"] },
    });
  });

  it("turns a failure while reading the value into a runtime error", () => {
    const value = {
      get broken(): never {
        throw new Error("unreadable");
      },
    };
    expect(selectPaths(value, "$.broken")).toMatchObject({
      ok: false,
      error: {
        kind: "runtime",
        message: expect.stringMatching(
          /^The JSONPath query failed on this value \(.+\)\. Query a plain JSON value, or narrow the query to the part that fails\.$/,
        ) as unknown,
      },
    });
  });
});

describe("selectPathsBefore", () => {
  const wide = Array.from({ length: 5000 }, (_, index) => ({ id: index }));

  it("selects like selectPaths before its deadline", () => {
    const result = selectPathsBefore(wide, "$[?@.id < 2]", performance.now() + 60_000);
    expect(result).toEqual({ ok: true, value: { paths: ["$[0]", "$[1]"] } });
  });

  it.each([
    "$[?length(@) > 1]",
    `$[?match(@, "a.")]`,
    `$[?search(@, "b")]`,
    "$[?count(@.*) == 2]",
    "$[?value(@.a) == 1]",
    "$[?@ == null]",
    "$[1:3]",
    "$[-1]",
    "$..*",
  ])("selects %s exactly as selectPaths does", (query) => {
    const value = ["ab", "a", null, [1, 2], { a: 1, b: 2 }, "abc"];
    expect(selectPathsBefore(value, query, performance.now() + 60_000)).toEqual(
      selectPaths(value, query),
    );
  });

  it("gives up once its deadline has passed", () => {
    expect(selectPathsBefore(wide, "$..id", performance.now() - 1)).toBe("expired");
  });

  it("still reports a failure on the value as a runtime error", () => {
    const value = {
      get broken(): never {
        throw new Error("unreadable");
      },
    };
    expect(selectPathsBefore(value, "$.broken", performance.now() + 60_000)).toMatchObject({
      ok: false,
      error: { kind: "runtime" },
    });
  });
});
