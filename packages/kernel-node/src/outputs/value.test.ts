// Tests the value output: json, repr and truncated under the limits, and the full form retained when truncated.
import { describe, expect, it } from "vitest";

import { createRedactor } from "./redact.js";
import { serializeValue, valueOutput } from "./value.js";

const redact = createRedactor(["supersecretvalue"]);
const limits = { maxValueBytes: 262_144, retainFullValue: true, retainMaxBytes: 67_108_864 };
const small = { ...limits, maxValueBytes: 64 };
const list = Array.from({ length: 40 }, (_, index) => index);

describe("serializeValue", () => {
  it("encodes the value, inspects it and redacts both", () => {
    const value = { key: "supersecretvalue", when: new Date(0) };
    expect(serializeValue(value, limits, redact)).toEqual({
      json: { key: "***", when: { $type: "date", iso: "1970-01-01T00:00:00.000Z" } },
      repr: "{ key: '***', when: 1970-01-01T00:00:00.000Z }",
      truncated: false,
    });
  });

  it("truncates past maxValueBytes", () => {
    expect(serializeValue(list, small, redact).truncated).toBe(true);
  });
});

describe("valueOutput", () => {
  it("is a value output without a full form when nothing was cut", () => {
    expect(valueOutput(1, limits, redact)).toEqual({
      output: { kind: "value", json: 1, repr: "1", truncated: false },
    });
  });

  it("adds the uncapped form when the capped one is truncated and values are retained", () => {
    const { output, full } = valueOutput(list, small, redact);
    expect(output.kind === "value" && output.truncated).toBe(true);
    expect(full).toEqual({ json: list, truncated: false });
    expect(valueOutput(list, { ...small, retainFullValue: false }, redact).full).toBeUndefined();
  });

  it("drops the full form when walking the whole value throws a RangeError, and rethrows anything else", () => {
    const failing = (error: Error) => [
      ...list,
      {
        get boom(): never {
          throw error;
        },
      },
    ];
    const truncatedOnly = valueOutput(failing(new RangeError("deep")), small, redact);
    expect(truncatedOnly.full).toBeUndefined();
    expect(() => valueOutput(failing(new TypeError("getter")), small, redact)).toThrow("getter");
  });
});
