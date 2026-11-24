// Tests of key.ts: chip keys to segments and back, in shorthand.
import { describe, expect, it } from "vitest";

import type { PathSegment } from "../paths.ts";
import { formatKey, keySegments, shorthandPath } from "./key.ts";

describe("keySegments", () => {
  it.each<[string, PathSegment[]]>([
    ["status", ["status"]],
    ["metadata.order_id", ["metadata", "order_id"]],
    ["items[0].price", ["items", 0, "price"]],
    ["['first name']", ["first name"]],
    ["[3]", [3]],
    ["first name", ["first name"]],
    ["a.", ["a."]],
    ["", [""]],
    ["items[-1]", ["items[-1]"]],
  ])("reads %j as %j", (key, segments) => {
    expect(keySegments(key)).toEqual(segments);
  });
});

describe("formatKey", () => {
  it.each<[PathSegment[], string]>([
    [["status"], "status"],
    [["metadata", "order_id"], "metadata.order_id"],
    [["items", 0, "price"], "items[0].price"],
    [["first name", "x"], "['first name'].x"],
    [[0, "a"], "[0].a"],
  ])("writes %j as %s", (segments, key) => {
    expect(formatKey(segments)).toBe(key);
  });
});

describe("shorthandPath", () => {
  it("writes a singular path in shorthand and leaves anything else as it is", () => {
    expect(shorthandPath("$['data'][0]['line items']")).toBe("$.data[0]['line items']");
    expect(shorthandPath("$.data[*]")).toBe("$.data[*]");
  });
});
