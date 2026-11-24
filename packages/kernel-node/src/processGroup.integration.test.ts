// Tests that what a cell starts ends with its kernel, through the real child (04-kernel §2): the kernel leads a process
// group of its own, which kill() and stop() signal, and which the daemon side signals again when the kernel exits by
// itself. A cell spawns a long `sleep` (its pid the cell's value), or runs one through execSync in a raw immediate so
// the kernel is blocked in it (the shell says its pid on fd 1, the kernel log); after kill(), after stop() (at its
// shutdown, or at its SIGKILL fallback while the kernel is blocked) and after the kernel's own exit, the grandchild is
// gone within a bounded wait on its pid. Each test kills a grandchild still alive at its end. And once the kernel's own
// exit was seen, kill() and stop() signal nothing (process.kill on this side, the daemon's, recorded): the exit already
// signalled the group, and its pid may since name another process.
import type { KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { alive } from "./fixtures/launchWorld.js";
import type { KernelWorld } from "./fixtures/kernelWorld.js";
import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";

const book = cellBook({
  spawned:
    'import { spawn } from "node:child_process"\nspawn("sleep", ["30"], { stdio: "ignore" }).pid',
  blocked: [
    'import { execSync } from "node:child_process"',
    'globalThis.setImmediate(() => execSync("echo grandchild $$; exec sleep 30", { stdio: "inherit" }))',
    "1",
  ].join("\n"),
  exits: "process.exit(3)",
});

beforeAll(() => {
  book.compile(compileCell);
});

/** `pid`, alive now, killed when the test ends if it still is: a grandchild the kernel failed to end. */
function reaped(pid: number): number {
  expect(alive(pid)).toBe(true);
  onTestFinished(() => {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  });
  return pid;
}

/** The pid of the `sleep` a cell spawned: the cell's value. */
async function spawned({ run }: KernelWorld): Promise<number> {
  const events: readonly KernelEvent[] = await run(book.cell("spawned"));
  const found = events.find((event) => event.kind === "output" && event.output.kind === "value");
  const pid =
    found?.kind === "output" && found.output.kind === "value" ? decode(found.output.json) : 0;
  return reaped(Number(pid));
}

/** The pid of the `sleep` that execSync runs in a raw immediate, blocking the kernel: the shell says it on fd 1. */
async function blocked({ run, until, seen }: KernelWorld): Promise<number> {
  expect((await run(book.cell("blocked"))).at(-1)).toMatchObject({ status: "ok" });
  await until(({ logs }) => logs.some((line) => /^grandchild \d+$/.test(line)));
  const line = seen.logs.find((one) => /^grandchild \d+$/.test(one)) ?? "";
  return reaped(Number(line.slice("grandchild ".length)));
}

/** Waits, a few seconds at most, for `pid` to be gone. */
async function gone(pid: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(alive(pid)).toBe(false);
    },
    { timeout: 5000, interval: 20 },
  );
}

describe("a kernel's kill ends the processes its cells started", () => {
  it("kill() ends a sleep a cell spawned", async () => {
    await withKernel(async (world) => {
      const pid = await spawned(world);
      await world.kernel.kill();
      await gone(pid);
    });
  });

  it("kill() ends a sleep execSync runs while it blocks the kernel", async () => {
    await withKernel(async (world) => {
      const pid = await blocked(world);
      await world.kernel.kill();
      await gone(pid);
    });
  });
});

describe("a kernel's stop or own exit ends the processes its cells started", () => {
  it("stop() ends a sleep a cell spawned, at the kernel's shutdown", async () => {
    await withKernel(async (world) => {
      const pid = await spawned(world);
      await world.kernel.stop();
      await gone(pid);
    });
  });

  it("stop() ends a sleep execSync runs while it blocks the kernel, at its SIGKILL fallback", async () => {
    await withKernel(
      async (world) => {
        const pid = await blocked(world);
        await world.kernel.stop();
        await gone(pid);
      },
      { kernel: { stopTimeoutMs: 100 } },
    );
  });

  it("the kernel's own exit ends a sleep a cell spawned", async () => {
    await withKernel(async (world) => {
      const pid = await spawned(world);
      await expect(world.run(book.cell("exits"))).rejects.toMatchObject({ name: "KernelDead" });
      await gone(pid);
      expect(world.seen.exits).toEqual([{ exitCode: 3 }]);
    });
  });
});

describe("a kernel whose own exit was seen", () => {
  it("is signalled no more by kill() or stop(), since its pid may name another process by then", async () => {
    await withKernel(async (world) => {
      await expect(world.run(book.cell("exits"))).rejects.toMatchObject({ name: "KernelDead" });
      expect(world.seen.exits).toEqual([{ exitCode: 3 }]);
      const kill = vi.spyOn(process, "kill");
      onTestFinished(() => {
        kill.mockRestore();
      });
      await world.kernel.kill();
      await world.kernel.stop();
      expect(kill.mock.calls).toEqual([]);
    });
  });
});
