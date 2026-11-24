// Tests preview.ts: container labels and one-line previews within a width.
import { truncatedMarker } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { countLabel, plural, preview, thousands, typeLabel } from "./preview.js";

const line = (node: unknown, width?: number): string =>
  preview(node, width === undefined ? {} : { width })
    .map((t) => t.text)
    .join("");

describe("typeLabel", () => {
  it("names containers and nothing else", () => {
    expect([
      typeLabel([1, 2], "array"),
      typeLabel({ $type: "map", entries: [] }, "map"),
      typeLabel({ $type: "set", values: [1] }, "set"),
    ]).toEqual(["Array(2)", "Map(0)", "Set(1)"]);
    expect([
      typeLabel({ $class: "Price" }, "instance"),
      typeLabel({}, "object"),
      typeLabel("x", "string"),
    ]).toEqual(["Price", "Object", undefined]);
  });
});

describe("labels of a cut array", () => {
  it("count the items before the kernel's truncated marker, and + for the rest", () => {
    const cut = [1, 2, truncatedMarker];
    expect([typeLabel(cut, "array"), countLabel(cut, "array")]).toEqual(["Array(2+)", "2+ items"]);
    expect(countLabel([1, truncatedMarker], "array")).toBe("1+ items");
    // a lone marker is an element too deep to encode, not the rest of the array
    expect(typeLabel([truncatedMarker], "array")).toBe("Array(1+)");
    expect(typeLabel([truncatedMarker, truncatedMarker], "array")).toBe("Array(2+)");
  });
});

describe("plural", () => {
  it("writes the noun singular for one, and every other count plural", () => {
    expect([
      plural(0, "line", "lines"),
      plural(1, "line", "lines"),
      plural(1200, "row", "rows"),
    ]).toEqual(["0 lines", "1 line", "1,200 rows"]);
  });
});

describe("thousands", () => {
  it("puts a comma every three digits", () => {
    expect([thousands(0), thousands(999), thousands(48_120), thousands(1_234_567)]).toEqual([
      "0",
      "999",
      "48,120",
      "1,234,567",
    ]);
  });
});

describe("countLabel", () => {
  it("counts in words, singular for one", () => {
    expect([
      countLabel({ a: 1 }, "object"),
      countLabel([1, 2], "array"),
      countLabel({ $type: "map", entries: [[1, 2]] }, "map"),
      countLabel({ $type: "set", values: [] }, "set"),
    ]).toEqual(["1 key", "2 items", "1 entry", "0 values"]);
    expect(countLabel(Array.from({ length: 48_120 }), "array")).toBe("48,120 items");
    expect(countLabel(1, "number")).toBeUndefined();
  });
});

describe("preview", () => {
  it("shows a leaf as the tree does", () => {
    expect(line("text")).toBe('"text"');
  });

  it("shows a container's children on one line, nested containers by label", () => {
    expect(
      line({
        id: "evt_1",
        n: 2,
        meta: { a: 1 },
        list: [1],
        m: { $type: "map", entries: [] },
        p: { $class: "P", a: 1 },
        e: {},
      }),
    ).toBe('{ id: "evt_1", n: 2, meta: {…}, list: Array(1), m: Map(0), p: P {…}, e: {} }');
  });
});

describe("preview within a width", () => {
  it("keeps 24 characters of a string inside a container", () => {
    expect(line(["abcdefghijklmnopqrstuvwxyz"])).toBe('["abcdefghijklmnopqrstuvwx…"]');
  });

  it("ends with … when the width runs out", () => {
    expect(line({ a: "xxxxxxxxxx", b: "yyyyyyyyyy", c: "zzzzzzzzzz" }, 30)).toBe(
      '{ a: "xxxxxxxxxx", … }',
    );
  });

  it("frames Maps, Sets, instances and arrays, empty or not", () => {
    expect(
      line({
        $type: "map",
        entries: [
          ["a", 1],
          [{ id: 1 }, 2],
        ],
      }),
    ).toBe('Map(2) { "a" => 1, {…} => 2 }');
    expect(line({ $type: "set", values: ["pi"] })).toBe('Set(1) { "pi" }');
    expect(line({ $class: "Price", amount: 1 })).toBe("Price { amount: 1 }");
    expect([
      line([1, 2]),
      line([]),
      line({}),
      line({ $class: "P" }),
      line({ $type: "set", values: [] }),
    ]).toEqual(["[1, 2]", "[]", "{}", "P {}", "Set(0) {}"]);
  });
});
