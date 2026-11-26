// Tests interrupts aimed at a run the moment its `running` arrives, through the real child: a fresh
// kernel's very first run, with nothing warmed by an earlier cell, and many rounds of trivial, printing and
// heavy-valued cells whose interrupt often reaches the kernel while its own code runs after the cell (encode, repr,
// flush, the status), where the hook terminates nothing; each round is followed by a cell that must answer.
import type { KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import { compileCell } from "@jsnb/test-tools/kernel";
import { beforeAll, describe, expect, it } from "vitest";

import { withKernel } from "./fixtures/kernelWorld.js";
import { cellBook } from "./fixtures/realmHarness.js";
import type { NodeKernel } from "./ipc/nodeKernel.js";

const book = cellBook({
  keep: "const keep = 41",
  spin: "while (true) {}",
  sum: "1 + 1",
  next: "keep + 1",
  printing: 'console.log("tick")\n2',
  heavy: "Array.from({ length: 4000 }, (_, i) => ({ i, text: 'x'.repeat(16), when: new Date(i) }))",
});

type Name = Parameters<typeof book.cell>[0];

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

/** Runs `name`, interrupts it as soon as its `running` arrives, and returns the events that followed. */
async function interruptAtRunning(kernel: NodeKernel, name: Name): Promise<readonly KernelEvent[]> {
  const iterator = kernel.execute(book.cell(name))[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ status: "running" });
  await kernel.interrupt();
  const rest: KernelEvent[] = [];
  for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
    rest.push(next.value);
  }
  return rest;
}

describe("an interrupt that reaches a fresh kernel's first run", () => {
  it("ends a first run that spins as interrupted, and the next three runs answer", async () => {
    await withKernel(async ({ kernel, run }) => {
      expect((await interruptAtRunning(kernel, "spin")).at(-1)).toMatchObject({
        status: "interrupted",
      });
      for (let round = 0; round < 3; round += 1)
        expect(valueOf(await run(book.cell("sum")))).toBe(2);
    });
  });

  it("ends a trivial first run either way, and the next runs answer", async () => {
    await withKernel(async ({ kernel, run }) => {
      expect((await interruptAtRunning(kernel, "sum")).at(-1)?.kind).toBe("status");
      for (let round = 0; round < 3; round += 1)
        expect(valueOf(await run(book.cell("sum")))).toBe(2);
    });
  });
});

describe("interrupts that reach the kernel while its own code runs", () => {
  it("leave the kernel answering after every round of trivial, printing and heavy-valued cells", async () => {
    await withKernel(async ({ kernel, run }) => {
      await run(book.cell("keep"));
      const names: readonly Name[] = ["sum", "printing", "heavy"];
      for (let round = 0; round < 30; round += 1) {
        const rest = await interruptAtRunning(kernel, names[round % names.length] ?? "sum");
        expect(rest.at(-1)?.kind).toBe("status");
        expect(valueOf(await run(book.cell("next")))).toBe(42);
      }
    });
  });
});
