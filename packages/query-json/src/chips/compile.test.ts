// Tests of compile.ts: each operator, escaping, keys, the filtered node and no chips.
import { describe, expect, it } from "vitest";

import { chipsToJsonPath } from "./compile.ts";
import type { Chip } from "./types.ts";

describe("chipsToJsonPath operators", () => {
  it.each<[Chip, string]>([
    [{ key: "status", op: "=", value: "succeeded" }, `$[?@.status == "succeeded"]`],
    [{ key: "status", op: "!=", value: "failed" }, `$[?@.status != "failed"]`],
    [{ key: "amount", op: ">", value: 1000 }, "$[?@.amount > 1000]"],
    [{ key: "amount", op: "<", value: -2.5 }, "$[?@.amount < -2.5]"],
    [{ key: "amount", op: ">=", value: 1e21 }, "$[?@.amount >= 1e+21]"],
    [{ key: "paid", op: "<=", value: true }, "$[?@.paid <= true]"],
    [{ key: "refund", op: "=", value: null }, "$[?@.refund == null]"],
    [{ key: "email", op: "contains", value: "@stripe" }, `$[?search(@.email, "@stripe")]`],
    [{ key: "id", op: "startsWith", value: "ch_" }, `$[?search(@.id, "^ch_")]`],
    [{ key: "id", op: "matches", value: "ch_[0-9]+" }, `$[?match(@.id, "ch_[0-9]+")]`],
    [{ key: "metadata", op: "exists" }, "$[?@.metadata]"],
  ])("compiles %j", (chip, query) => {
    expect(chipsToJsonPath([chip])).toBe(query);
  });

  it("joins several chips with && in one filter (gallery card 9)", () => {
    const chips: Chip[] = [
      { key: "status", op: "=", value: "succeeded" },
      { key: "amount", op: ">", value: 1000 },
    ];
    expect(chipsToJsonPath(chips)).toBe(`$[?@.status == "succeeded" && @.amount > 1000]`);
  });

  it("selects every child when there are no chips", () => {
    expect(chipsToJsonPath([])).toBe("$[*]");
    expect(chipsToJsonPath([], "$['data']")).toBe("$.data[*]");
  });
});

describe("chipsToJsonPath escaping", () => {
  it.each<[string, string]>([
    ["a.b", "a\\\\.b"],
    ["1+1=2?", "1\\\\+1=2\\\\?"],
    ["$5 (net)", "[$]5 \\\\(net\\\\)"],
    ["^[x]{2}|*\\", "\\\\^\\\\[x\\\\]\\\\{2\\\\}\\\\|\\\\*\\\\\\\\"],
    [`say "hi"\n`, `say \\"hi\\"\\n`],
  ])("escapes %j for search()", (text, pattern) => {
    expect(chipsToJsonPath([{ key: "s", op: "contains", value: text }])).toBe(
      `$[?search(@.s, "${pattern}")]`,
    );
  });

  it("escapes a string literal like JSON", () => {
    expect(chipsToJsonPath([{ key: "s", op: "=", value: `a"b\\c\u0001` }])).toBe(
      `$[?@.s == "a\\"b\\\\c\\u0001"]`,
    );
  });

  it("writes -0 as 0 and a number JSON cannot hold as null", () => {
    expect(chipsToJsonPath([{ key: "n", op: "=", value: -0 }])).toBe("$[?@.n == 0]");
    expect(chipsToJsonPath([{ key: "n", op: "=", value: Number.NaN }])).toBe("$[?@.n == null]");
  });
});

describe("chipsToJsonPath keys and the filtered node", () => {
  it.each<[string, string]>([
    ["metadata.order_id", "@.metadata.order_id"],
    ["items[0].price", "@.items[0].price"],
    ["['first name']", "@['first name']"],
    ["first name", "@['first name']"],
    ["it's", "@['it\\'s']"],
    ["", "@['']"],
    ["0", "@['0']"],
    ["[2]", "@[2]"],
    ["a.b c", "@['a.b c']"],
    ["é", "@.é"],
  ])("writes the key %j as %s", (key, node) => {
    expect(chipsToJsonPath([{ key, op: "exists" }])).toBe(`$[?${node}]`);
  });

  it("filters the children of another node, written in shorthand", () => {
    const chip: Chip = { key: "paid", op: "=", value: false };
    expect(chipsToJsonPath([chip], "$['data']")).toBe("$.data[?@.paid == false]");
    expect(chipsToJsonPath([chip], "$.data[0]['line items']")).toBe(
      "$.data[0]['line items'][?@.paid == false]",
    );
  });

  it("keeps a filtered node that is not a singular path as written", () => {
    expect(chipsToJsonPath([], "$..data")).toBe("$..data[*]");
  });
});
