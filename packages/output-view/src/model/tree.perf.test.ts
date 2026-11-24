// The flatten budget and 09-testing §7: 10 000 nodes under 20 ms, median of three, with the
// 20 % tolerance, on the thread's CPU time (the test stage runs every suite in parallel under coverage).
import { describe, expect, it } from "vitest";

import { expandAll } from "./expansion.js";
import { countNodes, eventsWire, medianOfThree, withTolerance } from "./fixtures/large.js";
import { flatten } from "./tree.js";

describe("flatten budget", () => {
  it("flattens 10 000 nodes, every one open, in under 20 ms", ({ annotate }) => {
    const json = eventsWire(720);
    expect(countNodes(json)).toBeGreaterThanOrEqual(10_000);
    let rows = 0;
    const { cpu, wall } = medianOfThree(() => {
      rows = flatten(json, { expansion: expandAll() }).length;
    });
    void annotate(
      `median ${cpu.toFixed(1)} ms of CPU (${wall.toFixed(1)} ms wall) for ${String(countNodes(json))} nodes, ${String(rows)} rows`,
    );
    expect(rows).toBeGreaterThanOrEqual(10_000);
    expect(cpu).toBeLessThan(withTolerance(20));
  });
});
