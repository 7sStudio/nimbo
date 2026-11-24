// The search budget and 09-testing §7: 100 000 nodes under 100 ms, median of three, with the
// 20 % tolerance, on the thread's CPU time (the test stage runs every suite in parallel under coverage).
import { describe, expect, it } from "vitest";

import { countNodes, eventsWire, medianOfThree, withTolerance } from "./fixtures/large.js";
import { search } from "./search.js";

describe("search budget", () => {
  it("searches keys and values of 100 000 nodes in under 100 ms", ({ annotate }) => {
    const json = eventsWire(7200);
    const nodes = countNodes(json);
    expect(nodes).toBeGreaterThanOrEqual(100_000);
    let total = 0;
    const { cpu, wall } = medianOfThree(() => {
      const outcome = search(json, "requires_action");
      total = outcome.ok ? outcome.value.total : -1;
    });
    void annotate(
      `median ${cpu.toFixed(1)} ms of CPU (${wall.toFixed(1)} ms wall) over ${String(nodes)} nodes, ${String(total)} matches`,
    );
    expect(total).toBeGreaterThan(0);
    expect(cpu).toBeLessThan(withTolerance(100));
  });
});
