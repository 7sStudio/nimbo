// Tests what a run does after it settled (04-kernel §5.3 for the page): late outputs and errors on its execution,
// the window fallback for an error that escaped every wrapper, and nothing from a stale run.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { World } from "../fixtures/world.js";
import { createWorld, valueOf } from "../fixtures/world.js";

let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.dispose();
});

const lateTimer = "setTimeout(() => console.log('later'), 0)"; // under test: a log after the run settled
const lateThrow = "setTimeout(() => {\n  throw new TypeError('late')\n}, 0)"; // under test: a throw after it settled

describe("late outputs", () => {
  it("are reported on the run's execution after its status", async () => {
    const run = await world.run(lateTimer);
    const late = await world.transport.until(
      (r) => r.execution === run.execution && r.output?.kind === "stream",
    );
    expect(late.output).toEqual({ kind: "stream", stream: "stdout", text: "later\n" });
    expect(world.transport.reports.indexOf(late)).toBeGreaterThan(
      world.transport.reports.indexOf(run.status),
    );
  });

  it("include a wrapped callback's error, with its mapped line, and leave the status as it was", async () => {
    const run = await world.run(`const x = 1\n${lateThrow}`);
    const late = await world.transport.until(
      (r) => r.execution === run.execution && r.output?.kind === "error",
    );
    expect(late.output).toMatchObject({
      kind: "error",
      error: { name: "TypeError", message: "late" },
    });
    expect(late.output?.kind === "error" ? late.output.error.frames[0] : undefined).toMatchObject({
      cell: run.cell,
      line: 3,
    });
    expect(run.status.status).toBe("ok");
  });

  it("include a rejected promise a wrapped listener returned", async () => {
    const run = await world.run(
      "addEventListener('jsnb-late', async () => { throw new Error('async listener') })",
    );
    window.dispatchEvent(new Event("jsnb-late"));
    const late = await world.transport.until(
      (r) => r.execution === run.execution && r.output?.kind === "error",
    );
    expect(late.output).toMatchObject({ error: { message: "async listener" } });
  });
});

describe("the window fallback", () => {
  it("reports an error event with a cell frame on that cell's current execution and takes it", async () => {
    const source =
      "const event = new ErrorEvent('error', { error: new Error('stray'), cancelable: true })\nwindow.dispatchEvent(event)\nevent.defaultPrevented";
    const run = await world.run(source);
    expect(valueOf(run)).toBe(true);
    expect(run.outputs[0]).toMatchObject({ kind: "error", error: { message: "stray" } });
  });

  it("reports an unhandled rejection with a cell frame, and an error event that names only the cell's file", async () => {
    const source =
      "const reason = new RangeError('rejected')\nconst event = new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason, cancelable: true })\nwindow.dispatchEvent(event)\nevent.defaultPrevented";
    const run = await world.run(source);
    expect(valueOf(run)).toBe(true);
    expect(run.outputs[0]).toMatchObject({
      kind: "error",
      error: { name: "RangeError", message: "rejected" },
    });
    const filename = `jsnb:///test.jsnb/${run.cell}.ts`;
    const bare = new ErrorEvent("error", {
      message: "Script error.",
      filename,
      lineno: 1,
      colno: 1,
      cancelable: true,
    });
    window.dispatchEvent(bare);
    expect(bare.defaultPrevented).toBe(true);
    const late = await world.transport.until(
      (r) =>
        r.execution === run.execution &&
        r.output?.kind === "error" &&
        r.output.error.message === "Script error.",
    );
    expect(late.execution).toBe(run.execution);
  });
});

describe("the window fallback, other errors", () => {
  it("leaves an error that is not a cell's alone", () => {
    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: new Error("not ours"),
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("a stale run", () => {
  it("reports nothing once its cell ran again", async () => {
    const first = await world.run("const say = () => console.log('stale')\nsay()");
    await world.run("1", { cell: first.cell });
    const count = world.transport.outputsOf(first.execution).length;
    await world.run("say()");
    expect(world.transport.outputsOf(first.execution)).toHaveLength(count);
  });
});
