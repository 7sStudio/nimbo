// Tests of parse.ts: the queries chips can be read back from, and the ones they cannot.
import { describe, expect, it } from "vitest";

import { jsonPathToChips } from "./parse.ts";
import type { ChipFilter } from "./types.ts";

describe("jsonPathToChips", () => {
  it.each<[string, ChipFilter]>([
    ["$[*]", { at: "$", chips: [] }],
    ["$.data[ * ]", { at: "$.data", chips: [] }],
    [
      `$.data[?@.status == "succeeded" && @.amount > 1000]`,
      {
        at: "$.data",
        chips: [
          { key: "status", op: "=", value: "succeeded" },
          { key: "amount", op: ">", value: 1000 },
        ],
      },
    ],
    [
      `$['data'][?@['status']=='failed']`,
      { at: "$.data", chips: [{ key: "status", op: "=", value: "failed" }] },
    ],
    [
      "$[?@.a != null && @.b<=true&&@.c >= -0.5e1]",
      {
        at: "$",
        chips: [
          { key: "a", op: "!=", value: null },
          { key: "b", op: "<=", value: true },
          { key: "c", op: ">=", value: -5 },
        ],
      },
    ],
  ])("reads %s", (query, filter) => {
    expect(jsonPathToChips(query)).toEqual(filter);
  });
});

describe("jsonPathToChips on functions, keys and blank space", () => {
  it.each<[string, ChipFilter]>([
    [
      "$[?@.a < 1 && @.b > false]",
      {
        at: "$",
        chips: [
          { key: "a", op: "<", value: 1 },
          { key: "b", op: ">", value: false },
        ],
      },
    ],
    [
      `$[?search(@.id, "^ch_") && search(@.d, 'a\\\\.b[$]') && match(@.e, "x+")]`,
      {
        at: "$",
        chips: [
          { key: "id", op: "startsWith", value: "ch_" },
          { key: "d", op: "contains", value: "a.b$" },
          { key: "e", op: "matches", value: "x+" },
        ],
      },
    ],
    [
      `$[?@['first name'] && @.items[0]["unit price"] == 3]`,
      {
        at: "$",
        chips: [
          { key: "['first name']", op: "exists" },
          { key: "items[0]['unit price']", op: "=", value: 3 },
        ],
      },
    ],
    ["$[ ?\n@.a\t]", { at: "$", chips: [{ key: "a", op: "exists" }] }],
  ])("reads %s", (query, filter) => {
    expect(jsonPathToChips(query)).toEqual(filter);
  });
});

describe("jsonPathToChips on queries chips cannot express", () => {
  it.each([
    "",
    "data[*]",
    "$",
    "$.data",
    "$..data[*]",
    "$[*] ",
    "$[*].id",
    "$[?@.a == 1 || @.b == 2]",
    "$[?!@.a]",
    "$[?(@.a == 1)]",
    "$[?1 == @.a]",
    "$[?@ == 1]",
    "$[?@.a == $.b]",
    "$[?@.a == @.b]",
    "$[?@.a === 1]",
    "$[?@.a == 01]",
    "$[?@.a == 1e999]",
    "$[?@.a == tru]",
    "$[?@.a.* == 1]",
    "$[?length(@.a) > 1]",
    `$[?search(@.a, "a.b")]`,
    `$[?search(@.a, "a\\\\d")]`,
    `$[?search(@.a, "a$")]`,
    `$[?search(@.a, 1)]`,
    `$[?search(@.a "x")]`,
    `$[?search(@.a, "x"]`,
    `$[?match(@, "x")]`,
    "$[?@.a == 1",
    "$[?]",
  ])("rejects %j", (query) => {
    expect(jsonPathToChips(query)).toBeUndefined();
  });
});

describe("jsonPathToChips on long queries", () => {
  const chips = (count: number) =>
    Array.from({ length: count }, (_, index) => `@.n${String(index)} == ${String(index)}`);

  // how fast is parse.perf.test.ts's: a wall-clock assertion inside a unit test failed under the pool
  it("reads chips from a query close to the 10 000-character limit", () => {
    const query = `$[?${chips(580).join(" && ")}]`;
    expect(query.length).toBeLessThanOrEqual(10_000);
    expect(jsonPathToChips(query)?.chips.length).toBe(580);
  });

  it("gives up on a query over the limit at once", () => {
    const query = `$[?${chips(1000).join(" && ")}]`;
    expect(query.length).toBeGreaterThan(10_000);
    expect(jsonPathToChips(query)).toBeUndefined();
  });
});
