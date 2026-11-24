// Tests of paths.ts: parse, format, parent and join, with table tests (paths.property.test.ts has the properties).
import { describe, expect, it } from "vitest";

import type { PathSegment } from "./paths.ts";
import { formatPath, isShorthandName, joinPath, parentPath, parsePath } from "./paths.ts";

describe("parsePath", () => {
  it.each<[string, PathSegment[]]>([
    ["$", []],
    ["$['data'][3]", ["data", 3]],
    ["$.data[3].metadata", ["data", 3, "metadata"]],
    [`$["first name"][0]`, ["first name", 0]],
    ["$['it\\'s']['\\n']", ["it's", "\n"]],
    ["$.é_1.ü", ["é_1", "ü"]],
    ["$[0][10][9007199254740991]", [0, 10, 9007199254740991]],
    ["$['']", [""]],
  ])("reads %s", (path, segments) => {
    expect(parsePath(path)).toEqual({ ok: true, value: segments });
  });
});

describe("parsePath on invalid paths", () => {
  it.each<[string, number]>([
    ["", 0],
    ["data", 0],
    ["$.", 1],
    ["$[", 1],
    ["$['a'", 1],
    ["$['a]", 1],
    ["$[01]", 1],
    ["$[-1]", 1],
    ["$[9007199254740992]", 1],
    ["$.0", 1],
    ["$.a b", 3],
    ["$.a[*]", 3],
    ["$..a", 1],
    ["$['\\x']", 1],
  ])("rejects %j at position %i", (path, position) => {
    const result = parsePath(path);
    expect(result).toMatchObject({ ok: false, error: { kind: "syntax", position } });
  });

  it("says what a path looks like when the root is missing", () => {
    const result = parsePath("data[0]");
    expect(result.ok ? "" : result.error.message).toBe(
      'A path starts with "$", as in $.data[3]; "data[0]" does not.',
    );
  });

  it("names the position and the accepted steps for a bad segment", () => {
    const result = parsePath("$.a b");
    expect(result.ok ? "" : result.error.message).toBe(
      `The path "$.a b" is invalid at position 3; write each step as .name, ['name'] or [index].`,
    );
  });
});

describe("formatPath", () => {
  it.each<[PathSegment[], string]>([
    [[], "$"],
    [["data", 3], "$['data'][3]"],
    [["it's", "a\\b", "\n\u0001"], "$['it\\'s']['a\\\\b']['\\n\\u0001']"],
  ])("writes %j as %s", (segments, path) => {
    expect(formatPath(segments)).toBe(path);
  });
});

describe("parentPath", () => {
  it.each([
    ["$['data'][3]", "$['data']"],
    ["$.data", "$"],
    ["$", undefined],
    ["data", undefined],
  ])("of %s is %s", (path, parent) => {
    expect(parentPath(path)).toBe(parent);
  });
});

describe("joinPath", () => {
  it("appends segments and normalizes the result", () => {
    expect(joinPath("$.data", 3, "first name")).toBe("$['data'][3]['first name']");
  });

  it("is undefined for a path that does not parse", () => {
    expect(joinPath("data", 1)).toBeUndefined();
  });
});

describe("isShorthandName", () => {
  it.each([
    ["status", true],
    ["_x1", true],
    ["é", true],
    ["😀", true],
    ["", false],
    ["1a", false],
    ["first name", false],
    ["a-b", false],
    ["\uD800", false],
  ])("%j is %s", (name, expected) => {
    expect(isShorthandName(name)).toBe(expected);
  });
});
