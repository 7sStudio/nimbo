// Tests chips.ts: Filter-mode chips, their keys, typed values and clause text.
import { describe, expect, it } from "vitest";

import {
  chipKey,
  chipOps,
  chipText,
  columnChip,
  isTextOp,
  keyPath,
  literalOf,
  makeChip,
} from "./chips.js";

describe("chipOps", () => {
  it("lists the ten operators, three of them on text", () => {
    expect(chipOps).toEqual([
      "=",
      "!=",
      ">",
      "<",
      ">=",
      "<=",
      "contains",
      "startsWith",
      "exists",
      "matches",
    ]);
    expect(chipOps.filter(isTextOp)).toEqual(["contains", "startsWith", "matches"]);
  });
});

describe("literalOf", () => {
  it("types JSON numbers and keywords and keeps any other text", () => {
    expect(["1000", "-2.5e3", "true", "false", "null", "-0"].map(literalOf)).toEqual([
      1000,
      -2500,
      true,
      false,
      null,
      -0,
    ]);
    expect(["01", "1e", "0x10", " 1", "Infinity", "succeeded", ""].map(literalOf)).toEqual([
      "01",
      "1e",
      "0x10",
      " 1",
      "Infinity",
      "succeeded",
      "",
    ]);
  });
});

describe("chip keys", () => {
  it("reads a key as a relative path, else as one member name", () => {
    expect([
      keyPath("metadata.order_id"),
      keyPath("$.items[0]"),
      keyPath("@['a b']"),
      keyPath("first name"),
    ]).toEqual([["metadata", "order_id"], ["items", 0], ["a b"], ["first name"]]);
  });

  it("writes the canonical form", () => {
    expect([
      chipKey(".status"),
      chipKey("first name"),
      chipKey("items[0].price"),
      chipKey("a-b"),
    ]).toEqual(["status", "['first name']", "items[0].price", "['a-b']"]);
  });
});

describe("makeChip", () => {
  it("types comparison values, keeps text for text operators, drops the value of exists", () => {
    expect(makeChip("amount", ">", "1000")).toEqual({ key: "amount", op: ">", value: 1000 });
    expect(makeChip("amount", "contains", "10")).toEqual({
      key: "amount",
      op: "contains",
      value: "10",
    });
    expect(makeChip("$.plan", "exists", "ignored")).toEqual({ key: "plan", op: "exists" });
  });
});

describe("chipText", () => {
  it("writes values bare when they read back as themselves", () => {
    expect([
      chipText({ key: "status", op: "=", value: "succeeded" }),
      chipText({ key: "amount", op: ">", value: 1000 }),
      chipText({ key: "x", op: "exists" }),
    ]).toEqual(["status = succeeded", "amount > 1000", "x exists"]);
    expect([
      chipText({ key: "n", op: "=", value: null }),
      chipText({ key: "z", op: "=", value: -0 }),
      chipText({ key: "id", op: "startsWith", value: "10" }),
    ]).toEqual(["n = null", "z = -0", "id startsWith 10"]);
  });

  it("quotes values that would read back otherwise", () => {
    expect([
      chipText({ key: "id", op: "=", value: "1000" }),
      chipText({ key: "a", op: "=", value: "x, y" }),
      chipText({ key: "a", op: "contains", value: " pad" }),
      chipText({ key: "a", op: "=", value: "" }),
    ]).toEqual(['id = "1000"', 'a = "x, y"', 'a contains " pad"', 'a = ""']);
  });
});

describe("columnChip", () => {
  it("is equality on a numeric column given a number, contains otherwise", () => {
    expect([
      columnChip("amount", " 2000 ", true),
      columnChip("amount", "20x", true),
      columnChip(0, "evt", false),
    ]).toEqual([
      { key: "amount", op: "=", value: 2000 },
      { key: "amount", op: "contains", value: "20x" },
      { key: "[0]", op: "contains", value: "evt" },
    ]);
  });
});
