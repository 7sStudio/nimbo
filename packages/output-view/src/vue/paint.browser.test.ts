// The paint budget in Chromium: 10 000 rows painted under 50 ms after flatten, the median of
// three runs after a warm-up, with the 20 % tolerance of 09-testing §7, for the tree and for the grid. "Painted" is
// timed to a laid-out page (mount, Vue's flush, a forced style and layout pass), the work the next frame paints, so
// the wait for that frame (up to 16.7 ms of idle) does not count.
import "../theme.css";
import "./utilities.css";

import { describe, expect, it } from "vitest";
import type { Component } from "vue";
import { markRaw, nextTick } from "vue";

import { eventsWire, withTolerance } from "../model/fixtures/large.js";
import { expansion } from "../model/expansion.js";
import { gridOf } from "../model/records.js";
import { flatten } from "../model/tree.js";
import { mountView } from "./fixtures/mount.js";
import ValueGrid from "./ValueGrid.vue";
import ValueTree from "./ValueTree.vue";

// Raw, as OutputView holds a value (a shallowRef): the test mount's reactive props would otherwise proxy every node.
const events = eventsWire(10_000);
const json: unknown = typeof events === "object" && events !== null ? markRaw(events) : events;

const median = (samples: readonly number[]): number =>
  [...samples].sort((a, b) => a - b)[1] ?? Number.POSITIVE_INFINITY;

/** One warm-up, then three timed runs of `run`; the median, in ms. */
async function medianOfThree(run: () => Promise<void> | void): Promise<number> {
  await run();
  const samples: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

/** Mounts a view, lets Vue flush and forces style and layout, then unmounts it. */
const paint = (component: Component, props: Record<string, unknown>) => async (): Promise<void> => {
  const { wrapper } = mountView(component, props);
  await nextTick();
  expect(wrapper.get("[role]").element.getBoundingClientRect().height).toBeGreaterThan(0);
  wrapper.unmount();
};

describe("paint budget", () => {
  it("paints 10 000 tree rows under 50 ms after flatten", async () => {
    const flattenMs = await medianOfThree(() => {
      flatten(json, { expansion: expansion(1) });
    });
    const totalMs = await medianOfThree(
      paint(ValueTree, { json, label: "events", expandDepth: 1, maxHeight: 400 }),
    );
    expect(flatten(json, { expansion: expansion(1) })).toHaveLength(10_002);
    expect(totalMs - flattenMs).toBeLessThan(withTolerance(50));
  });

  it("paints a 10 000-row grid under 50 ms after its rows are read", async () => {
    const read = gridOf(json);
    const grid = read ? markRaw(read) : read;
    const readMs = await medianOfThree(() => {
      gridOf(json);
    });
    const totalMs = await medianOfThree(
      paint(ValueGrid, { grid, root: json, label: "events", maxHeight: 400 }),
    );
    expect(grid?.rows).toHaveLength(10_000);
    expect(totalMs - readMs).toBeLessThan(withTolerance(50));
  });
});
