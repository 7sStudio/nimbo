// Tests a cell that replaces process.nextTick or process.emit, through the real child (04-kernel §3.3): Node delivers
// every daemon message, and calls every send back, through the ones it finds at that moment. A replacement that does
// not deliver (a fake-timers nextTick whose queue never runs, an emit that drops "message") is put back for Node's own
// after the run, the call or the timer callback that installed it, or by the interrupt hook, with a ProcessHookReplaced
// error on that cell and one notice, and the kernel goes on answering; one that spins when probed is user code an
// interrupt stops; a wrapper that calls the original (signal-exit's emit) is kept; a fake used inside one cell loses no
// send; and one locked in place ends the kernel, its log saying why.
// A kernel that lost a send's callback would wait for it at shutdown: the tests that stop the kernel give stop() a
// SIGKILL fallback past Vitest's timeout, so only a kernel that exits by itself lets stop() resolve.
import type { KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import type { KernelWorld } from "./fixtures/kernelWorld.js";
import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const book = cellBook({
  fakeTick:
    "globalThis.queued = []\nprocess.nextTick = (fn, ...args) => queued.push([fn, args])\n1",
  dropMessages: [
    "const nodeEmit = process.emit",
    "process.emit = function (event, ...args) {",
    '  return event === "message" ? false : nodeEmit.call(this, event, ...args)',
    "}",
    "1",
  ].join("\n"),
  signalExit: [
    "const original = process.emit",
    "globalThis.wrapper = function (event, arg, ...rest) {",
    '  if (event === "exit") globalThis.exiting = true',
    "  return original.call(this, event, arg, ...rest)",
    "}",
    "process.emit = globalThis.wrapper",
    "1",
  ].join("\n"),
  stillWrapped: "process.emit === globalThis.wrapper",
  fakeInOneCell: [
    "const tick = process.nextTick",
    "process.nextTick = () => undefined",
    'display.html("sent under the fake")',
    "process.nextTick = tick",
    "1",
  ].join("\n"),
  awaitFaked: [
    'import { writeSync } from "node:fs"',
    "process.nextTick = () => undefined",
    'writeSync(1, "replaced\\n")',
    "await new Promise(() => undefined)",
  ].join("\n"),
  spinningTick: [
    'import { writeSync } from "node:fs"',
    "process.nextTick = () => {",
    '  writeSync(1, "probed\\n")',
    "  for (;;) {}",
    "}",
    "1",
  ].join("\n"),
  timerFake: "setTimeout(() => {\n  process.nextTick = () => undefined\n}, 0)\n1", // tested behaviour: a timer's fake
  api: "export function install() {\n  process.nextTick = () => undefined\n  return 7\n}",
  locked: [
    "Object.defineProperty(process, 'nextTick', {",
    "  value: () => undefined, writable: false, configurable: false,",
    "})",
    "1",
  ].join("\n"),
  after: 'console.log("after")\n1 + 1',
});

beforeAll(() => {
  book.compile(compileCell);
});

/** Kernel options whose stop() waits for the kernel to exit by itself, past Vitest's hang guard. */
const patientStop = { kernel: { stopTimeoutMs: 60_000 } };

const replaced = (name: string) => ({ name: "ProcessHookReplaced", data: { name } });
const put = (name: string) =>
  `${name} was replaced by a function or an accessor that does not deliver, so the kernel put Node's own back`;

/** The error outputs of `events`. */
const errorsOf = (events: readonly KernelEvent[]) =>
  events.flatMap((event) =>
    event.kind === "output" && event.output.kind === "error" ? [event.output.error] : [],
  );

/** The decoded value output of `events`. */
const valueOf = (events: readonly KernelEvent[]): unknown => {
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  return found?.kind === "output" && found.output.kind === "value"
    ? decode(found.output.json)
    : undefined;
};

/** Asserts that `after` prints and answers. */
async function answers(
  run: (cell: ReturnType<typeof book.cell>) => Promise<readonly KernelEvent[]>,
) {
  const events = await run(book.cell("after"));
  expect(events.at(-1)).toMatchObject({ status: "ok" });
  expect(events).toContainEqual(
    expect.objectContaining({ output: { kind: "stream", stream: "stdout", text: "after\n" } }),
  );
}

describe("a cell that replaces a process hook with one that does not deliver", () => {
  for (const [cell, name] of [
    ["fakeTick", "process.nextTick"],
    ["dropMessages", "process.emit"],
  ] as const) {
    it(`gets the error, Node's own ${name} is put back, and the kernel answers and stops cleanly`, async () => {
      await withKernel(async ({ kernel, run, seen }) => {
        const installed = await run(book.cell(cell));
        expect(installed.at(-1)).toMatchObject({ status: "ok" });
        expect(errorsOf(installed)).toMatchObject([replaced(name)]);
        await answers(run);
        expect(seen.logs.filter((line) => line.includes(put(name)))).toHaveLength(1);
        await kernel.stop();
      }, patientStop);
    });
  }
});

describe("process hooks replaced by user code outside a run", () => {
  it("are put back after the timer callback that replaced one, the error on the timer's cell", async () => {
    await withKernel(async ({ run, seen, until }) => {
      const timer = book.cell("timerFake");
      expect((await run(timer)).at(-1)).toMatchObject({ status: "ok" });
      await until(({ late }) => late.length > 0);
      expect(seen.late).toMatchObject([
        {
          execution: timer.execution,
          output: { kind: "error", error: replaced("process.nextTick") },
        },
      ]);
      await answers(run);
    });
  });

  it("are put back before a bridge call answers, the error on the exporting cell", async () => {
    await withKernel(async ({ kernel, run, seen, until }) => {
      const api = book.cell("api");
      await run(api);
      await expect(kernel.call("install", [])).resolves.toMatchObject({ value: 7 });
      await until(({ late }) => late.length > 0);
      expect(seen.late).toMatchObject([
        {
          execution: api.execution,
          output: { kind: "error", error: replaced("process.nextTick") },
        },
      ]);
      await answers(run);
      await expect(kernel.call("install", [])).resolves.toMatchObject({ value: 7 });
    });
  });
});

/** The run of `name`, interrupted once the kernel log has `line`; the status it ended with. */
async function interruptAt(world: KernelWorld, name: "awaitFaked" | "spinningTick", line: string) {
  const iterator = world.kernel.execute(book.cell(name))[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ status: "running" });
  // The cell says so on fd 1 itself: a display would be a send of the kernel's, which an interrupt landing inside it
  // stops with Node's own nextTick put in for that send, so the check would find nothing to put back.
  await world.until(({ logs }) => logs.includes(line));
  await world.kernel.interrupt();
  let last: KernelEvent | undefined;
  for (let next = await iterator.next(); next.done !== true; next = await iterator.next())
    last = next.value;
  return last;
}

