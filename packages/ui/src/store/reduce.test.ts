// @vitest-environment node
// The reducer against the recorded logs of fixtures/ (09-testing §3): each replay ends at the state the
// daemon itself reported, and the save, run and output steps along the way read as the page shows them.
import type { EventEnvelope, Execution } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { flows } from "./fixtures/flows.js";
import { projection, readFixture, replay } from "./fixtures/replay.js";
import { emptyMirror, hydrated } from "./mirror.js";
import { reduce, withExecution, withGraph, withSummary } from "./reduce.js";

/** The mirror right after the `nth` event (from 1) of `flow` that `accept` accepts. */
const after = (flow: string, accept: (event: EventEnvelope) => boolean, nth = 1) => {
  const { start, startSeq, events } = readFixture(flow);
  const seq = events.filter(accept)[nth - 1]?.seq;
  if (seq === undefined) throw new Error(`${flow} has no such event`);
  return replay(
    start,
    startSeq,
    events.filter((event) => event.seq <= seq),
  );
};
const ofType = (type: EventEnvelope["type"]) => (event: EventEnvelope) => event.type === type;
const statusOf = (status: string) => (event: EventEnvelope) =>
  event.type === "cell.status" && event.data.status === status;

describe("the reducer over the recorded logs", () => {
  it.each(Object.keys(flows))("replays %s to the daemon's own end state", (flow) => {
    const { start, startSeq, end, events } = readFixture(flow);
    const mirror = replay(start, startSeq, events);
    expect(mirror.notebook && projection(mirror.notebook)).toEqual(projection(end));
    expect(mirror.seq).toBe(events.at(-1)?.seq);
  });

  it("follows autosave: writing after an edit, failed, saved again, conflict, saved", () => {
    expect(after("saves", ofType("cell.added")).saveState).toBe("writing");
    expect(after("saves", ofType("notebook.saved")).saveState).toBe("saved");
    const failed = after("saves", ofType("notebook.saveFailed"));
    expect(failed.saveState).toBe("failed");
    expect(failed.saveError?.code).toBe("EACCES");
    expect(after("saves", ofType("notebook.saved"), 2)).toMatchObject({
      saveState: "saved",
      saveError: null,
    });
    expect(after("saves", ofType("notebook.conflict")).saveState).toBe("conflict");
    expect(after("saves", ofType("notebook.saved"), 3).notebook?.dirty).toBe(false);
  });

  it("streams a run's outputs into its execution and drops the previous run's", () => {
    const first = after("runs", statusOf("ok"));
    const run = first.executions.get("c_m0izya");
    expect(run?.outputs.map((output) => output.kind)).toEqual(["stream", "value"]);
    const again = after("runs", statusOf("ok"), 3).executions.get("c_m0izya");
    expect(again?.status).toBe("ok");
    expect(again?.id).not.toBe(run?.id);
    expect(again?.outputs).toHaveLength(1);
  });

  it("keeps the kernel's death and the routes as they change", () => {
    const dead = (event: EventEnvelope) =>
      event.type === "kernel.status" && event.data.state === "dead";
    expect(after("death", dead).notebook?.kernel.state).toBe("dead");
    const routes = ofType("routes.changed");
    expect(after("routes", routes).routes.map((route) => route.spec)).toEqual(["GET /ping"]);
    expect(after("routes", routes, 2).routes).toEqual([]);
  });
});

describe("the reducer's guards", () => {
  const { start, startSeq, events } = readFixture("edits");
  const base = hydrated(emptyMirror, start, startSeq);
  const first = events[0];

  it("ignores an event at or below its seq, of another notebook, or before any state", () => {
    if (first === undefined) throw new Error("the edits log is empty");
    const applied = reduce(base, first);
    expect(reduce(applied, first)).toBe(applied);
    const other: EventEnvelope = { ...first, notebook: "other.jsnb", seq: first.seq + 100 };
    expect(reduce(base, other)).toBe(base);
    expect(reduce(emptyMirror, first)).toBe(emptyMirror);
  });

  it("marks the notebook closed by another client, open again on notebook.opened, and not closed after a hydrate", () => {
    const at = (seq: number, type: "notebook.closed" | "notebook.opened"): EventEnvelope => ({
      ...{ notebook: start.path, seq, ts: "2026-01-01T00:00:00.000Z" },
      type,
      data: { path: start.path },
    });
    const closed = reduce(base, at(startSeq + 1, "notebook.closed"));
    expect(closed.closed).toBe(true);
    expect(reduce(closed, at(startSeq + 2, "notebook.opened")).closed).toBe(false);
    expect(hydrated(closed, start, startSeq + 5).closed).toBe(false);
  });

  it("drops an output of a run it does not follow", () => {
    const stray: EventEnvelope = {
      ...{ notebook: start.path, seq: startSeq + 1, ts: "2026-01-01T00:00:00.000Z" },
      type: "cell.output",
      data: {
        cell: "c_m0izya",
        execution: "x_unknown1",
        output: { kind: "stream", stream: "stdout", text: "" },
      },
    };
    expect(reduce(base, stray).executions.size).toBe(0);
  });
});

const runs = readFixture("runs");
const mirror = replay(runs.start, runs.startSeq, runs.events);
const current = mirror.executions.get("c_m0izya")?.id ?? "";

describe("what the store folds in", () => {
  const run = (id: string, startedAt: string): Execution => ({
    ...{ id, cell: "c_m0izya", status: "ok", startedAt, outputs: [] },
  });

  it("takes a fetched execution unless it follows a newer run", () => {
    const fresh = withExecution(mirror, run(current, "2999-01-01T00:00:00.000Z"));
    expect(fresh.executions.get("c_m0izya")?.startedAt).toBe("2999-01-01T00:00:00.000Z");
    expect(withExecution(mirror, run("x_older001", "2000-01-01T00:00:00.000Z"))).toBe(mirror);
  });
});

describe("a fetched summary", () => {
  it("is taken only for the run the mirror follows", () => {
    const cell = mirror.notebook?.cells[0];
    if (cell === undefined) throw new Error("no cell");
    const summary = {
      id: current,
      status: "ok",
      startedAt: "",
      hasError: false,
      defines: ["a"],
    } as const;
    expect(
      withSummary(mirror, { ...cell, lastExecution: summary }).notebook?.cells[0]?.lastExecution,
    ).toEqual(summary);
    const other = { ...summary, id: "x_other001" };
    expect(withSummary(mirror, { ...cell, lastExecution: other })).toBe(mirror);
    expect(withSummary(mirror, { ...cell, lastExecution: null })).toBe(mirror);
  });
});

describe("the graph", () => {
  it("is replaced, and a delete or a hydrate drops the entries of cells that are gone", () => {
    const entry = { defines: ["a"], uses: [], exports: ["a"], dependsOn: [] };
    const graphed = withGraph(mirror, [
      { id: "c_m0izya", ...entry },
      { id: "c_gone0001", ...entry },
    ]);
    expect(graphed.graph.get("c_m0izya")).toEqual(entry);
    const state = graphed.notebook;
    if (state === null) throw new Error("no state");
    expect([...hydrated(graphed, state, graphed.seq).graph.keys()]).toEqual(["c_m0izya"]);
  });
});
