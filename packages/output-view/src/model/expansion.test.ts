// Tests expansion.ts: default depth, toggles, ⌘-toggles of subtrees and revealing a path.
import { describe, expect, it } from "vitest";

import {
  collapseAll,
  deepOf,
  expandAll,
  expansion,
  isOpen,
  revealPath,
  toggle,
  toggleDeep,
} from "./expansion.js";

const node = (id: string, depth: number) => ({ id, depth });

describe("expansion", () => {
  it("opens nodes shallower than the depth, 2 by default", () => {
    const state = expansion();
    expect([
      isOpen(state, node("$", 0), undefined, false),
      isOpen(state, node("$.a", 1), undefined, false),
      isOpen(state, node("$.a.b", 2), undefined, false),
    ]).toEqual([true, true, false]);
  });

  it("opens everything or only the root", () => {
    expect(isOpen(expandAll(), node("$.a.b.c.d", 4), undefined, false)).toBe(true);
    expect([
      isOpen(collapseAll(), node("$", 0), undefined, false),
      isOpen(collapseAll(), node("$.a", 1), undefined, false),
    ]).toEqual([true, false]);
  });
});

describe("toggle", () => {
  it("flips one node and keeps the user's choice over a reveal", () => {
    const closed = toggle(expansion(), { id: "$.a", expanded: true });
    expect(isOpen(closed, node("$.a", 1), undefined, true)).toBe(false);
    expect(
      isOpen(toggle(closed, { id: "$.a", expanded: false }), node("$.a", 1), undefined, false),
    ).toBe(true);
  });

  it("opens a node a search or a query reveals", () => {
    expect(isOpen(expansion(0), node("$.a", 1), undefined, true)).toBe(true);
  });
});

describe("toggleDeep", () => {
  it("opens a whole subtree and forgets the toggles inside it, not beside it", () => {
    let state = toggle(expansion(1), { id: "$.a.b", expanded: true });
    state = toggle(state, { id: "$.ab", expanded: true });
    state = toggleDeep(state, { id: "$.a", expanded: false });
    expect([...state.overrides.keys()]).toEqual(["$.ab"]);
    expect(deepOf(state, "$.a", undefined)).toBe(true);
    expect(isOpen(state, node("$.a.b.c", 3), deepOf(state, "$.a", undefined), false)).toBe(true);
  });

  it("closes a subtree that was open", () => {
    const state = toggleDeep(expandAll(), { id: "$", expanded: true });
    expect(isOpen(state, node("$.x", 1), deepOf(state, "$", undefined), false)).toBe(false);
  });
});

describe("revealPath", () => {
  it("opens every node on the way to a path", () => {
    const state = revealPath(expansion(0), ["data", 3, "x"]);
    expect([...state.overrides.entries()]).toEqual([
      ["$", true],
      ["$.data", true],
      ["$.data[3]", true],
    ]);
  });
});
