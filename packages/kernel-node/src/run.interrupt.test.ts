// Tests a run the daemon ended as interrupted, with the kernel's real interrupt hook and its real stack
// check; only the termination is a stub, since a real one would end the test's own code: taken from the inbox already
// interrupted, the run sends nothing; interrupted while the kernel prepared it (the daemon's call arriving while the
// cell's previous disposer ran), it sends `running`, then `interrupted` and the export table, without calling its cell.
import { compileCell } from "@jsnb/test-tools/kernel";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { userCodeFrame } from "./builtins/userCode.js";
import type { Harness } from "./fixtures/realmHarness.js";
import { cellBook, createHarness, warmUp } from "./fixtures/realmHarness.js";
import { pushedContext } from "./asyncContexts.js";
import { createInterrupts } from "./interruptHook.js";
import { cellOnStack, outsideFramesOnStack, userCodeOnStack } from "./stackReads.js";
import { ownCodeDirectories } from "./kernelFiles.js";

const book = cellBook({
  loud: 'console.log("called")\nexport const kept = 1\n2',
  disposing: "dispose(() => interruptNow())\nexport const kept = 1\n2",
});

beforeAll(async () => {
  book.compile(compileCell);
  await warmUp(compileCell);
});

let harness: Harness;
afterEach(() => {
  harness.close();
  Reflect.deleteProperty(globalThis, "interruptNow");
});

/**
 * The kernel's interrupt hook over the real checks, its terminations recorded (stub: they would end the test) and its
 * notices of code outside the cells (the test runner's frames) dropped.
 */
function realHook() {
  const terminations: number[] = [];
  const interrupts = createInterrupts({
    userCodeRunning: () => userCodeOnStack(userCodeFrame),
    outsideFrames: () => outsideFramesOnStack(ownCodeDirectories),
    reportOutside: () => undefined,
    pushedContext,
    runningCell: () => cellOnStack((url) => harness.realm.compiler.cellOf(url)),
    runningStore: () => undefined,
    terminate: () => terminations.push(1),
    afterYield: (forget) => {
      setImmediate(forget);
    },
  });
  return { interrupts, terminations };
}

describe("runCell for an execution the daemon interrupted", () => {
  it("runs nothing when the execution was interrupted before the kernel took it", async () => {
    const { interrupts, terminations } = realHook();
    const cell = book.cell("loud");
    interrupts.interrupt([cell.execution]);
    harness = createHarness({ interrupted: interrupts.has });
    expect(await harness.run(cell)).toEqual([]);
    expect(terminations).toEqual([]);
  });

  it("ends a run interrupted while it was prepared without calling its cell", async () => {
    const { interrupts, terminations } = realHook();
    harness = createHarness({ interrupted: interrupts.has });
    await harness.run(book.cell("disposing"));
    const next = book.cell("disposing");
    Reflect.set(globalThis, "interruptNow", () => {
      interrupts.interrupt([next.execution]);
    });
    const messages = await harness.run(next);
    expect(messages.map((m) => (m.type === "status" ? m.status : m.type))).toEqual([
      "running",
      "interrupted",
      "exports",
    ]);
    expect(messages.at(-1)).toEqual({ type: "exports", names: [] });
    expect(terminations).toEqual([1]);
  });
});
