// The kernel's interrupt hook over its real checks (the stack, the async context, the cell, the kernel's files) for its
// unit tests (interruptHook*.test.ts), its terminations and notices recorded, a terminated store forgotten through a
// real setImmediate, and any dependency replaceable. The termination itself is a stub, recorded: a real one would end
// the test's code.
import { pushedContext } from "../asyncContexts.js";
import { userCodeFrame } from "../builtins/userCode.js";
import type { InterruptDeps } from "../interruptHook.js";
import { createInterrupts } from "../interruptHook.js";
import { ownCodeDirectories } from "../kernelFiles.js";
import { cellOnStack, outsideFramesOnStack, userCodeOnStack } from "../stackReads.js";
import { cellOf } from "./scripts.js";

/** The hook over the real checks, its terminations and notices recorded; `deps` replaces any of its dependencies. */
export function realHook(deps: Partial<InterruptDeps> = {}) {
  const terminations: number[] = [];
  const reports: (readonly string[])[] = [];
  const interrupts = createInterrupts({
    userCodeRunning: () => userCodeOnStack(userCodeFrame),
    outsideFrames: () => outsideFramesOnStack(ownCodeDirectories),
    reportOutside: (frames) => reports.push(frames),
    pushedContext,
    runningCell: () => cellOnStack(cellOf),
    runningStore: () => undefined,
    terminate: () => terminations.push(1),
    afterYield: (forget) => {
      setImmediate(forget);
    },
    ...deps,
  });
  return { interrupts, terminations, reports };
}
