import { describe, expect, it } from "vitest";

import { revealDelta } from "./reveal.js";

const view = { top: 100, bottom: 600 };
const room = { above: 4, below: 40 };

describe("revealDelta", () => {
  it("leaves a cell that shows whole with its room", () => {
    expect(revealDelta({ top: 200, bottom: 500 }, view, room)).toBe(0);
  });

  it("scrolls a cell cut by the bottom edge up to the room below it", () => {
    expect(revealDelta({ top: 500, bottom: 620 }, view, room)).toBe(60);
  });

  it("scrolls a cell above the view down to the room above it", () => {
    expect(revealDelta({ top: 50, bottom: 150 }, view, room)).toBe(-54);
  });

  it("puts the top of a cell taller than the room at the room's top, either way", () => {
    expect(revealDelta({ top: 300, bottom: 900 }, view, room)).toBe(196);
    expect(revealDelta({ top: -400, bottom: 300 }, view, room)).toBe(-504);
    // fits the view but not the view less the room: still from its top
    expect(revealDelta({ top: 150, bottom: 620 }, view, room)).toBe(46);
  });
});
