// @vitest-environment node
// The Home reducer against the recorded workspace log: the replay ends at the list and the kernels
// the daemon reported, and the steps along the way read as the page shows them: a notebook joins the list as it opens,
// a busy kernel keeps the moment it turned busy, a closed notebook has no kernel, and a late kernel event of a closed
// one is dropped.
import type { EventEnvelope } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { homeProjection, readHomeFixture, replayHome } from "./fixtures/homeReplay.js";
import { emptyHome, reduceHome, withKernel, withList } from "./homeReduce.js";

const { start, end, events } = readHomeFixture();

/** The state right after the first event `accept` accepts. */
const after = (accept: (event: EventEnvelope) => boolean) => {
  const at = events.findIndex(accept);
  if (at === -1) throw new Error("the recording has no such event");
  return replayHome(start, events.slice(0, at + 1));
};

describe("the Home reducer over the recorded log", () => {
  it("replays the flow to the daemon's own end state", () => {
    expect(homeProjection(replayHome(start, events))).toEqual(end);
  });

  it("lists a notebook as it opens, before the list that says so", () => {
    const opened = after(
      (event) => event.type === "notebook.opened" && event.notebook === "sub/b.jsnb",
    );
    expect(opened.notebooks.find((each) => each.path === "sub/b.jsnb")).toMatchObject({
      open: true,
    });
  });

  it("keeps when a busy kernel turned busy, and forgets the kernel of a closed notebook", () => {
    const busy = after((event) => event.type === "kernel.status" && event.data.state === "busy");
    const turned = events.find(
      (event) => event.type === "kernel.status" && event.data.state === "busy",
    );
    expect(busy.kernels["a.jsnb"]).toEqual({ state: "busy", busySince: turned?.ts });
    const closed = after(
      (event) => event.type === "notebook.closed" && event.notebook === "a.jsnb",
    );
    expect(closed.kernels["a.jsnb"]).toBeUndefined();
  });
});

const envelope = (notebook: string, type: string, data: unknown, ts = "2026-11-10T10:00:00.000Z") =>
  ({ notebook, seq: 1, ts, type, data }) as EventEnvelope;
const kernel = (state: string) => ({
  state,
  pid: 1,
  startedAt: null,
  executing: null,
  inspectorUrl: null,
});

describe("reduceHome by hand", () => {
  it("drops a kernel event of a notebook that is not open, and ignores the events Home does not read", () => {
    const state = withList(emptyHome, [
      { path: "a.jsnb", open: false, modifiedAt: null, bytes: null },
    ]);
    expect(reduceHome(state, envelope("a.jsnb", "kernel.status", kernel("idle")))).toBe(state);
    expect(reduceHome(state, envelope("a.jsnb", "cell.deleted", { cell: "c_aaaaaa" }))).toBe(state);
  });
});

describe("reduceHome on a busy kernel", () => {
  it("keeps the first busy moment across busy events, clears it when idle, and sorts a notebook it adds", () => {
    let state = reduceHome(emptyHome, envelope("z.jsnb", "notebook.opened", { path: "z.jsnb" }));
    state = reduceHome(state, envelope("b.jsnb", "notebook.opened", { path: "b.jsnb" }));
    expect(state.notebooks.map((each) => each.path)).toEqual(["b.jsnb", "z.jsnb"]);
    state = reduceHome(
      state,
      envelope("b.jsnb", "kernel.status", kernel("busy"), "2026-11-10T10:00:01.000Z"),
    );
    state = reduceHome(
      state,
      envelope("b.jsnb", "kernel.status", kernel("busy"), "2026-11-10T10:00:09.000Z"),
    );
    expect(state.kernels["b.jsnb"]?.busySince).toBe("2026-11-10T10:00:01.000Z");
    state = reduceHome(state, envelope("b.jsnb", "kernel.status", kernel("idle")));
    expect(state.kernels["b.jsnb"]).toEqual({ state: "idle", busySince: null });
    const listed = withKernel(state, "b.jsnb", { state: "dead", busySince: null });
    expect(
      withList(listed, [{ path: "b.jsnb", open: false, modifiedAt: null, bytes: null }]).kernels,
    ).toEqual({});
  });
});
