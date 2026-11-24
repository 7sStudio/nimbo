// The values a server cell can show at its lines' ends: the scope's variables by name in a short form, none for
// functions, classes or imports, none once its text changed or its run failed.
import type { Binding } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { shortOf, showsValues, valuesOf } from "./lineValues.js";

const binding = (name: string, preview: string, kind: Binding["kind"] = "const"): Binding => ({
  name,
  kind,
  preview,
  definedBy: "c_aaaaaa",
  exported: false,
});

describe("shortOf", () => {
  it("keeps a short preview, and gives a long one its shape", () => {
    expect(shortOf("2")).toBe("2");
    expect(shortOf("[ 1, 2, 3 ]")).toBe("[1, 2, 3]");
    expect(shortOf("[ 1, 2, ... 3 more items ]")).toBe("Array(5)");
    expect(shortOf("{ a: 1 }")).toBe("{a: 1}");
    expect(shortOf("[ 100000, 200000, 300000, 400000, 500000, ... 2995 more items ]")).toBe(
      "Array(3000)",
    );
    expect(shortOf("[ 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbb', 'ccccccccccccc' ]")).toBe(
      "Array(3)",
    );
    expect(
      shortOf("{ id: 'ord_1', total: 1200, items: [Array], customer: [Object], 'created-at': 1 }"),
    ).toBe("{id, total, items, customer, …}");
    expect(shortOf("{ id: 'ord_1', total: 1200, items: [Array], ... 4 more items }")).toBe(
      "{id, total, items, …}",
    );
    expect(shortOf("Stripe { _api: [Object], customers: [Customers], charges: [Charges] }")).toBe(
      "Stripe {…}",
    );
    expect(shortOf("Map(2) { 'alpha-key' => [Object], 'beta-key' => [Object] }")).toBe(
      "Map(2) {…}",
    );
    expect(shortOf(`'${"x".repeat(60)}'`)).toBe(`'${"x".repeat(37)}…'`);
  });
});

describe("valuesOf", () => {
  it("keeps the scope's variables by name, not its functions, classes, imports or function values", () => {
    const values = valuesOf([
      binding("total", "42"),
      binding("n", "1", "let"),
      binding("f", "[Function: f]", "function"),
      binding("A", "[class A]", "class"),
      binding("Stripe", "[class Stripe]", "import"),
      binding("g", "[AsyncFunction: g]"),
      binding("K", "[class K extends A]"),
    ]);
    expect([...values.values()]).toEqual([
      { name: "total", text: "42", full: "42" },
      { name: "n", text: "1", full: "1" },
    ]);
  });
});

describe("showsValues", () => {
  it("shows values for a server cell whose run ended well and whose text is what ran", () => {
    expect(showsValues({ status: "ok", type: "server" }, false)).toBe(true);
    expect(showsValues({ status: "ok", type: "server" }, true)).toBe(false);
    expect(showsValues({ status: "error", type: "server" }, false)).toBe(false);
    expect(showsValues({ status: "ok", type: "client" }, false)).toBe(false);
  });
});
