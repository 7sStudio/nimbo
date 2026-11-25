// The tree and the grid mount 10 000 rows in Chromium and lay out.
import "../theme.css";
import "./utilities.css";

import { describe, expect, it } from "vitest";
import type { Component } from "vue";
import { markRaw, nextTick } from "vue";

import { eventsWire } from "../model/fixtures/large.js";
import { expansion } from "../model/expansion.js";
import { gridOf } from "../model/records.js";
import { flatten } from "../model/tree.js";
import { mountView } from "./fixtures/mount.js";
import ValueGrid from "./ValueGrid.vue";
import ValueTree from "./ValueTree.vue";

// Raw, as OutputView holds a value (a shallowRef): the test mount's reactive props would otherwise proxy every node.
const events = eventsWire(10_000);
const json: unknown = typeof events === "object" && events !== null ? markRaw(events) : events;

/** Mounts a view, lets Vue flush and checks it laid out, then unmounts it. */
async function paint(component: Component, props: Record<string, unknown>): Promise<void> {
  const { wrapper } = mountView(component, props);
  await nextTick();
  expect(wrapper.get("[role]").element.getBoundingClientRect().height).toBeGreaterThan(0);
  wrapper.unmount();
}

describe("a large value", () => {
  it("paints 10 000 tree rows", async () => {
    expect(flatten(json, { expansion: expansion(1) })).toHaveLength(10_002);
    await paint(ValueTree, { json, label: "events", expandDepth: 1, maxHeight: 400 });
  });

  it("paints a 10 000-row grid", async () => {
    const read = gridOf(json);
    const grid = read ? markRaw(read) : read;
    expect(grid?.rows).toHaveLength(10_000);
    await paint(ValueGrid, { grid, root: json, label: "events", maxHeight: 400 });
  });
});
