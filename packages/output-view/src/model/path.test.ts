// Tests path.ts: the copy-path form, RFC 9535 normalized paths, parsing both, keys and ancestors.
import { describe, expect, it } from "vitest";

import {
  ancestorIds,
  formatKey,
  formatPath,
  isAncestor,
  normalizedPath,
  parseKey,
  parsePath,
  paths,
  scanString,
  segmentText,
} from "./path.js";

describe("formatPath", () => {
  it("writes shorthand names, brackets for other names and indexes", () => {
    expect(formatPath(["data", 3, "metadata"])).toBe("$.data[3].metadata");
    expect(formatPath(["first name", "$$type", "0", "é_1"])).toBe(
      "$['first name']['$$type']['0'].é_1",
    );
    expect(formatPath([])).toBe("$");
  });

  it("escapes quotes, backslashes and control characters in brackets", () => {
    expect(formatPath(["it's", "a\\b", "x\ny", "\u0001"])).toBe(
      "$['it\\'s']['a\\\\b']['x\\ny']['\\u0001']",
    );
  });
});

describe("normalizedPath", () => {
  it("writes every name in brackets (RFC 9535 §2.7)", () => {
    expect(normalizedPath(["data", 3])).toBe("$['data'][3]");
  });
});

describe("formatKey", () => {
  it("drops the $ and the first dot", () => {
    expect([
      formatKey(["metadata", "order_id"]),
      formatKey(["first name"]),
      formatKey([0, "a"]),
    ]).toEqual(["metadata.order_id", "['first name']", "[0].a"]);
  });
});

describe("segmentText", () => {
  it("writes one step", () => {
    expect([segmentText(2), segmentText("a"), segmentText("a b")]).toEqual([
      "[2]",
      ".a",
      "['a b']",
    ]);
  });
});

describe("parsePath", () => {
  it("reads the copy-path and the normalized forms", () => {
    expect(parsePath("$.data[3].metadata")).toEqual({ ok: true, value: ["data", 3, "metadata"] });
    expect(parsePath("$['data'][3][\"x y\"]")).toEqual({ ok: true, value: ["data", 3, "x y"] });
    expect(parsePath("$")).toEqual({ ok: true, value: [] });
  });

  it("decodes escapes in quoted names", () => {
    expect(parsePath(String.raw`$['a\'b\nA\/\\']`)).toEqual({ ok: true, value: ["a'b\nA/\\"] });
  });

  it("says where a path stops making sense", () => {
    expect(parsePath("data")).toEqual({
      ok: false,
      error: { message: 'A path starts with "$", as in $.data[3]; "data" does not.', position: 0 },
    });
    const bad = parsePath("$.a[01]");
    expect(bad.ok ? undefined : bad.error.position).toBe(3);
    expect(parsePath("$['open").ok).toBe(false);
    expect(parsePath("$['bad\\q']").ok).toBe(false);
    expect(parsePath("$['raw\u0001']").ok).toBe(false);
    expect(parsePath("$[99999999999999999999]").ok).toBe(false);
  });
});

describe("scanString", () => {
  it("reads either quote and refuses what is not a string", () => {
    expect(scanString(`"a\\"b"`, 0)).toEqual({ value: 'a"b', end: 6 });
    expect([scanString("x", 0), scanString("'\\u12'", 0)]).toEqual([undefined, undefined]);
  });
});

describe("parseKey", () => {
  it("reads relative paths and refuses other text", () => {
    expect([
      parseKey("metadata.order_id"),
      parseKey("['first name']"),
      parseKey("items[0]"),
    ]).toEqual([["metadata", "order_id"], ["first name"], ["items", 0]]);
    expect([parseKey("first name"), parseKey("")]).toEqual([undefined, undefined]);
  });
});

describe("isAncestor", () => {
  it("is true for a proper prefix only", () => {
    expect([
      isAncestor([], ["a"]),
      isAncestor(["a"], ["a", 1]),
      isAncestor(["a"], ["a"]),
      isAncestor(["b"], ["a", 1]),
    ]).toEqual([true, true, false, false]);
  });
});

describe("ancestorIds", () => {
  it("lists every proper prefix, the root first", () => {
    expect(ancestorIds(["data", 3, "x"])).toEqual(["$", "$.data", "$.data[3]"]);
    expect(paths.ancestors([])).toEqual([]);
  });
});
