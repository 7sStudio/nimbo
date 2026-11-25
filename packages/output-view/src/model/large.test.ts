// The model on the large values of the shared Stripe events: flatten opens 10 000 nodes, the grid reads 48 120 rows
// with its summary, and search finds its matches in 100 000 nodes.
import { describe, expect, it } from "vitest";

import { detectValue } from "./detect.js";
import { expandAll } from "./expansion.js";
import { countNodes, eventsWire } from "./fixtures/large.js";
import { gridOf } from "./records.js";
import { search } from "./search.js";
import { summarize, summaryText } from "./summary.js";
import { flatten } from "./tree.js";

describe("the model on large values", () => {
  it("flattens 10 000 nodes, every one open", () => {
    const json = eventsWire(720);
    expect(countNodes(json)).toBeGreaterThanOrEqual(10_000);
    expect(flatten(json, { expansion: expandAll() }).length).toBeGreaterThanOrEqual(10_000);
  });

  it("detects and reads the grid of 48 120 events", () => {
    const json = eventsWire(48_120);
    expect(detectValue(json)).toBe("grid");
    expect(gridOf(json)?.rows).toHaveLength(48_120);
    expect(summaryText(summarize({ kind: "value", json, repr: "" }))).toMatch(
      /^Array, 48,120 rows, 6 columns, \d+\.\d MB$/,
    );
  });

  it("searches keys and values of 100 000 nodes", () => {
    const json = eventsWire(7200);
    expect(countNodes(json)).toBeGreaterThanOrEqual(100_000);
    const outcome = search(json, "requires_action");
    expect(outcome.ok && outcome.value.total).toBeGreaterThan(0);
  });
});
