// The debugger on the real js-debug and the built kernel: a breakpoint hit on the right TypeScript line on a run and
// a re-run, a step into a function another cell defined, the Notebook scope and an evaluation that changes a cell's
// name, interrupt and restart while paused (the breakpoints bound again on the new kernel), the kernel's NODE_OPTIONS
// untouched, secrets redacted in what the debugger shows, a breakpoint that stays on its cell when another cell gets
// one, conditions and logpoints that read other cells' names and report their errors once, and an auto-run cascade
// that waits while a dependent is paused.
import type { Execution } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { valueOf } from "../../fixtures/notebook.js";

const notebook = "d.jsnb";

async function server(daemon: Daemon, lines: readonly string[]): Promise<string> {
  const source = lines.join("\n");
  return (await daemon.client.cell.add({ notebook, type: "server", source })).cell.id;
}

const terminal = new Set(["ok", "error", "interrupted"]);

/** The seq of the last event received: a wait for a pause after it ignores the pauses before. */
const mark = (daemon: Daemon): number => daemon.events.all().at(-1)?.seq ?? 0;

const pausedAt = (daemon: Daemon, since: number, cell: string, line?: number) =>
  daemon.events.until(
    "debug.paused",
    (e) => e.seq > since && e.data.cell === cell && (line === undefined || e.data.line === line),
  );

/** Runs `cell` and waits until it paused on `line`; `ended` answers the run once it ends. */
async function runToPause(
  daemon: Daemon,
  cell: string,
  line: number,
): Promise<{ readonly ended: Promise<{ execution: Execution }> }> {
  const before = mark(daemon);
  // a waiting run answers once the kernel pauses: its end is its terminal cell.status
  const ended = daemon.client.cell.run({ notebook, cell }).then(async ({ execution }) => {
    const done = await daemon.events.until(
      "cell.status",
      (e) => e.data.execution === execution.id && terminal.has(e.data.status),
      30_000,
    );
    return { execution: { ...execution, status: done.data.status } };
  });
  await pausedAt(daemon, before, cell, line);
  return { ended };
}

/** `step`, then waits for the pause in `cell` (on `line`, when given). */
async function stepTo(daemon: Daemon, step: () => Promise<unknown>, cell: string, line?: number) {
  const before = mark(daemon);
  await step();
  await pausedAt(daemon, before, cell, line);
}

/** The names the innermost frame shows under Notebook. */
async function notebookNames(daemon: Daemon): Promise<readonly string[] | undefined> {
  const frameId = (await daemon.client.debug.stack({ notebook })).frames[0]?.frameId ?? "";
  const { scopes } = await daemon.client.debug.scope({ notebook, frameId });
  return scopes.find((scope) => scope.name === "Notebook")?.variables?.map((v) => v.name);
}

const twice = [
  "type N = number;",
  "function twice(n: N): N {",
  "  const doubled: N = n * 2;",
  "  return doubled;",
  "}",
];
const caller = ["const start: number = 20;", "const out = twice(start);", "out + 1;"];

/** One debugged run of `use`: paused on its line 2, into twice, out again, resumed; `start` set to 1 when asked. */
async function debuggedRun(daemon: Daemon, cells: { lib: string; use: string }, setStart: boolean) {
  const run = await runToPause(daemon, cells.use, 2);
  expect((await daemon.client.kernel.status({ notebook })).state).toBe("paused");
  const names = await notebookNames(daemon);
  expect(names).toEqual(expect.arrayContaining(["twice", "start"]));
  expect(names).not.toContain("__scope");
  // a write of a cell's name from the paused frame is the cell's own: twice gets 1
  if (setStart) await daemon.client.debug.evaluate({ notebook, expression: "start = 1" });
  await stepTo(daemon, () => daemon.client.debug.stepInto({ notebook }), cells.lib, 3);
  const { frames } = await daemon.client.debug.stack({ notebook });
  expect(frames.map((frame) => [frame.cell, frame.line, frame.fn])).toEqual([
    [cells.lib, 3, "twice"],
    [cells.use, 2, "<anonymous>"],
  ]);
  const local = await daemon.client.debug.evaluate({ notebook, expression: "n + start" });
  expect(local.repr).toBe(setStart ? "2" : "40");
  await stepTo(daemon, () => daemon.client.debug.stepOut({ notebook }), cells.use);
  await daemon.client.debug.resume({ notebook });
  expect((await run.ended).execution.status).toBe("ok");
}

