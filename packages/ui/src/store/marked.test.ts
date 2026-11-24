// markedOf: the range from the anchor to the selected cell, in order, whichever end is above.
import type { Cell } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { markedOf, neighbourOf } from "./marked.js";

const order = ["a", "b", "c", "d"].map((id) => ({ id }) as Cell);
const ids = (cells: readonly Cell[]) => cells.map((cell) => cell.id);

describe("markedOf", () => {
  it("is the selected cell alone with no anchor, or an anchor no longer in the notebook", () => {
    expect(ids(markedOf(order, "b", null))).toEqual(["b"]);
    expect(ids(markedOf(order, "b", "gone"))).toEqual(["b"]);
  });

  it("runs from the anchor to the selected cell in order, either way round", () => {
    expect(ids(markedOf(order, "c", "a"))).toEqual(["a", "b", "c"]);
    expect(ids(markedOf(order, "a", "c"))).toEqual(["a", "b", "c"]);
    expect(ids(markedOf(order, "d", "d"))).toEqual(["d"]);
  });

  it("is empty with no cell selected, or one the notebook no longer has", () => {
    expect(markedOf(order, null, "a")).toEqual([]);
    expect(markedOf(order, "gone", "a")).toEqual([]);
  });
});

describe("neighbourOf", () => {
  const before = ["a", "b", "c", "d"];
  it("is the nearest cell above that is still there, else the nearest below, else none", () => {
    expect(neighbourOf(before, new Set(["a", "c", "d"]), "b")).toBe("a");
    expect(neighbourOf(before, new Set(["a", "d"]), "c")).toBe("a");
    expect(neighbourOf(before, new Set(["b", "c", "d"]), "a")).toBe("b");
    expect(neighbourOf(before, new Set(["d"]), "b")).toBe("d");
    expect(neighbourOf(before, new Set(), "b")).toBeNull();
  });
});
