// Tests filter.ts: the Filter text of `--where` read into chips and written back.
import { describe, expect, it } from "vitest";

import type { Chip } from "./chips.js";
import type { FilterResult } from "./filter.js";
import { formatFilter, parseFilter } from "./filter.js";

const chips = (text: string): readonly Chip[] => {
  const result = parseFilter(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const error = (result: FilterResult): string =>
  result.ok ? "ok" : `${String(result.error.position)}: ${result.error.message}`;

describe("parseFilter", () => {
  it("reads the CLI's example", () => {
    expect(chips("status = succeeded, amount > 1000")).toEqual([
      { key: "status", op: "=", value: "succeeded" },
      { key: "amount", op: ">", value: 1000 },
    ]);
  });

  it("reads every operator, == as =, and nothing for blank text", () => {
    const text =
      "a == 1, b != x, c >= 2, d <= 3, e < 4, f > 5, g contains y, h startsWith z, i matches ^a.*, j exists";
    expect(chips(text).map((chip) => chip.op)).toEqual([
      "=",
      "!=",
      ">=",
      "<=",
      "<",
      ">",
      "contains",
      "startsWith",
      "matches",
      "exists",
    ]);
    expect(chips("   ")).toEqual([]);
  });

  it("keeps quoted values as strings and commas inside quotes and brackets", () => {
    expect(
      chips(`id = "1000", note = 'a, b', ['x, = y'] = 1, metadata.order_id startsWith "A-"`),
    ).toEqual([
      { key: "id", op: "=", value: "1000" },
      { key: "note", op: "=", value: "a, b" },
      { key: "['x, = y']", op: "=", value: 1 },
      { key: "metadata.order_id", op: "startsWith", value: "A-" },
    ]);
  });

  it("reads keys with spaces before a word operator as one name", () => {
    expect(chips("first name contains Ada")).toEqual([
      { key: "['first name']", op: "contains", value: "Ada" },
    ]);
  });
});

describe("parseFilter errors", () => {
  it("says what is missing and where", () => {
    expect(error(parseFilter("status succeeded"))).toBe(
      '0: No operator in "status succeeded"; use =, !=, >, <, >=, <=, contains, startsWith, matches or exists.',
    );
    expect(error(parseFilter("a = 1, = 2"))).toBe('7: A key is missing before "=" at position 7.');
    expect(error(parseFilter("a >"))).toBe('4: A value is missing after ">" at position 4.');
    expect(error(parseFilter("a exists b"))).toBe('9: "exists" takes no value; remove "b".');
    expect(error(parseFilter("a = 'open"))).toBe(
      "4: The quoted value at position 4 is not closed, or text follows it.",
    );
    expect(error(parseFilter("a = 1,, b = 2"))).toBe(
      "6: An empty condition at position 6; remove the extra comma.",
    );
  });
});

describe("formatFilter", () => {
  it("writes chips the parser reads back", () => {
    const list: Chip[] = [
      { key: "status", op: "=", value: "succeeded" },
      { key: "first name", op: "contains", value: "a, b" },
      { key: "id", op: "=", value: "42" },
      { key: "paid", op: "!=", value: false },
    ];
    expect(formatFilter(list)).toBe(
      `status = succeeded, ['first name'] contains "a, b", id = "42", paid != false`,
    );
    expect(chips(formatFilter(list))).toEqual([
      ...list.slice(0, 1),
      { ...list[1], key: "['first name']" },
      ...list.slice(2),
    ]);
  });
});
