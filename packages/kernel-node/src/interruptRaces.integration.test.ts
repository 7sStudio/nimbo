// Tests interrupts racing the kernel's other work, through the real child: an awaiting cell interrupted
// while another cell's 1 ms interval keeps firing, requests sent right before an interrupt of an idle kernel (no cell
// code runs, so nothing is terminated and every one answers), and a bridge call, a route handler and a wrapped timer
// callback that spin in a workspace module's function, below the user-code frame, stopped by an interrupt while the
// next requests answer.
import type { KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";
import type { NodeKernel } from "./ipc/nodeKernel.js";

const book = cellBook({
  ticker: "let ticks = 0\nvoid setInterval(() => { ticks += 1 }, 1)", // tested behaviour: a 1 ms interval
  waiting: "await new Promise(() => {})",
  ticked: "ticks > 0",
  api: "const keep = 41\nexport const data = { n: 1 }",
  next: "keep + 1",
  spinners: [
    'import { spin } from "./lib.mjs"',
    "export const go = spin",
    'route("GET /spin", spin)',
    'route("GET /ok", () => "ok")',
  ].join("\n"),
  later: 'import { spin } from "./lib.mjs"\nsetTimeout(spin, 1)', // tested behaviour: a module's function as a timer
});

/** A workspace module whose function says it started on fd 1 (the kernel log, even while it spins), then spins. */
const lib =
  'import { writeSync } from "node:fs"\nexport function spin() { writeSync(1, "spinning\\n"); while (true) {} }\n';

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

describe("an interrupt of an awaiting cell while another cell's interval fires", () => {
  it("ends the awaiting run interrupted each round, and the next cell answers", async () => {
    await withKernel(async ({ kernel, run, seen }) => {
      await run(book.cell("ticker"));
      for (let round = 0; round < 40; round += 1) {
        const iterator = kernel.execute(book.cell("waiting"))[Symbol.asyncIterator]();
        expect((await iterator.next()).value).toMatchObject({ status: "running" });
        await kernel.interrupt();
        expect((await iterator.next()).value).toMatchObject({ status: "interrupted" });
        expect(valueOf(await run(book.cell("ticked")))).toBe(true);
      }
      expect(seen.exits).toEqual([]);
    });
  });
});

describe("requests sent right before an interrupt of an idle kernel", () => {
  it("are all answered, round after round", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("api"));
      for (let round = 0; round < 40; round += 1) {
        const answers = Promise.all([
          kernel.bindings({ names: ["keep"] }),
          kernel.snapshot(["data"]),
        ]);
        await kernel.interrupt();
        const [bindings, snapshot] = await answers;
        expect([bindings.length, snapshot]).toEqual([
          1,
          { data: { kind: "value", json: { n: 1 } } },
        ]);
      }
      expect(valueOf(await run(book.cell("next")))).toBe(42);
    });
  });
});

/** A GET request for `path` below the notebook's routes. */
const get = (path: string) => ({ method: "GET", path, search: "", headers: {}, rawBody: "" });

/** Starts the spinning bridge call or route request of `kind`, aborted by `signal`. */
const startSpin = (kernel: NodeKernel, kind: "call" | "route", signal: AbortSignal) =>
  kind === "call"
    ? kernel.call("go", [], { signal })
    : kernel.handleRoute(get("/spin"), { signal });

describe("user code from a workspace module that a kernel flow calls and that spins", () => {
  for (const kind of ["call", "route"] as const) {
    it(`is stopped by an interrupt in a ${kind === "call" ? "bridge call" : "route handler"}`, async () => {
      await withKernel(async ({ kernel, run, until, script }) => {
        await script("lib.mjs", lib);
        await run(book.cell("api"));
        await run(book.cell("spinners"));
        const controller = new AbortController();
        const spinning = startSpin(kernel, kind, controller.signal);
        await until(({ logs }) => logs.includes("spinning"));
        await kernel.interrupt();
        expect(valueOf(await run(book.cell("next")))).toBe(42);
        expect((await kernel.handleRoute(get("/ok"))).status).toBe(200);
        controller.abort();
        await expect(spinning).rejects.toMatchObject({ name: "AbortError" });
      });
    });
  }
});

describe("user code from a workspace module that a wrapped timer calls and that spins", () => {
  it("is stopped by an interrupt", async () => {
    await withKernel(async ({ kernel, run, until, script, seen }) => {
      await script("lib.mjs", lib);
      await run(book.cell("api"));
      await run(book.cell("later"));
      await until(({ logs }) => logs.includes("spinning"));
      await kernel.interrupt();
      expect(valueOf(await run(book.cell("next")))).toBe(42);
      expect(seen.exits).toEqual([]);
    });
  });
});
