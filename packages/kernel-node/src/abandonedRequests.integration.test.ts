// Tests requests the daemon abandoned before the kernel started them, through the real child:
// a cell is busy until a flag file exists, and a bridge call, a route request and a snapshot are sent behind it, each
// with a short signal timeout. The signal aborts while the cell runs, so the request rejects at once and the daemon
// sends its `cancel` behind it in the pipe; the cell, untouched, ends `ok`, and the request's user code (a function, a
// handler, a getter) never runs: the marker file it would write stays absent once a later request has answered. The
// same for a call sent before an interrupt and abandoned while the interrupt holds the daemon's sends (the kernel
// blocked in execSync until the test writes a FIFO): its cancel is never held. And a request whose signal aborts
// after its result arrived sends nothing more.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import type { KernelEvent } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { makeFifo } from "./fixtures/fifo.js";
import type { KernelWorld } from "./fixtures/kernelWorld.js";
import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const book = cellBook({
  api: [
    'import { writeFileSync } from "node:fs"',
    'const mark = () => writeFileSync("marked", "")',
    "export function marking() { mark(); return 1 }",
    "export function ping() { return 2 }",
    "export const hostile = { get value() { mark(); return 1 } }",
    'route("GET /mark", () => { mark(); return "marked" })',
  ].join("\n"),
  gate: 'import { existsSync } from "node:fs"\nwhile (!existsSync("release.flag")) {}\n1',
  blocked: [
    'import { execSync } from "node:child_process"',
    'execSync("echo blocked; cat release.fifo", { stdio: ["ignore", "inherit", "inherit"] })',
    "1",
  ].join("\n"),
});

beforeAll(() => {
  book.compile(compileCell);
});

/** Every event of an execution, once it ended. */
async function drain(events: AsyncIterable<KernelEvent>): Promise<readonly KernelEvent[]> {
  const all: KernelEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

/** A request the test sends with a signal; it would write the marker if the kernel ran it. */
type Marking = (world: KernelWorld, signal: AbortSignal) => Promise<unknown>;

const requests: Record<string, Marking> = {
  "bridge call": ({ kernel }, signal) => kernel.call("marking", [], { signal }),
  "route request": ({ kernel }, signal) =>
    kernel.handleRoute(
      { method: "GET", path: "/mark", search: "", headers: {}, rawBody: "" },
      { signal },
    ),
  snapshot: ({ kernel }, signal) => kernel.snapshot(["hostile"], { signal }),
};

describe("a request whose signal aborts while a cell keeps the kernel busy", () => {
  for (const [name, send] of Object.entries(requests)) {
    it(`never starts: the ${name}'s user code never runs, and the busy cell ends ok`, async () => {
      await withKernel(async (world) => {
        const { kernel, run, ws } = world;
        await run(book.cell("api"));
        const gate = kernel.execute(book.cell("gate"))[Symbol.asyncIterator]();
        expect((await gate.next()).value).toMatchObject({ status: "running" });
        await expect(send(world, AbortSignal.timeout(50))).rejects.toMatchObject({
          name: "TimeoutError",
        });
        await writeFile(ws.path("release.flag"), "");
        expect((await drain({ [Symbol.asyncIterator]: () => gate })).at(-1)).toMatchObject({
          status: "ok",
        });
        expect(await kernel.call("ping", [])).toEqual({ value: 2, redacted: false });
        expect(existsSync(ws.path("marked"))).toBe(false);
      });
    });
  }
});

describe("a request sent before an interrupt and abandoned while the interrupt holds the daemon's sends", () => {
  it("never starts: its cancel is not held, so it reaches the kernel before the kernel reads the request", async () => {
    await withKernel(async ({ kernel, run, until, ws }) => {
      await run(book.cell("api"));
      makeFifo(ws.path("release.fifo"));
      const blocked = drain(kernel.execute(book.cell("blocked")));
      // The kernel is inside execSync: neither the request nor the interrupt's evaluate is read until it returns.
      await until(({ logs }) => logs.includes("blocked"));
      const controller = new AbortController();
      const call = kernel.call("marking", [], { signal: controller.signal });
      const interrupted = kernel.interrupt();
      controller.abort();
      await expect(call).rejects.toMatchObject({ name: "AbortError" });
      await writeFile(ws.path("release.fifo"), "go\n");
      await interrupted;
      expect((await blocked).at(-1)).toMatchObject({ status: "interrupted" });
      expect(await kernel.call("ping", [])).toEqual({ value: 2, redacted: false });
      expect(existsSync(ws.path("marked"))).toBe(false);
    });
  });
});

describe("a request whose signal aborts after its result", () => {
  it("has run once, and the abort sends nothing that stops a later one", async () => {
    await withKernel(async ({ kernel, run, ws }) => {
      await run(book.cell("api"));
      const controller = new AbortController();
      expect(await kernel.call("marking", [], { signal: controller.signal })).toEqual({
        value: 1,
        redacted: false,
      });
      controller.abort();
      expect(await kernel.call("ping", [])).toEqual({ value: 2, redacted: false });
      expect(existsSync(ws.path("marked"))).toBe(true);
    });
  });
});
