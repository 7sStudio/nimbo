// The built kernel through its default entry (dist/main.js, what users run), in the integration stage: it starts, an
// interrupt ends `while (true) {}`, and the next cell answers.
import type { KernelEvent } from "@jsnb/core";
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { loadBuiltKernel, withBuiltKernel } from "../fixtures/builtKernel.js";
import { cellBook } from "../fixtures/realmHarness.js";
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

describe("the built kernel", () => {
  it("starts, interrupts while (true) {} and answers the next cell", async () => {
    await withBuiltKernel(create, async (kernel) => {
      await kernel.start();
      const events = kernel.execute(book.cell("spin"))[Symbol.asyncIterator]();
      expect((await events.next()).value).toMatchObject({ status: "running" });
      await kernel.interrupt();
      expect((await events.next()).value).toMatchObject({ status: "interrupted" });
      expect((await run(kernel, book.cell("sum"))).at(-1)).toMatchObject({ status: "ok" });
    });
  });
});