describe("a process hook replaced by a cell that is interrupted", () => {
  it("is put back by the interrupt hook while the cell awaits, and the next run answers", async () => {
    await withKernel(async (world) => {
      expect(await interruptAt(world, "awaitFaked", "replaced")).toMatchObject({
        status: "interrupted",
      });
      await answers(world.run);
      await world.until(({ logs }) => logs.some((line) => line.includes(put("process.nextTick"))));
      expect(world.seen.exits).toEqual([]);
    });
  });

  it("is stopped by an interrupt when it spins once probed, put back, and the next run answers", async () => {
    await withKernel(async (world) => {
      expect(await interruptAt(world, "spinningTick", "probed")).toMatchObject({
        status: "interrupted",
      });
      await answers(world.run);
      await world.until(({ logs }) => logs.some((line) => line.includes(put("process.nextTick"))));
      expect(world.seen.exits).toEqual([]);
    });
  });
});

describe("process hooks a cell may replace", () => {
  it("keeps a wrapper that calls the original, signal-exit's way: no error, the kernel hears on", async () => {
    await withKernel(async ({ run, seen }) => {
      const wrapped = await run(book.cell("signalExit"));
      expect([wrapped.at(-1), errorsOf(wrapped)]).toMatchObject([{ status: "ok" }, []]);
      expect(valueOf(await run(book.cell("stillWrapped")))).toBe(true);
      await answers(run);
      expect(seen.logs.filter((line) => line.includes("was replaced"))).toEqual([]);
    });
  });

  it("loses no send to a fake nextTick used inside one cell and restored before it ends", async () => {
    await withKernel(async ({ kernel, run }) => {
      const events = await run(book.cell("fakeInOneCell"));
      expect(events.at(-1)).toMatchObject({ status: "ok" });
      const shown = events.flatMap((event) =>
        event.kind === "output" && event.output.kind === "display" ? [event.output.data] : [],
      );
      expect([shown, errorsOf(events)]).toEqual([["sent under the fake"], []]);
      await kernel.stop();
    }, patientStop);
  });

  it("ends the kernel, its log saying why, when a cell locks a nextTick that does not deliver in place", async () => {
    await withKernel(async ({ run, seen, until }) => {
      const dead = { name: "KernelDead", data: { exitCode: 1 } };
      await expect(run(book.cell("locked"))).rejects.toMatchObject(dead);
      const why =
        "process.nextTick was replaced by a function or an accessor that does not deliver and cannot be put back";
      await until(({ logs }) => logs.some((line) => line.includes(why)));
      expect(seen.exits).toEqual([{ exitCode: 1 }]);
    });
  });
});
