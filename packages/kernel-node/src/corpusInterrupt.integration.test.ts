// Case 18 of the 04-kernel §12 corpus through the real kernel: `while (true) {}` and a never-settling await both end
// interrupted once running was seen, with the scope intact; an interrupt with requests queued behind the terminated
// cell, which the kernel still answers (its inbox dispatches one message per turn, 04-kernel §6), a call whose user
// code runs when the daemon's second hook call comes included (that call stops only the interrupted cell's code); a
// cell's own setImmediate spin, which the wrapped setImmediate makes interruptible; and cell code a raw Node callback
// calls (globalThis.setImmediate), which cannot be stopped safely: the interrupt refuses with InterruptRefused, and the
// kernel lives and runs that code until it returns (interruptContexts.integration.test.ts tests every such context).
import { writeFile } from "node:fs/promises";

import type { KernelEvent } from "@jsnb/core";
import { decode, encodeStrict } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import type { NodeKernel } from "./ipc/nodeKernel.js";
import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const book = cellBook({
  keep: "const keep = 41\nexport const twice = (n: number) => n * 2",
  busy: [
    "export function busy(ms: number) {",
    "  const end = performance.now() + ms",
    "  while (performance.now() < end) {}",
    "  return ms",
    "}",
  ].join("\n"),
  spin: "while (true) {}",
  hang: "await new Promise(() => {})",
  next: "keep + 1",
  gate: 'import { existsSync } from "node:fs"\nwhile (!existsSync("release.flag")) {}',
  immediateSpin: 'setImmediate(() => {\n  display.html("spinning")\n  while (true) {}\n})',
  rawSpin: [
    'import { existsSync } from "node:fs"',
    "globalThis.setImmediate(() => {",
    '  display.html("spinning")',
    '  while (!existsSync("release.flag")) {}',
    "})",
  ].join("\n"),
});

beforeAll(() => {
  book.compile(compileCell);
});

/** The decoded value of a run that ended ok. */
function valueOf(events: readonly KernelEvent[]): unknown {
  expect(events.at(-1)).toMatchObject({ status: "ok" });
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  return found?.kind === "output" && found.output.kind === "value"
    ? decode(found.output.json)
    : undefined;
}

/** Starts `name` and resolves once it reported running, with the iterator for the rest of its events. */
async function startedRun(kernel: NodeKernel, name: Parameters<typeof book.cell>[0]) {
  const events = kernel.execute(book.cell(name))[Symbol.asyncIterator]();
  expect((await events.next()).value).toMatchObject({ status: "running" });
  return events;
}

describe("case 18: interrupt through the real kernel", () => {
  for (const name of ["spin", "hang"] as const) {
    it(`ends ${name === "spin" ? "while (true) {}" : "a never-settling await"} as interrupted, scope intact`, async () => {
      await withKernel(async ({ kernel, run }) => {
        await run(book.cell("keep"));
        const events = await startedRun(kernel, name);
        await kernel.interrupt();
        const ended = await events.next();
        expect(ended.value).toMatchObject({ kind: "status", status: "interrupted" });
        expect((await events.next()).done).toBe(true);
        expect(valueOf(await run(book.cell("next")))).toBe(42);
      });
    });
  }
});

describe("an interrupt with messages queued behind the terminated cell", () => {
  it("still answers the requests that arrived with the interrupted cell", async () => {
    await withKernel(async ({ kernel, run, ws }) => {
      await run(book.cell("keep"));
      // The gate spins until the flag exists, so what follows reaches the kernel in one batch.
      const gate = await startedRun(kernel, "gate");
      const spin = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
      const args = encodeStrict([21]);
      const call = kernel.call("twice", args.ok ? (args.json as unknown[]) : []);
      const bindings = kernel.bindings({ names: ["keep"] });
      await writeFile(ws.path("release.flag"), "");
      expect((await gate.next()).value).toMatchObject({ status: "ok" });
      expect((await spin.next()).value).toMatchObject({ status: "running" });
      await kernel.interrupt();
      expect((await spin.next()).value).toMatchObject({ status: "interrupted" });
      expect(await call).toEqual({ value: 42, redacted: false });
      expect(await bindings).toMatchObject([{ name: "keep", kind: "const", preview: "41" }]);
      expect(valueOf(await run(book.cell("next")))).toBe(42);
    });
  });
});

describe("the daemon's second hook call after an interrupt", () => {
  it("leaves a queued call's user code running: the call answers, the cell ends interrupted", async () => {
    await withKernel(async ({ kernel, run, ws }) => {
      await run(book.cell("keep"));
      await run(book.cell("busy"));
      const gate = await startedRun(kernel, "gate");
      const spin = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
      const args = encodeStrict([300]);
      const call = kernel.call("busy", args.ok ? (args.json as unknown[]) : []);
      await writeFile(ws.path("release.flag"), "");
      expect((await gate.next()).value).toMatchObject({ status: "ok" });
      expect((await spin.next()).value).toMatchObject({ status: "running" });
      await kernel.interrupt();
      expect((await spin.next()).value).toMatchObject({ status: "interrupted" });
      expect(await call).toEqual({ value: 300, redacted: false });
      expect(valueOf(await run(book.cell("next")))).toBe(42);
    });
  });
});

describe("an interrupt of cell code a callback runs", () => {
  it("stops a cell's own setImmediate spin, and the next cell answers", async () => {
    await withKernel(async ({ kernel, run, until, seen }) => {
      await run(book.cell("keep"));
      expect((await run(book.cell("immediateSpin"))).at(-1)).toMatchObject({ status: "ok" });
      await until(({ late }) => late.some(({ output }) => output.kind === "display"));
      await kernel.interrupt();
      expect(valueOf(await run(book.cell("next")))).toBe(42);
      expect(seen.exits).toEqual([]);
    });
  });

  it("refuses to stop cell code a raw Node callback runs, and the kernel lives", async () => {
    await withKernel(async ({ kernel, run, until, seen, ws }) => {
      await run(book.cell("keep"));
      expect((await run(book.cell("rawSpin"))).at(-1)).toMatchObject({ status: "ok" });
      await until(({ late }) => late.some(({ output }) => output.kind === "display"));
      await expect(kernel.interrupt()).rejects.toMatchObject({
        name: "InterruptRefused",
        data: { context: "Immediate", cell: book.cell("rawSpin").cell },
      });
      await writeFile(ws.path("release.flag"), "");
      expect(valueOf(await run(book.cell("next")))).toBe(42);
      expect(seen.exits).toEqual([]);
    });
  });
});
