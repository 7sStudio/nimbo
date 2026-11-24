// Fold All's fold of the whole notebook, the cells opened under it, the pinned result and the caret: page-only state.
import { describe, expect, it } from "vitest";

import { foldState, isFolded, pinState } from "./fold.js";

describe("isFolded", () => {
  it("folds a cell by its own meta, or by Fold All unless it was opened", () => {
    const opened = new Set(["c_b"]);
    expect(isFolded({ id: "c_a", meta: { collapsed: true } }, false, opened)).toBe(true);
    expect(isFolded({ id: "c_a", meta: {} }, false, opened)).toBe(false);
    expect(isFolded({ id: "c_a", meta: {} }, true, opened)).toBe(true);
    expect(isFolded({ id: "c_b", meta: {} }, true, opened)).toBe(false);
    expect(isFolded({ id: "c_b", meta: { collapsed: true } }, true, opened)).toBe(true);
  });
});

describe("foldState", () => {
  it("folds all but the selected cell, opens and folds back one, and unfolds all", () => {
    const fold = foldState();
    fold.setFoldAll(true, "c_a");
    expect([fold.foldAll.value, [...fold.opened.value]]).toEqual([true, ["c_a"]]);
    fold.setOpened("c_b", true);
    fold.setOpened("c_a", false);
    expect([...fold.opened.value]).toEqual(["c_b"]);
    fold.setFoldAll(false, "c_a");
    expect([fold.foldAll.value, fold.opened.value.size]).toEqual([false, 0]);
    fold.setFoldAll(true, null);
    expect(fold.opened.value.size).toBe(0);
  });
});

describe("pinState", () => {
  it("pins one result at a time, a second press on it unpins, null unpins any", () => {
    const pin = pinState();
    pin.togglePin("c_a");
    expect(pin.pinned.value).toBe("c_a");
    pin.togglePin("c_b");
    expect(pin.pinned.value).toBe("c_b");
    pin.togglePin("c_b");
    expect(pin.pinned.value).toBeNull();
    pin.togglePin("c_a");
    pin.togglePin(null);
    expect(pin.pinned.value).toBeNull();
    pin.setCaretAt({ cell: "c_a", line: 2, column: 5 });
    expect(pin.caretAt.value).toEqual({ cell: "c_a", line: 2, column: 5 });
  });
});
