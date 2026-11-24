// The answer of kernel.log as the Kernel log tab reads it: its shape alone, anything else is no answer.
import { describe, expect, it } from "vitest";

import { kernelLogOf } from "./kernelLog.js";

describe("kernelLogOf", () => {
  it("reads only kernel.log's shape", () => {
    expect(kernelLogOf(null)).toBeUndefined();
    expect(kernelLogOf(undefined)).toBeUndefined();
    expect(kernelLogOf("log")).toBeUndefined();
    expect(kernelLogOf({ path: 1, lines: ["x"], truncated: false })).toBeUndefined();
    expect(kernelLogOf({ path: "/a", lines: [1], truncated: false })).toBeUndefined();
    expect(kernelLogOf({ path: "/a", lines: "x", truncated: false })).toBeUndefined();
    expect(kernelLogOf({ path: "/a", lines: ["x"] })).toBeUndefined();
    expect(kernelLogOf({ path: "/a", lines: ["x"], truncated: false, more: 1 })).toEqual({
      path: "/a",
      lines: ["x"],
      truncated: false,
    });
  });
});
