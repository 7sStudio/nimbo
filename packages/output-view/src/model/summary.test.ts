// Tests summary.ts: the summary line of every output.
import { describe, expect, it } from "vitest";

import type { ViewInput } from "./output.js";
import { formatBytes, jsonBytes, summarize, summaryParts, summaryText } from "./summary.js";

const line = (input: ViewInput): string => summaryText(summarize(input));
const value = (json: unknown, truncated = false): ViewInput => ({
  kind: "value",
  json,
  repr: "",
  truncated,
});

describe("summarize values", () => {
  it("names primitives without a size", () => {
    expect([
      line(value("hello")),
      line(value("x")),
      line(value(1)),
      line(value({ $type: "number", value: "NaN" })),
      line(value({ $type: "date", iso: null })),
    ]).toEqual(["string, 5 characters", "string, 1 character", "number", "number", "Date"]);
    expect(line(value({ $type: "bytes", length: 16, base64: "" }))).toBe("bytes, 16 B");
    expect([
      line(value({ $type: "error", name: "TypeError" })),
      line(value({ $type: "error" })),
    ]).toEqual(["TypeError", "Error"]);
  });

  it("labels, counts and sizes containers", () => {
    expect(line(value({ $class: "PaymentIntent", id: "pi_1" }))).toBe(
      "PaymentIntent, object, 1 key, 38 B",
    );
    expect(line(value([{ a: 1 }, { a: 2 }]))).toBe("Array, 2 rows, 1 column, 17 B");
    expect(line(value([1, 2, 3]))).toBe("Array, 3 items, 7 B");
    expect(line(value({ $type: "map", entries: [] }, true))).toBe(
      "Map, 0 entries, 28 B, truncated",
    );
  });

  it("names a plain object, a set and a function in words", () => {
    expect([
      line(value({ a: 1 })),
      line(value({ $type: "set", values: [1, 2] })),
      line(value({ $type: "function", name: "dispose" })),
      line(value({ $type: "function", name: "" })),
    ]).toEqual(["Object, 1 key, 7 B", "Set, 2 values, 30 B", "dispose, function", "function"]);
    expect(summaryParts(summarize(value({ $class: "Balance", a: 1 }, true)))).toBe(
      "object, 1 key, 26 B, truncated",
    );
  });
});

describe("summarize other outputs", () => {
  it("counts stream lines and names the rest", () => {
    expect(line({ kind: "stream", stream: "stderr", text: "a\nb\n" })).toBe(
      "Error output, 2 lines",
    );
    expect(line({ kind: "stream", stream: "stdout", text: "ready\n" })).toBe("Output, 1 line");
    const error = { name: "TypeError", message: "", frames: [], raw: "" };
    expect(line({ kind: "error", error, when: "run" })).toBe("TypeError, ended the run");
    expect(line({ kind: "error", error, when: "during" })).toBe("TypeError, during the run");
    expect(line({ kind: "error", error, when: "after" })).toBe("TypeError, after the run");
    expect(line({ kind: "error", error })).toBe("TypeError");
    expect(line({ kind: "display", mime: "text/html", data: "<b>" })).toBe("text/html");
    expect(line({ kind: "display", mime: "application/json", data: "[1]" })).toBe(
      "application/json, Array, 1 item, 3 B",
    );
    expect(line({ kind: "dom", html: "<p>hi</p>", text: "hi" })).toBe("Page, 2 characters of text");
    expect(line({ kind: "dom", html: "<p>!</p>", text: "!" })).toBe("Page, 1 character of text");
    expect(line({ kind: "event", name: "POST /webhook", data: null, at: "" })).toBe(
      "POST /webhook",
    );
  });
});

describe("formatBytes and jsonBytes", () => {
  it("write sizes in B, KB, MB and GB, and count UTF-8 bytes", () => {
    expect([
      formatBytes(312),
      formatBytes(2458),
      formatBytes(4.1 * 1024 * 1024),
      formatBytes(3 * 1024 ** 4),
    ]).toEqual(["312 B", "2.4 KB", "4.1 MB", "3072.0 GB"]);
    expect([jsonBytes("é"), jsonBytes(undefined)]).toEqual([4, 0]);
  });
});
