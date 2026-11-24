// Tests of literal.ts: reading and writing JSONPath string literals.
import { describe, expect, it } from "vitest";

import { quoteName, scanString } from "./literal.ts";

describe("scanString", () => {
  it.each([
    [`'abc'`, "abc"],
    [`"abc"`, "abc"],
    [`'it\\'s'`, "it's"],
    [`"say \\"hi\\""`, 'say "hi"'],
    [`'a"b'`, 'a"b'],
    [`"a'b"`, "a'b"],
    [`'\\b\\f\\n\\r\\t\\/\\\\'`, "\b\f\n\r\t/\\"],
    [`'\\u00e9\\u00E9'`, "éé"],
    [`'\\uD83D\\uDE00'`, "😀"],
    [`'😀 ok'`, "😀 ok"],
    [`''`, ""],
  ])("reads %s", (text, value) => {
    expect(scanString(text, 0)).toEqual({ value, end: text.length });
  });

  it("reads a literal in the middle of a text and reports where it ends", () => {
    expect(scanString(`x == 'a' && y`, 5)).toEqual({ value: "a", end: 8 });
  });

  it.each([
    ["abc"],
    [`'abc`],
    [`'a\\qb'`],
    [`'\\"'`],
    [`"\\'"`],
    [`'\\u12'`],
    [`'\\uDC00'`],
    [`'\\uD800'`],
    [`'\\uD800\\u0041'`],
    ["'a\u0001b'"],
    ["'a\nb'"],
  ])("rejects %j", (text) => {
    expect(scanString(text, 0)).toBeUndefined();
  });
});

describe("quoteName", () => {
  it.each([
    ["abc", `'abc'`],
    ["it's", `'it\\'s'`],
    ['a"b', `'a"b'`],
    ["back\\slash", `'back\\\\slash'`],
    ["\b\f\n\r\t", `'\\b\\f\\n\\r\\t'`],
    ["\u0000\u001f", `'\\u0000\\u001f'`],
    ["é😀/", `'é😀/'`],
  ])("writes %j as %s", (name, quoted) => {
    expect(quoteName(name)).toBe(quoted);
  });

  it("writes what scanString reads back", () => {
    const name = "a'b\\c\n\u0007é😀\"";
    expect(scanString(quoteName(name), 0)?.value).toBe(name);
  });
});
