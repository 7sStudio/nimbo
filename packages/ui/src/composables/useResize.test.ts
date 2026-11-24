// What a key and a drag do to a workbench region's size: the arrow pointing away from the region's window edge grows
// it, Home and End go to the bounds, Enter to the default; a drag measures from that edge to the pointer.
import { describe, expect, it } from "vitest";

import { dragSize, keySize } from "./useResize.js";

const bounds = { min: 13, max: 28 };

describe("keySize", () => {
  it("grows away from the region's edge by 1 rem and shrinks toward it", () => {
    expect(keySize("ArrowRight", 20, bounds, "left")).toBe(21);
    expect(keySize("ArrowLeft", 20, bounds, "left")).toBe(19);
    expect(keySize("ArrowLeft", 20, bounds, "right")).toBe(21);
    expect(keySize("ArrowRight", 20, bounds, "right")).toBe(19);
    expect(keySize("ArrowUp", 20, bounds, "bottom")).toBe(21);
    expect(keySize("ArrowDown", 20, bounds, "bottom")).toBe(19);
  });

  it("jumps to a bound or back to the default, and ignores other keys", () => {
    expect(keySize("Home", 20, bounds, "left")).toBe(13);
    expect(keySize("End", 20, bounds, "right")).toBe(28);
    expect(keySize("Enter", 20, bounds, "bottom")).toBe("default");
    expect(keySize("a", 20, bounds, "left")).toBeUndefined();
    expect(keySize("ArrowUp", 20, bounds, "left")).toBeUndefined();
  });
});

describe("dragSize", () => {
  const box = { left: 44, right: 1500, bottom: 900 };

  it("measures from the region's window edge to the pointer, in rem", () => {
    expect(dragSize(box, { clientX: 364, clientY: 0 }, "left", 16)).toBe(20);
    expect(dragSize(box, { clientX: 1180, clientY: 0 }, "right", 16)).toBe(20);
    expect(dragSize(box, { clientX: 0, clientY: 580 }, "bottom", 16)).toBe(20);
    expect(dragSize(box, { clientX: 364, clientY: 0 }, "left", 20)).toBe(16);
  });
});
