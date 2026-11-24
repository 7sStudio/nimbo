// The grid on a large value: detecting it and reading its 48 120 rows, on the shared Stripe events. 09-testing §7 sets
// no budget for this step; it shares the 100 ms of a search (both run before the first paint), median of three, with the
// 20 % tolerance, on the thread's CPU time (the test stage runs every suite in parallel under coverage).
import { describe, expect, it } from "vitest";

import { detectValue } from "./detect.js";
import { eventsWire, medianOfThree, withTolerance } from "./fixtures/large.js";
import { gridOf } from "./records.js";
import { summarize, summaryText } from "./summary.js";

describe("grid budget", () => {
  it("detects and reads the grid of 48 120 events in under 100 ms", ({ annotate }) => {
    const json = eventsWire(48_120);
    let rows = 0;
    const { cpu, wall } = medianOfThree(() => {
      rows = detectValue(json) === "grid" ? (gridOf(json)?.rows.length ?? 0) : 0;
    });
    const summary = summaryText(summarize({ kind: "value", json, repr: "" }));
    void annotate(`median ${cpu.toFixed(1)} ms of CPU (${wall.toFixed(1)} ms wall); ${summary}`);
    expect(rows).toBe(48_120);
    expect(summary).toMatch(/^Array, 48,120 rows, 6 columns, \d+\.\d MB$/);
    expect(cpu).toBeLessThan(withTolerance(100));
  });
});