describe("the debugger", () => {
  it("pauses on a breakpoint's TypeScript line on a run and a re-run, and steps into another cell's function", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const cells = { lib: await server(daemon, twice), use: await server(daemon, caller) };
      await daemon.client.cell.run({ notebook, cell: cells.lib });
      await daemon.client.debug.setBreakpoint({ notebook, cell: cells.use, line: 2 });
      await debuggedRun(daemon, cells, false);
      await debuggedRun(daemon, cells, true);
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: cells.use });
      expect(valueOf(execution)).toBe(3);
    });
  });

  it("ends a paused run on interrupt and on restart, binds the breakpoints on the new kernel, and leaves NODE_OPTIONS alone", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const lines = ["let hits = 0;", "hits += 1;", "process.env.NODE_OPTIONS ?? 'unset';"];
      const cell = await server(daemon, lines);
      await daemon.client.debug.setBreakpoint({ notebook, cell, line: 2 });

      const interrupted = await runToPause(daemon, cell, 2);
      await daemon.client.kernel.interrupt({ notebook });
      expect((await interrupted.ended).execution.status).toBe("interrupted");
      expect((await daemon.client.debug.state({ notebook })).state).toBe("running");

      const restarted = await runToPause(daemon, cell, 2);
      await daemon.client.kernel.restart({ notebook });
      expect((await restarted.ended).execution.status).toBe("interrupted");

      const again = await runToPause(daemon, cell, 2);
      const state = await daemon.client.debug.state({ notebook });
      expect(state.breakpoints).toMatchObject([{ cell, line: 2, verified: true }]);
      await daemon.client.debug.resume({ notebook });
      expect((await again.ended).execution.status).toBe("ok");
      const { execution } = await daemon.client.cell.outputs({ notebook, cell });
      expect(valueOf(execution)).toBe("unset");
    });
  });
});

describe("the debugger's answers", () => {
  it("redacts a secret in variables, evaluations and the paused stack", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const secret = "supersecretvalue123";
      await daemon.client.secrets.set({ name: "SECRET_TOKEN", value: secret });
      const cell = await server(daemon, [
        "const token = process.env.SECRET_TOKEN;",
        "token.length;",
      ]);
      await daemon.client.debug.setBreakpoint({ notebook, cell, line: 2 });
      const run = await runToPause(daemon, cell, 2);
      const shown = JSON.stringify([
        await daemon.client.debug.scope({ notebook }),
        await daemon.client.debug.evaluate({ notebook, expression: "token" }),
        await daemon.client.debug.evaluate({ notebook, expression: "`${token}!`" }),
        await daemon.client.debug.state({ notebook }),
      ]);
      expect(shown).not.toContain(secret);
      expect(shown).toContain("***");
      await daemon.client.debug.resume({ notebook });
      expect((await run.ended).execution.status).toBe("ok");
    });
  });
});

describe("breakpoints of several cells", () => {
  it("keeps a cell's breakpoint on its cell when another cell gets one", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const short = await server(daemon, ["let b = 1;", "b += 1;", "b += 1;", "b;"]);
      const long = await server(
        daemon,
        Array.from({ length: 10 }, (_, at) => `let a${String(at)} = ${String(at)};`),
      );
      await daemon.client.debug.setBreakpoint({ notebook, cell: short, line: 4 });
      const first = await runToPause(daemon, short, 4);
      await daemon.client.debug.resume({ notebook });
      await first.ended;
      await daemon.client.debug.setBreakpoint({ notebook, cell: long, line: 9 });
      // a second breakpoint of the same cell: js-debug gives both the same id
      await daemon.client.debug.setBreakpoint({
        notebook,
        cell: short,
        line: 2,
        condition: "b > 5",
      });
      const again = await runToPause(daemon, short, 4);
      const { breakpoints } = await daemon.client.debug.state({ notebook });
      expect(breakpoints.map((each) => [each.cell, each.line]).sort()).toEqual(
        [
          [short, 2],
          [short, 4],
          [long, 9],
        ].sort(),
      );
      await daemon.client.debug.resume({ notebook });
      expect((await again.ended).execution.status).toBe("ok");
    });
  });
});

/** A cell defining `base`, run, and a loop over three steps that reads it on line 3. */
async function loopNotebook(daemon: Daemon): Promise<string> {
  await daemon.client.notebook.create({ path: notebook });
  const base = await server(daemon, ["const base = 10;"]);
  await daemon.client.cell.run({ notebook, cell: base });
  return server(daemon, [
    "let total = 0;",
    "for (const step of [1, 2, 3]) {",
    "  total += step * base;",
    "}",
    "total;",
  ]);
}

