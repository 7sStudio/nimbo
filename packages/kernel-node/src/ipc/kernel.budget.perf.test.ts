// The kernel's budgets of 09-testing §7, measured on the built kernel through its default entry (dist/main.js, what
// users run) in the integration stage, each the median of three samples after a warm-up, within 20 %: start to ready
// under 400 ms, interrupt of `while (true) {}` under 200 ms with the next cell answering, and execute of `1 + 1` at
// p50 under 30 ms and p95 under 80 ms over 30 runs (the kernel's share of cell.run).
import type { KernelEvent } from "@jsnb/core";
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { loadBuiltKernel, withBuiltKernel } from "../fixtures/builtKernel.js";
import { cellBook } from "../fixtures/realmHarness.js";
import { median, percentile, threeSamples, withTolerance } from "../fixtures/timing.js";
import type { NodeKernel } from "../index.js";

const book = cellBook({ spin: "while (true) {}", sum: "1 + 1" });
let create: Awaited<ReturnType<typeof loadBuiltKernel>>;

beforeAll(async () => {
  book.compile(compileCell);
  create = await loadBuiltKernel();
});

async function run(kernel: NodeKernel, cell: CompiledCell): Promise<readonly KernelEvent[]> {
  const events: KernelEvent[] = [];
  for await (const event of kernel.execute(cell)) events.push(event);
  return events;
}

const fixed = (samples: readonly number[]) => samples.map((sample) => sample.toFixed(1)).join(", ");

describe("the built kernel's start budget", () => {
  it("starts to ready in under 400 ms", async ({ annotate }) => {
    const samples = await threeSamples(() =>
      withBuiltKernel(create, async (kernel) => {
        const started = performance.now();
        await kernel.start();
        return performance.now() - started;
      }),
    );
    await annotate(`start to ready: median ${median(samples).toFixed(1)} ms of ${fixed(samples)}`);
    expect(median(samples)).toBeLessThan(withTolerance(400));
  });
});

describe("the built kernel's interrupt budget", () => {
  it("interrupts while (true) {} in under 200 ms, the next cell answering", async ({
    annotate,
  }) => {
    await withBuiltKernel(create, async (kernel) => {
      await kernel.start();
      const samples = await threeSamples(async () => {
        const events = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
        expect((await events.next()).value).toMatchObject({ status: "running" });
        const asked = performance.now();
        await kernel.interrupt();
        expect((await events.next()).value).toMatchObject({ status: "interrupted" });
        const interrupted = performance.now() - asked;
        expect((await run(kernel, book.cell("sum"))).at(-1)).toMatchObject({ status: "ok" });
        return { interrupted, answered: performance.now() - asked };
      });
      const interrupted = median(samples.map((sample) => sample.interrupted));
      const answered = median(samples.map((sample) => sample.answered));
      await annotate(
        `interrupted after ${interrupted.toFixed(1)} ms, next cell answered after ${answered.toFixed(1)} ms`,
      );
      expect(interrupted).toBeLessThan(withTolerance(200));
      expect(answered).toBeLessThan(withTolerance(200));
    });
  });
});

describe("the built kernel's execute budget", () => {
  it("executes 1 + 1 at p50 under 30 ms and p95 under 80 ms over 30 runs", async ({ annotate }) => {
    await withBuiltKernel(create, async (kernel) => {
      await kernel.start();
      const batches = await threeSamples(async () => {
        const durations: number[] = [];
        for (let index = 0; index < 30; index += 1) {
          const started = performance.now();
          await run(kernel, book.cell("sum"));
          durations.push(performance.now() - started);
        }
        return { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) };
      });
      const p50 = median(batches.map((batch) => batch.p50));
      const p95 = median(batches.map((batch) => batch.p95));
      await annotate(`execute 1 + 1: p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
      expect(p50).toBeLessThan(withTolerance(30));
      expect(p95).toBeLessThan(withTolerance(80));
    });
  });
});
