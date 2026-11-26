// Tests a stale run that resumes: after its cell ran again, a full reset or detach, it starts
// no timer, frame or listener, its dispose(fn) runs at once, and its display never creates, mounts or writes the live container.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { afterTimers, nextFrame } from "../fixtures/waits.js";
import { transformCell } from "../fixtures/transform.js";
import type { RunResult, World } from "../fixtures/world.js";
import { createWorld, nextExecution } from "../fixtures/world.js";

/** Calls the server function `hit` from everything the resumed run starts; only dispose(fn) may reach it. */
const resumedRun = [
  "await wait()",
  "setInterval(() => hit('interval'), 1)", // under test: a stale run's interval
  "setTimeout(() => hit('timeout'), 1)", // under test: a stale run's timeout
  "requestAnimationFrame(() => hit('frame'))",
  "addEventListener('jsnb-stale', () => hit('window listener'))",
  "document.addEventListener('jsnb-stale', () => hit('document listener'))",
  "dispose(() => hit('dispose'))",
  "display.html('stale')",
  "await resumed()",
].join("\n");

const fn = { kind: "fn" } as const;
const bindings = { wait: fn, hit: fn, resumed: fn };

let world: World;
let hits: string[];
let waiting: PromiseWithResolvers<undefined>;
let gate: PromiseWithResolvers<undefined>;
let resumed: PromiseWithResolvers<undefined>;

beforeEach(async () => {
  hits = [];
  waiting = Promise.withResolvers<undefined>();
  gate = Promise.withResolvers<undefined>();
  resumed = Promise.withResolvers<undefined>();
  world = await createWorld({
    bridge: async (name, args) => {
      if (name === "wait") waiting.resolve(undefined);
      if (name === "wait") await gate.promise;
      if (name === "resumed") resumed.resolve(undefined);
      if (name === "hit") hits.push(String(args[0]));
      return { result: null };
    },
  });
});
afterEach(async () => {
  await world.dispose();
});

/** Starts the run that will go stale, and resolves once it awaits the gate. */
async function startRun(cell: string): Promise<{ readonly first: Promise<RunResult> }> {
  const first = world.run(resumedRun, { cell, bindings });
  await waiting.promise;
  return { first }; // wrapped: an async function would adopt the promise and wait for the whole run
}

/** The transform's output for a cell, as the daemon sends it (detach leaves no world.run to wait on). */
async function compile(source: string, cell: string): Promise<{ code: string; map: string }> {
  const result = await transformCell(source, `jsnb:///test.jsnb/${cell}.ts`);
  if (!result.ok) throw new Error(result.message);
  return { code: result.code, map: result.map };
}

/** Lets the stale run resume and waits until everything it could have started would have fired. */
async function resume(): Promise<void> {
  gate.resolve(undefined);
  await resumed.promise;
  window.dispatchEvent(new Event("jsnb-stale"));
  document.dispatchEvent(new Event("jsnb-stale"));
  await nextFrame();
  await afterTimers(1);
}

describe("a stale run that resumes", () => {
  it("after a re-run starts nothing and leaves the current run's container alone", async () => {
    const { first } = await startRun("c_stale1");
    await world.run("display.html('current')", { cell: "c_stale1" });
    expect((await first).status.status).toBe("interrupted");
    await resume();
    expect(hits).toEqual(["dispose"]);
    expect(world.realm.containerOf("c_stale1")?.innerHTML).toBe("current");
  });

  it("after a full reset starts nothing and creates no container", async () => {
    const { first } = await startRun("c_stale2");
    await world.realm.handle("realm.reset", {});
    expect((await first).status.status).toBe("interrupted");
    await resume();
    expect(hits).toEqual(["dispose"]);
    expect(world.realm.containerOf("c_stale2")).toBeUndefined();
  });

  it("after detach starts nothing", async () => {
    const pending = world.realm.handle("realm.execute", {
      execution: nextExecution(),
      cell: "c_stale3",
      bindings,
      ...(await compile(resumedRun, "c_stale3")),
    });
    await waiting.promise;
    await world.realm.detach();
    expect(await pending).toEqual({});
    await resume();
    expect(hits).toEqual(["dispose"]);
    expect(world.realm.containerOf("c_stale3")).toBeUndefined();
  });
});
