// The workbench layout in localStorage: read, clamped, written, survivable when storage fails; and where each named
// place is, the panels' older names included.
import { describe, expect, it } from "vitest";

import {
  clampSize,
  defaultLayout,
  layoutKey,
  opened,
  placeOf,
  readLayout,
  showing,
  withOpen,
  writeLayout,
} from "./layout.js";

const storage = (value: string | null) => ({ getItem: () => value });
const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
};

describe("the workbench layout", () => {
  it("reads what was stored, each size clamped to its region's bounds", () => {
    const stored = JSON.stringify({
      side: { open: false, view: "environment", size: 80 },
      inspector: { open: true, size: 2 },
      bottom: { open: true, tab: "kernelLog", size: 12 },
      folds: { outline: false, workspace: "yes" },
    });
    expect(readLayout(storage(stored))).toEqual({
      side: { open: false, view: "environment", size: 28 },
      inspector: { open: true, size: 14 },
      bottom: { open: true, tab: "kernelLog", size: 12 },
      folds: { outline: false },
    });
    expect(clampSize("bottom", 2)).toBe(6);
    expect(clampSize("side", Number.NaN)).toBeNull();
  });

  it("falls back to the default for missing, malformed or unreadable values", () => {
    for (const value of [null, "nope", "3", '{"side":{"view":"nope","size":"x","open":"yes"}}']) {
      expect(readLayout(storage(value))).toEqual(defaultLayout);
    }
    expect(readLayout(throwing)).toEqual(defaultLayout);
    expect(readLayout(undefined)).toEqual(defaultLayout);
  });

  it("writes JSON under jsnb.ui.layout, and survives a storage that throws", () => {
    const written = new Map<string, string>();
    writeLayout({ setItem: (key, value) => written.set(key, value) }, defaultLayout);
    expect(JSON.parse(written.get(layoutKey) ?? "")).toMatchObject({ side: { open: true } });
    expect(() => {
      writeLayout(throwing, defaultLayout);
    }).not.toThrow();
  });
});

describe("the workbench's places", () => {
  it("keeps setup on the left and runtime on the right, whatever name asks", () => {
    expect(placeOf("secrets")).toEqual({ region: "side", view: "environment" });
    expect(placeOf("packages")).toEqual({ region: "side", view: "environment" });
    expect(placeOf("variables")).toEqual({ region: "inspector", section: "variables" });
    expect(placeOf("routes")).toEqual({ region: "inspector", section: "routes" });
    expect(placeOf("errors")).toEqual({ region: "bottom", tab: "problems" });
    expect(placeOf("toString")).toBeUndefined();
    expect(placeOf(3)).toBeUndefined();
  });

  it("opens a place in its region and says what shows", () => {
    const closed = withOpen(withOpen(defaultLayout, "side", false), "inspector", false);
    expect(showing(closed, { region: "side", view: "explorer" })).toBe(false);
    const agent = opened(closed, { region: "side", view: "agent" });
    expect(agent.side).toMatchObject({ open: true, view: "agent" });
    expect(showing(agent, { region: "side", view: "agent" })).toBe(true);
    expect(showing(agent, { region: "side", view: "explorer" })).toBe(false);
    const log = opened(agent, { region: "bottom", tab: "kernelLog" });
    expect(showing(log, { region: "bottom", tab: "kernelLog" })).toBe(true);
    expect(showing(log, { region: "bottom", tab: "problems" })).toBe(false);
    expect(showing(log, { region: "inspector" })).toBe(false);
    expect(showing(opened(log, { region: "inspector" }), { region: "inspector" })).toBe(true);
  });
});
