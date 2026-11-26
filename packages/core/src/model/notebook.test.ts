// Tests NotebookState, KernelStatus and RealmStatus.
import { describe, expect, it } from "vitest";

import { KernelStatus, NotebookState, RealmStatus } from "./notebook.js";

describe("NotebookState", () => {
  it("accepts a freshly opened notebook", () => {
    const state = NotebookState.parse({
      path: "demo.jsnb",
      cells: [],
      kernel: {
        state: "starting",
        pid: null,
        startedAt: null,
        executing: null,
        inspectorUrl: null,
      },
      realm: { attached: false, kind: null, attachedAt: null },
      savedAt: null,
      dirty: false,
    });
    expect(state.kernel.state).toBe("starting");
  });
});

describe("KernelStatus", () => {
  it("includes the paused state and rejects others", () => {
    expect(
      KernelStatus.safeParse({
        state: "paused",
        pid: 42,
        startedAt: "2026-10-10T14:02:11Z",
        executing: "c_a1b2c3",
        inspectorUrl: "ws://127.0.0.1:9229/abc",
      }).success,
    ).toBe(true);
    expect(KernelStatus.safeParse({ state: "sleeping", pid: null }).success).toBe(false);
  });
});

describe("RealmStatus", () => {
  it("accepts tab and headless realms", () => {
    expect(
      RealmStatus.parse({ attached: true, kind: "headless", attachedAt: "2026-10-10T14:02:11Z" })
        .kind,
    ).toBe("headless");
  });
});