describe("conditions and logpoints", () => {
  it("pause on a condition that reads the frame's and another cell's names, `new` included", async () => {
    await withDaemon(async (daemon) => {
      const loop = await loopNotebook(daemon);
      const condition = "new Date(step).getTime() === 2 && base === 10";
      await daemon.client.debug.setBreakpoint({ notebook, cell: loop, line: 3, condition });
      const run = await runToPause(daemon, loop, 3);
      expect((await daemon.client.debug.evaluate({ notebook, expression: "step" })).repr).toBe("2");
      await daemon.client.debug.resume({ notebook });
      expect((await run.ended).execution.status).toBe("ok");
    });
  });

  it("print a logpoint's message with those names into the cell's output", async () => {
    await withDaemon(async (daemon) => {
      const loop = await loopNotebook(daemon);
      const logMessage = 'step {step} of {base}{"}"}';
      await daemon.client.debug.setBreakpoint({ notebook, cell: loop, line: 3, logMessage });
      await daemon.client.cell.run({ notebook, cell: loop });
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: loop });
      const printed = JSON.stringify(execution?.outputs);
      expect(printed).toContain("step 1 of 10}");
      expect(printed).toContain("step 3 of 10}");
    });
  });
});

describe("a condition that throws", () => {
  it("is reported once on its breakpoint, never in the cell's output", async () => {
    await withDaemon(async (daemon) => {
      const loop = await loopNotebook(daemon);
      await daemon.client.debug.setBreakpoint({
        notebook,
        cell: loop,
        line: 3,
        condition: "missing > 1",
      });
      await daemon.client.cell.run({ notebook, cell: loop });
      const reported = await daemon.events.until("debug.breakpoints", (e) =>
        e.data.breakpoints.some(
          (each) => each.message?.includes("missing is not defined") === true,
        ),
      );
      expect(reported.data.breakpoints).toHaveLength(1);
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: loop });
      expect(JSON.stringify(execution?.outputs)).not.toContain("ReferenceError");
    });
  });
});

describe("a caller's run wait", () => {
  it("answers as soon as the kernel pauses, and at once for a run asked while it is paused", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const cell = await server(daemon, ["let n = 1;", "n += 1;", "n;"]);
      await daemon.client.debug.setBreakpoint({ notebook, cell, line: 2 });
      const asked = performance.now();
      const first = await daemon.client.cell.run({ notebook, cell, wait: true, timeoutMs: 60_000 });
      expect(performance.now() - asked).toBeLessThan(20_000);
      expect(first.execution).toMatchObject({
        status: "running",
        timedOut: true,
        paused: { reason: "breakpoint", cell, line: 2 },
      });
      const second = await daemon.client.cell.run({
        notebook,
        cell,
        wait: true,
        timeoutMs: 60_000,
      });
      expect(second.execution).toMatchObject({ status: "queued", paused: { cell, line: 2 } });
      await daemon.client.debug.removeBreakpoint({ notebook, all: true });
      await daemon.client.debug.resume({ notebook });
      await daemon.events.until(
        "cell.status",
        (e) => e.data.execution === second.execution.id && e.data.status === "ok",
      );
      const { execution } = await daemon.client.cell.outputs({ notebook, cell });
      expect(valueOf(execution)).toBe(2);
    });
  });
});

describe("the debugger and execution.autoRunDependents", () => {
  it("queues no further dependent while one is paused, and goes on once it resumes", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const a = await server(daemon, ["let a = 1"]);
      const paused = await server(daemon, ["let b = a", "b += 1"]);
      const after = await server(daemon, ["const c = a + 1", "c"]);
      await daemon.client.notebook.run({ notebook, select: "all" });
      await daemon.client.settings.set({ key: "execution.autoRunDependents", value: true });
      await daemon.client.debug.setBreakpoint({ notebook, cell: paused, line: 2 });
      const before = mark(daemon);
      const answer = daemon.client.cell.run({ notebook, cell: a, source: "let a = 5" });
      await pausedAt(daemon, before, paused, 2);
      const state = await daemon.client.notebook.get({ notebook });
      expect(state.notebook.autoRun).toEqual({ running: paused, pending: [after] });
      const queuedAfter = () =>
        daemon.events
          .all()
          .some((e) => e.seq > before && e.type === "cell.status" && e.data.cell === after);
      expect(queuedAfter()).toBe(false);
      await daemon.client.debug.resume({ notebook });
      await answer;
      await daemon.events.until(
        "cell.status",
        (e) => e.seq > before && e.data.cell === after && e.data.status === "ok",
      );
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: after });
      expect(execution?.autoRun?.cell).toBe(a);
      expect(valueOf(execution)).toBe(6);
    });
  });
});
