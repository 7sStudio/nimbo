// Tests a cell's cleanup through runs (04-kernel §7): timers, frames, listeners and dispose(fn) stop
// on a re-run, a full reset and detach; a disposer that throws is an error output on the new execution.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { afterTimers, nextFrame } from "../fixtures/waits.js";
import type { World } from "../fixtures/world.js";
import { createWorld, textOf } from "../fixtures/world.js";

let world: World;
beforeEach(async () => {
  world = await createWorld();
});
afterEach(async () => {
  await world.dispose();
});

/** Every kind of thing a run leaves behind, each logging when it fires. */
const leftBehind = [
  "setInterval(() => console.log('interval'), 1)", // under test: the cell's own interval
  "setTimeout(() => console.log('timeout'), 1)", // under test: the cell's own timeout
  "window.setTimeout(() => console.log('window timeout'), 1)", // under test: through the window view
  "requestAnimationFrame(() => console.log('frame'))",
  "addEventListener('jsnb-test', () => console.log('window listener'))",
  "document.addEventListener('jsnb-test', () => console.log('document listener'))",
  "dispose(() => console.log('disposed'))",
].join("\n");

/** Fires everything a stopped run could still react to, and waits until it would have. */
async function provoke(): Promise<void> {
  window.dispatchEvent(new Event("jsnb-test"));
  document.dispatchEvent(new Event("jsnb-test"));
  await nextFrame();
  await afterTimers(1);
}

describe("a re-run", () => {
  it("stops the previous run's timers, frames and listeners and runs its disposers", async () => {
    const first = await world.run(leftBehind);
    await world.run("'again'", { cell: first.cell });
    const before = world.transport.outputsOf(first.execution).length;
    expect(textOf(world.transport.outputsOf(first.execution))).toContain("disposed\n");
    await provoke();
    expect(world.transport.outputsOf(first.execution)).toHaveLength(before);
  });

  it("reports a disposer that throws or rejects on the new execution, which still runs", async () => {
    const first = await world.run(
      "dispose(() => { throw new Error('sync cleanup') })\ndispose(async () => { throw new Error('async cleanup') })",
    );
    const again = await world.run("'ran'", { cell: first.cell });
    await world.transport.until(
      (r) =>
        r.execution === again.execution &&
        r.output?.kind === "error" &&
        r.output.error.message === "sync cleanup",
    );
    expect(again.status.status).toBe("ok");
    const late = await world.transport.until(
      (r) => r.output?.kind === "error" && r.output.error.message === "async cleanup",
    );
    expect(late.execution).toBe(again.execution);
  });
});

describe("a full reset and detach", () => {
  it("stop what every cell left behind", async () => {
    const first = await world.run(leftBehind);
    await world.realm.handle("realm.reset", {});
    const before = world.transport.outputsOf(first.execution).length;
    expect(textOf(world.transport.outputsOf(first.execution))).toContain("disposed\n");
    await provoke();
    expect(world.transport.outputsOf(first.execution)).toHaveLength(before);
  });

  it("detach runs the disposers without reporting, and a throw goes to onError", async () => {
    const first = await world.run(`${leftBehind}\ndispose(() => { throw new Error('at detach') })`);
    await world.realm.detach();
    await provoke();
    expect(textOf(world.transport.outputsOf(first.execution))).toBe("");
    expect(world.errors).toEqual([expect.objectContaining({ message: "at detach" })]);
  });
});
