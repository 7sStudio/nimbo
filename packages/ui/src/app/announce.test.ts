// What the live line says about finished runs, and which runs are news.
import type { Execution } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { announcement, newAnnouncements } from "./announce.js";

const run = (patch: Partial<Execution>): Execution => ({
  id: "x_1",
  cell: "c_1",
  status: "ok",
  startedAt: "2026-11-02T10:00:00.000Z",
  outputs: [],
  ...patch,
});

describe("announcement", () => {
  it("says how a run ended once its duration or error is in, and nothing while it runs", () => {
    expect(announcement(run({ durationMs: 411.6 }), 3)).toBe("Cell 3 finished in 412 ms");
    expect(announcement(run({}), 1)).toBeNull();
    expect(announcement(run({ status: "interrupted" }), 2)).toBe("Cell 2 was interrupted");
    expect(announcement(run({ status: "interrupted", stoppedBy: "c_aaaaaa" }), 5)).toBe(
      "Cell 5 was not run",
    );
    const error = { name: "TypeError", message: "x", frames: [], raw: "" };
    expect(announcement(run({ status: "error", error }), 4)).toBe("Cell 4 failed: TypeError");
    expect(announcement(run({ status: "error" }), 4)).toBeNull();
    expect(announcement(run({ status: "running" }), 1)).toBeNull();
  });
});

describe("newAnnouncements", () => {
  it("announces runs started since the page loaded and not announced yet, in cell order", () => {
    const executions = new Map([
      ["c_1", run({ id: "x_1", cell: "c_1" })],
      ["c_2", run({ id: "x_2", cell: "c_2", startedAt: "2026-11-02T09:00:00.000Z" })],
      ["c_3", run({ id: "x_3", cell: "c_3", status: "interrupted" })],
    ]);
    const since = Date.parse("2026-11-02T09:30:00.000Z");
    const order = ["c_3", "c_2", "c_1", "c_4"];
    expect(newAnnouncements(executions, order, { ids: new Set(["x_1"]), since })).toEqual([
      { id: "x_3", text: "Cell 1 was interrupted" },
    ]);
  });
});
