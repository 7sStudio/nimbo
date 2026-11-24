// The daemon's budgets of 09-testing §7 on the built daemon and kernel (dist/, server:integration): cell.run of `1 + 1`
// round trip < 30 ms p50 and < 80 ms p95, an interrupt of `while (true) {}` < 200 ms to `interrupted`, a kernel start
// to `ready` through notebook.open < 400 ms; each the median of three samples with the 20 % tolerance. The figures and
// the load average go to stderr.
import type { Connected } from "./fixtures/daemon.js";
import { connectDaemon } from "./fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { readServerJson, spawnBuiltDaemon } from "./fixtures/builtDaemon.js";
import { median, percentile, report, threeSamples, withTolerance } from "./fixtures/timing.js";

/** Runs `fn` with clients of a built daemon over a fresh workspace. */
async function withBuiltDaemon(
  fn: (daemon: Connected, ws: { path: (...parts: string[]) => string }) => Promise<void>,
) {
  await withWorkspace(async (ws) => {
    const process = spawnBuiltDaemon(ws);
    const { url } = await process.listening;
    const daemon = await connectDaemon({ url, token: (await readServerJson(ws)).token });
    try {
      await fn(daemon, ws);
    } finally {
      daemon.close();
      process.child.kill("SIGTERM");
      await process.exited;
    }
  });
}

describe("cell.run of 1 + 1 through the built daemon", () => {
  it("round-trips in under 30 ms p50 and 80 ms p95", async () => {
    await withBuiltDaemon(async ({ client }) => {
      const notebook = "budget.jsnb";
      await client.notebook.create({ path: notebook });
      const { cell } = await client.cell.add({
        notebook,
        type: "server",
        source: "1 + 1",
        run: true,
      });
      const once = async (): Promise<number> => {
        const started = performance.now();
        await client.cell.run({ notebook, cell: cell.id });
        return performance.now() - started;
      };
      for (let warm = 0; warm < 5; warm += 1) await once();
      const batches = await threeSamples(async () => {
        const runs: number[] = [];
        for (let index = 0; index < 20; index += 1) runs.push(await once());
        return { p50: percentile(runs, 0.5), p95: percentile(runs, 0.95) };
      });
      const p50 = median(batches.map((batch) => batch.p50));
      const p95 = median(batches.map((batch) => batch.p95));
      report("cell.run 1 + 1", { p50, p95, batches });
      expect(p50).toBeLessThan(withTolerance(30));
      expect(p95).toBeLessThan(withTolerance(80));
    });
  });
});

describe("an interrupt of while (true) {} through the built daemon", () => {
  it("ends the run interrupted in under 200 ms", async () => {
    await withBuiltDaemon(async ({ client, events }) => {
      const notebook = "budget.jsnb";
      await client.notebook.create({ path: notebook });
      const { cell } = await client.cell.add({
        notebook,
        type: "server",
        source: "while (true) {}",
      });
      const samples = await threeSamples(async () => {
        const { execution } = await client.cell.run({ notebook, cell: cell.id, wait: false });
        await events.until(
          "cell.status",
          (e) => e.data.execution === execution.id && e.data.status === "running",
        );
        const started = performance.now();
        await client.kernel.interrupt({ notebook });
        await events.until(
          "cell.status",
          (e) => e.data.execution === execution.id && e.data.status === "interrupted",
        );
        return performance.now() - started;
      });
      report("interrupt", { median: median(samples), samples });
      expect(median(samples)).toBeLessThan(withTolerance(200));
    });
  });
});

describe("a kernel start through notebook.open on the built daemon", () => {
  it("reaches ready in under 400 ms", async () => {
    await withBuiltDaemon(async ({ client, events }) => {
      let next = 0;
      const samples = await threeSamples(async () => {
        next += 1;
        const notebook = `start-${String(next)}.jsnb`;
        await client.notebook.create({ path: notebook });
        await client.notebook.close({ notebook });
        const before = events.all().length; // the create's own kernel start does not count
        const started = performance.now();
        await client.notebook.open({ path: notebook });
        await events.until(
          "kernel.status",
          (e) =>
            e.notebook === notebook && e.data.state === "idle" && events.all().indexOf(e) >= before,
        );
        return performance.now() - started;
      });
      report("kernel start", { median: median(samples), samples });
      expect(median(samples)).toBeLessThan(withTolerance(400));
    });
  });
});
