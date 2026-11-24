// Tests the marker builders and the $ key escape of the wire form.
import { describe, expect, it } from "vitest";

import {
  bigintMarker,
  dateMarker,
  escapeKey,
  markerType,
  numberMarker,
  unescapeKey,
} from "./form.js";

describe("the markers", () => {
  it("name the special numbers and an invalid date", () => {
    expect(numberMarker(-0)).toEqual({ $type: "number", value: "-0" });
    expect(numberMarker(Number.NEGATIVE_INFINITY).value).toBe("-Infinity");
    expect(bigintMarker(10n).value).toBe("10");
    expect(dateMarker(new Date(Number.NaN)).iso).toBeNull();
  });

  it("are recognised by markerType", () => {
    expect(markerType({ $type: "ref" })).toBe("ref");
    expect(markerType({ $type: 1 })).toBeUndefined();
    expect(markerType({ a: 1 })).toBeUndefined();
  });
});

describe("escapeKey", () => {
  it("adds one $ to keys that start with $ and unescapeKey removes it", () => {
    expect(escapeKey("$type")).toBe("$$type");
    expect(escapeKey("plain")).toBe("plain");
    expect(unescapeKey("$$type")).toBe("$type");
    expect(unescapeKey("$class")).toBe("$class");
  });
});
