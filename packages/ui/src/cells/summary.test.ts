// What a folded cell's name column says is inside it: lines, what it serves or exports, what its run returned, drew
// or printed, whether its result is pinned and who edited it; a markdown cell its prose.
import type { Output } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { Inside } from "./summary.js";
import { insideOf, shapeOf } from "./summary.js";

const value = (json: unknown): Output => ({ kind: "value", json, repr: "", truncated: false });
const cell = (patch: Partial<Inside> = {}): Inside => ({
  type: "server",
  source: "const a = 1;\na",
  meta: {},
  about: "",
  requests: null,
  outputs: [],
  live: false,
  pinned: false,
  ...patch,
});

describe("shapeOf", () => {
  it("says a value's shape in a few words, a class by its name", () => {
    expect(shapeOf({ $class: "Balance", object: "balance", available: [] })).toBe(
      "Balance with 2 keys",
    );
    expect(shapeOf({ a: 1 })).toBe("an object with 1 key");
    expect(shapeOf([1, 2, 3])).toBe("an array of 3");
    expect(shapeOf("abc")).toBe("3 characters");
    expect([shapeOf(42), shapeOf(true), shapeOf(null)]).toEqual(["42", "true", "null"]);
  });

  it("reads the wire form's markers, and says nothing of undefined", () => {
    expect(shapeOf({ $type: "map", entries: [[1, 2]] })).toBe("a Map of 1");
    expect(shapeOf({ $type: "set", values: [1, 2] })).toBe("a Set of 2");
    expect(shapeOf({ $type: "function", name: "f" })).toBe("a function");
    expect(shapeOf({ $type: "bytes", length: 70 })).toBe("70 bytes");
    expect(shapeOf({ $type: "number", value: "NaN" })).toBe("NaN");
    expect(shapeOf({ $type: "date", iso: null })).toBe("a date");
    expect(shapeOf({ $type: "map" })).toBe("a Map of 0");
    expect(shapeOf({ $type: "weird" })).toBe("a value");
    expect(shapeOf({ $type: "undefined" })).toBeNull();
  });
});

describe("insideOf", () => {
  it("says the lines, what the cell serves or exports and what its run returned", () => {
    expect(insideOf(cell({ outputs: [value([1, 2])] }))).toBe("2 lines, returns an array of 2");
    expect(insideOf(cell({ source: "x", about: "exported to client cells" }))).toBe(
      "1 line, exported to client cells",
    );
  });

  it("says a route cell's requests and the last one's status, not the disposer it returned", () => {
    const route = cell({ requests: { count: 2, last: 200 }, outputs: [value({ a: 1 })] });
    expect(insideOf(route)).toBe("2 lines, 2 requests, the last one 200");
    expect(insideOf(cell({ requests: { count: 0, last: null } }))).toBe("2 lines, 0 requests");
  });

  it("says a page, live or not, the lines printed and the pin", () => {
    const dom: Output = { kind: "dom", html: "<b>x</b>", text: "x" };
    expect(insideOf(cell({ type: "client", outputs: [dom], live: true, pinned: true }))).toBe(
      "2 lines, a page with its live elements, pinned to the inspector",
    );
    expect(insideOf(cell({ outputs: [dom] }))).toBe("2 lines, a page");
    const printed: Output = { kind: "stream", stream: "stdout", text: "a\nb\n" };
    expect(insideOf(cell({ outputs: [printed, value({ $type: "undefined" })] }))).toBe(
      "2 lines, printed 2 lines",
    );
  });
});

describe("insideOf and the last edit", () => {
  it("says who edited it last, and the lines of an agent edit to review first", () => {
    const dom: Output = { kind: "dom", html: "<b>x</b>", text: "x" };
    const at = "2026-11-14T14:02:00Z";
    expect(
      insideOf(cell({ meta: { lastEdit: { by: "agent", client: "mcp", agent: "claude", at } } })),
    ).toBe("2 lines, edited by claude");
    expect(insideOf(cell({ meta: { lastEdit: { by: "agent", client: "cli", at } } }))).toBe(
      "2 lines, edited by an agent over the CLI",
    );
    const review = {
      previousSource: "",
      previousType: "server",
      lines: [{ from: 1, to: 2 }],
    } as const;
    const pending = { by: "agent", client: "cli", at, review } as const;
    expect(insideOf(cell({ outputs: [dom], meta: { lastEdit: pending } }))).toBe(
      "2 lines, lines 1 to 2 changed by an agent, a page",
    );
  });

  it("says how much prose a markdown cell holds", () => {
    expect(insideOf(cell({ type: "markdown", source: "# Title\ntext\nmore" }))).toBe(
      "3 lines of prose",
    );
  });
});
