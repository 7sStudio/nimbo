// Tests the daemon's side of an interrupt through a NodeKernel and a real child (04-kernel §6): one evaluate of the
// kernel's hook at a time, so two interrupts in a row stop a spinning cell (two evaluates the kernel's inspector ran
// together left it spinning and the kernel deaf); what is sent while interrupts are pending is held until every one is
// answered, then reaches the kernel after the hook in the order it was sent; what is held when the kernel dies fails
// with KernelDead; and when another inspector client's evaluate right behind the hook's takes the termination in its
// place, the second hook evaluate the daemon sends after one that ended live executions stops the cell.
import { KernelDead } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "../fixtures/kernelWorld.js";
import { cellBook } from "../fixtures/realmHarness.js";
import { connectCdp } from "./inspector.js";

const book = cellBook({
  counter: "let counted = 0\nexport function count() { counted += 1; return counted }",
  spin: "while (true) {}",
});

beforeAll(() => {
  book.compile(compileCell);
});

describe("interrupts in a row", () => {
  it("stop a spinning cell, and what is sent meanwhile is held, then sent in order and answered", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("counter"));
      const events = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
      expect((await events.next()).value).toMatchObject({ status: "running" });
      await Promise.all([kernel.interrupt(), kernel.interrupt()]);
      const counts = [kernel.call("count", []), kernel.call("count", [])];
      expect(await Promise.all(counts)).toEqual([
        { value: 1, redacted: false },
        { value: 2, redacted: false },
      ]);
      expect((await events.next()).value).toMatchObject({ status: "interrupted" });
    });
  });

  it("stop a cell whose first termination another client's evaluate took, with no second interrupt", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("counter"));
      const url = kernel.inspectorUrl() ?? "";
      const devTools = await connectCdp(url, { onPause: () => false, onInvalid: () => false });
      const events = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
      expect((await events.next()).value).toMatchObject({ status: "running" });
      const interrupted = kernel.interrupt();
      const evaluated = devTools.send("Runtime.evaluate", { expression: "1" }).catch(() => "taken");
      await Promise.all([interrupted, evaluated]);
      expect(await kernel.call("count", [])).toEqual({ value: 1, redacted: false });
      devTools.close();
    });
  });
});

describe("sends held while an interrupt is pending", () => {
  it("fail with KernelDead when the kernel dies before the interrupt is answered", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("counter"));
      const events = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
      expect((await events.next()).value).toMatchObject({ status: "running" });
      await kernel.interrupt();
      const held = kernel.call("count", []);
      await kernel.kill();
      await expect(held).rejects.toBeInstanceOf(KernelDead);
    });
  });
});
