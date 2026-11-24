// Tests a NodeKernel's life against a real child: one start with the loader written, stop (graceful, then SIGKILL for a
// stuck kernel) and kill, around the start too, none of them reported to onExit, and KernelDead for what is asked after.
import { readFileSync } from "node:fs";

import { KernelDead } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "../fixtures/kernelWorld.js";
import { alive } from "../fixtures/launchWorld.js";
import { cellBook } from "../fixtures/realmHarness.js";
import { loaderSource } from "./loader.js";

const book = cellBook({ one: "1 + 1", spin: "while (true) {}" });

beforeAll(() => {
  book.compile(compileCell);
});

describe("a NodeKernel's start and stop", () => {
  it("starts once, reports its pid and inspector, writes the loader, and stops", async () => {
    await withKernel(
      async ({ kernel, ws, seen }) => {
        expect(() => kernel.execute(book.cell("one"))).toThrow(KernelDead);
        const starting = kernel.start();
        expect(kernel.start()).toBe(starting);
        const { inspectorUrl } = await starting;
        expect(inspectorUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/[\w-]+$/);
        expect([kernel.inspectorUrl(), kernel.paused()]).toEqual([inspectorUrl, false]);
        const pid = kernel.pid() ?? 0;
        expect(alive(pid)).toBe(true);
        expect(readFileSync(ws.path(".jsnb", "loader.mjs"), "utf8")).toBe(loaderSource);
        const stopping = kernel.stop();
        expect(kernel.stop()).toBe(stopping);
        await stopping;
        expect([alive(pid), kernel.pid(), kernel.inspectorUrl()]).toEqual([
          false,
          undefined,
          undefined,
        ]);
        expect(() => kernel.execute(book.cell("one"))).toThrow(KernelDead);
        await expect(kernel.interrupt()).rejects.toBeInstanceOf(KernelDead);
        expect(seen.exits).toEqual([]);
      },
      { start: false },
    );
  });
});

describe("a NodeKernel ended by kill() or a stop timeout", () => {
  it("kills a kernel at once without reporting the exit", async () => {
    await withKernel(async ({ kernel, seen }) => {
      const pid = kernel.pid() ?? 0;
      await kernel.kill();
      await kernel.kill();
      expect([alive(pid), seen.exits]).toEqual([false, []]);
    });
  });

  it("stops a stuck kernel with SIGKILL once the stop timeout passed", async () => {
    await withKernel(
      async ({ kernel, seen }) => {
        const events = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
        expect((await events.next()).value).toMatchObject({ status: "running" });
        const pid = kernel.pid() ?? 0;
        await kernel.stop();
        expect(alive(pid)).toBe(false);
        await expect(events.next()).rejects.toMatchObject({ data: { signal: "SIGKILL" } });
        expect(seen.exits).toEqual([]);
      },
      { kernel: { stopTimeoutMs: 100 } },
    );
  });
});

describe("a NodeKernel stopped or killed around its start", () => {
  it("rejects the start with KernelDead when stopped before it", async () => {
    await withKernel(
      async ({ kernel }) => {
        await kernel.stop();
        await expect(kernel.start()).rejects.toBeInstanceOf(KernelDead);
        expect(kernel.pid()).toBeUndefined();
      },
      { start: false },
    );
  });

  it("rejects the start with KernelDead when killed once the child exists", async () => {
    await withKernel(
      async ({ kernel, until, seen }) => {
        const starting = kernel.start();
        await until((s) => s.logs.some((line) => line.startsWith("Debugger listening")));
        await kernel.kill();
        await expect(starting).rejects.toBeInstanceOf(KernelDead);
        expect(seen.exits).toEqual([]);
      },
      { start: false },
    );
  });
});
