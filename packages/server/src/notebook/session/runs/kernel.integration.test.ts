// kernel.interrupt through the daemon: a synchronous loop stopped with the queue cleared and
// the scope kept, a pending await abandoned, InterruptRefused for a loop a raw timer runs, the kernel answering again
// once that code returns, and an answer after the daemon's own second from a kernel that does not answer.
import { writeFileSync } from "node:fs";

import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { logged } from "../../../fixtures/folders.js";
import { createNotebook, valueOf } from "../../../fixtures/notebook.js";

describe("kernel.interrupt of `while (true) {}`", () => {
  it("stops it, ends the queued runs interrupted, and keeps the scope", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      await book.ran("const kept = 5");
      const spin = await book.add("while (true) {}");
      const spinning = await book.start(spin);
      const later = await book.add("kept");
      const queued = await book.start(later);
      await book.cellReaches(spin, "running");
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: spin });
      await book.reaches(spinning.id, "interrupted");
      await book.reaches(queued.id, "interrupted");
      // a run the interrupt took off the queue was stopped by the user, not by another cell's failure
      const cleared = await daemon.client.cell.outputs({ notebook, cell: later });
      expect(cleared.execution).toMatchObject({ status: "interrupted", durationMs: 0 });
      expect(cleared.execution?.stoppedBy).toBeUndefined();
      expect(valueOf((await book.ran("kept * 2")).execution)).toBe(10);
    });
  });
});

describe("kernel.interrupt of a pending await", () => {
  it("abandons the run as interrupted, and answers null when nothing runs", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const cell = await book.add("await new Promise(() => {})");
      const run = await book.start(cell);
      await book.cellReaches(cell, "running");
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: cell });
      const { execution } = await daemon.client.cell.outputs({ notebook, cell });
      expect(execution).toMatchObject({ id: run.id, status: "interrupted" });
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: null });
    });
  });
});

describe("kernel.interrupt of a loop in a raw timer callback", () => {
  it("fails INTERRUPT_REFUSED, and the kernel answers again once the loop returns", async () => {
    await withDaemon(async (daemon, ws) => {
      const book = await createNotebook(daemon);
      const [go, flag] = [JSON.stringify(ws.path("go")), JSON.stringify(ws.path("flag"))];
      // A raw interval (globalThis's, not the kernel's tracked timer) that starts to spin once the test says go, so
      // nothing the run sends waits behind the spin; it says on fd 1, the kernel log, that it spins.
      const spin = `clearInterval(id); writeSync(1, "spinning\\n"); while (!existsSync(${flag})) {}`;
      const source = `const id = globalThis.setInterval(() => { if (existsSync(${go})) { ${spin} } }, 5)`; // tested behaviour
      await book.ran(`import { existsSync, writeSync } from "node:fs"\n${source}`);
      writeFileSync(ws.path("go"), "");
      await logged(ws.path(".jsnb/logs/kernel-a.log"), "spinning");
      await expect(
        daemon.client.kernel.interrupt({ notebook: book.notebook }),
      ).rejects.toMatchObject({
        code: 1010,
        data: { context: "Timeout" },
      });
      writeFileSync(ws.path("flag"), "");
      expect(valueOf((await book.ran("1 + 1")).execution)).toBe(2);
    });
  });
});

describe("kernel.interrupt of a kernel that does not answer", () => {
  it("answers after the daemon's own second, and the kernel stops the loop once it goes on", async () => {
    await withDaemon(async (daemon, ws) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const cell = await book.add("while (true) {}");
      const run = await book.start(cell);
      await book.reaches(run.id, "running");
      const { pid } = await daemon.client.kernel.status({ notebook });
      process.kill(pid ?? 0, "SIGSTOP"); // the real kernel, held still as a stuck process or a debugger holds it
      expect(await daemon.client.kernel.interrupt({ notebook })).toEqual({ interrupted: cell });
      await book.reaches(run.id, "interrupted");
      await logged(ws.path(".jsnb/logs/daemon.log"), "did not answer in time");
      process.kill(pid ?? 0, "SIGCONT");
      expect(valueOf((await book.ran("1 + 1")).execution)).toBe(2);
    });
  });
});
