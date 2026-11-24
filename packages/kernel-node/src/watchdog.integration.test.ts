// Tests the kernel's watchdog through the real child (04-kernel §2): a process of its own stands in for the daemon
// (fixtures/standInDaemon.ts), whose kernel's cell spawns a long `sleep` and then spins. The test kills the stand-in
// with SIGKILL. The spinning kernel never runs its IPC disconnect handler, and its watchdog thread kills the kernel's
// process group once its parent pid changed: the kernel and the sleep are gone within a few seconds, which a bounded
// wait checks. And a kernel run under Node's permission model without --allow-worker, whose watchdog Worker Node
// refuses, starts without it and says so in its log.
import { compileCell, kernelEntry } from "@jsnb/test-tools/kernel";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it, vi } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { alive } from "./fixtures/launchWorld.js";
import { startStandIn } from "./fixtures/standInDaemon.js";

/** Node's permission model with everything a kernel uses allowed except threads, so the watchdog's Worker is refused. */
const noThreads = [
  "--permission",
  "--allow-fs-read=*",
  "--allow-fs-write=*",
  "--allow-inspector",
  "--allow-child-process",
  "--allow-net",
];

describe("a kernel whose watchdog cannot start", () => {
  it("starts without it and says so in its log", async () => {
    const entry = { ...kernelEntry, execArgv: [...kernelEntry.execArgv, ...noThreads] };
    await withKernel(
      async ({ run, until }) => {
        const said = "the watchdog could not start";
        await until(({ logs }) => logs.some((line) => line.includes(said)));
        expect(
          (await run(compileCell("1 + 1", { cell: "c_sum000", execution: "x_sum00000" }))).at(-1),
        ).toMatchObject({
          status: "ok",
        });
      },
      { kernel: { entry } },
    );
  });
});

describe("a kernel whose daemon died while its cell spins", () => {
  it("is killed by its watchdog within a few seconds, with what its cell started", async () => {
    await withWorkspace(async (ws) => {
      const { daemon, pids } = await startStandIn(ws, "spinning");
      expect(pids.map(alive)).toEqual([true, true]);
      daemon.kill("SIGKILL");
      await vi.waitFor(
        () => {
          expect(pids.map(alive)).toEqual([false, false]);
        },
        { timeout: 5000, interval: 50 },
      );
    });
  });
});
