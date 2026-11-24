// Tests ValueGrid.vue's rows: a click opens a row as a tree and ⌘-click selects it, the keys move, open, select and
// copy, a row's hover action copies it, and the status line loads the rows the kernel cut.
import { truncatedMarker } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { gridOf } from "../model/records.js";
import { grid, records } from "./fixtures/grid.js";
import { mountView } from "./fixtures/mount.js";
import ValueGrid from "./ValueGrid.vue";

describe("rows", () => {
  it("opens a clicked row as a tree and selects with ⌘-click", async () => {
    const { wrapper, calls, view } = mountView(ValueGrid, { grid, root: records, label: "r" });
    const rows = () => wrapper.findAll('[data-part="grid-row"]');
    await rows()[1]?.trigger("click");
    await rows()[2]?.trigger("click", { metaKey: true });
    expect(calls.fullscreen).toEqual([[records, [1]]]);
    expect(view.emitted("update:selection")).toEqual([[[2]]]);
    wrapper.unmount();
  });

  it("moves with the arrows, opens with ↩, selects with Space and copies with ⌘C", async () => {
    const { wrapper, calls, view } = mountView(ValueGrid, { grid, root: records, label: "r" });
    const press = (key: string, init: KeyboardEventInit = {}) =>
      wrapper.get('[role="grid"]').trigger("keydown", { key, ...init });
    for (const key of ["End", "ArrowUp", "Home", "ArrowDown"]) await press(key);
    await press("Enter");
    await press(" ");
    await press("c", { metaKey: true });
    await press("x");
    expect(calls.fullscreen).toEqual([[records, [1]]]);
    expect(view.emitted("update:selection")).toEqual([[[1]]]);
    expect(calls.copy[0]?.[0]).toBe("row");
    expect(calls.copy[0]?.[1]).toContain('"id": "evt_2"');
    wrapper.unmount();
  });

  it("copies a row from its hover action", async () => {
    const { wrapper, calls } = mountView(ValueGrid, { grid, root: records, label: "r" });
    await wrapper.findAll('[data-part="grid-row"]')[2]?.trigger("mouseenter");
    await wrapper
      .findAll('[data-part="grid-row"]')[2]
      ?.get('[aria-label="Copy row"]')
      .trigger("click");
    expect(calls.copy[0]?.[1]).toContain('"id": "evt_3"');
    wrapper.unmount();
  });
});

describe("cut rows", () => {
  it("loads the next rows from the host where the kernel cut them", async () => {
    const rows: unknown[] = Array.isArray(records) ? records : [];
    const cut = [...rows, truncatedMarker];
    const cutGrid = gridOf(cut) ?? grid;
    const { wrapper, calls } = mountView(ValueGrid, { grid: cutGrid, root: cut, label: "r" });
    await wrapper.get('[data-part="grid-status"] button').trigger("click");
    expect(calls.loadMore).toEqual([[[], 3]]);
    wrapper.unmount();
  });
});
