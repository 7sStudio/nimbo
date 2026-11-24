// Tests the interrupt hook's decision (04-kernel §6) over its real checks (stackReads.test.ts tests those):
// the interrupted executions remembered, the last 1 000, a refusal included; a termination requested only when user
// code is on the stack, and only in a context a termination leaves intact, by the real async context: in one Node
// entered from JavaScript the hook terminates nothing and answers the context with the cell whose frame it found
// (interruptHook.secondCall.test.ts tests the daemon's second call); with no user code on the stack, the frames of code
// outside the cells named once in a notice; a context check that throws taken for a refusal (its throw a stub); the
// hook defined out of user code's reach. The termination itself is a stub, recorded: a real one would end the test's
// code.
import { AsyncLocalStorage, AsyncResource, createHook } from "node:async_hooks";
import { readFile } from "node:fs";

import { describe, expect, it } from "vitest";

import { callUserCode } from "./builtins/userCode.js";
import { realHook } from "./fixtures/realHook.js";
import { asCell } from "./fixtures/scripts.js";
import { installHook, interruptKey } from "./interruptHook.js";

describe("createInterrupts", () => {
  it("remembers the executions it is given and terminates only when user code is running", () => {
    const { interrupts, terminations } = realHook();
    interrupts.interrupt(["x_00000001", 7, "x_00000002"]);
    interrupts.interrupt("x_00000003");
    expect(["x_00000001", "x_00000002", "x_00000003"].map(interrupts.has)).toEqual([
      true,
      true,
      false,
    ]);
    expect(terminations).toEqual([]);
    callUserCode(
      () => {
        interrupts.interrupt([]);
      },
      undefined,
      [],
    );
    expect(terminations).toEqual([1]);
  });

  it("remembers the last 1000 executions", () => {
    const { interrupts } = realHook();
    const ids = Array.from({ length: 1001 }, (_, n) => `x_${String(n).padStart(8, "0")}`);
    interrupts.interrupt(ids);
    expect([ids[0] ?? "", ids[1] ?? "", ids[1000] ?? ""].map(interrupts.has)).toEqual([
      false,
      true,
      true,
    ]);
  });
});

/**
 * What the hook answers when `call` (cell code by default) calls it with an execution inside the callback `schedule`
 * runs, its terminations, and whether it remembered the execution.
 */
function answerIn(
  schedule: (callback: () => void) => void,
  call: (interrupt: () => unknown) => unknown = asCell,
): Promise<unknown> {
  const { interrupts, terminations } = realHook();
  return new Promise((resolve) => {
    schedule(() => {
      const answer = call(() => interrupts.interrupt(["x_00000009"]));
      resolve([answer, terminations.length, interrupts.has("x_00000009")]);
    });
  });
}

describe("createInterrupts in a context Node entered from JavaScript", () => {
  it("terminates nothing, remembers the execution and answers the context with the cell found", async () => {
    const timer = (callback: () => void) => setTimeout(callback, 0); // under test: a raw timer's context
    const tick = (callback: () => void): void => {
      process.nextTick(callback);
    };
    const scope = (callback: () => void): void => {
      new AsyncResource("X").runInAsyncScope(callback);
    };
    const microtask = (callback: () => void): void => {
      new AsyncLocalStorage().run(1, () => {
        queueMicrotask(callback);
      });
    };
    const answers = [
      await answerIn(timer),
      await answerIn(setImmediate),
      await answerIn(tick),
      await answerIn(scope),
      await answerIn(microtask),
    ];
    const contexts = ["Timeout", "Immediate", "TickObject", "AsyncResource", "AsyncResource"];
    expect(answers).toEqual(contexts.map((context) => [{ context, cell: "c_aaaaaa" }, 0, true]));
  });
});

describe("createInterrupts in a promise job", () => {
  it("answers a promise job's context under an async hook, and no cell when no cell's frame is found", async () => {
    const job = (callback: () => void): void => {
      void Promise.resolve().then(callback);
    };
    const hook = createHook({ before: () => undefined, after: () => undefined }).enable();
    try {
      expect(await answerIn(job)).toEqual([{ context: "Promise", cell: "c_aaaaaa" }, 0, true]);
    } finally {
      hook.disable();
    }
    const userCode = (interrupt: () => unknown): unknown => callUserCode(interrupt, undefined, []);
    expect(await answerIn(setImmediate, userCode)).toEqual([{ context: "Immediate" }, 0, true]);
  });

  it("terminates in a promise job, where the kernel starts user code, and in a native callback", async () => {
    const job = (callback: () => void): void => {
      void Promise.resolve().then(callback);
    };
    const read = (callback: () => void): void => {
      readFile(import.meta.filename, callback);
    };
    expect([await answerIn(job), await answerIn(read)]).toEqual([
      [undefined, 1, true],
      [undefined, 1, true],
    ]);
  });
});

describe("createInterrupts whose context check throws (stub: no real resource makes it throw)", () => {
  it("refuses as an AsyncResource scope, terminating nothing: no termination is safe there", () => {
    const { interrupts, terminations } = realHook({
      pushedContext: () => {
        throw new Error("a trap of the resource ran");
      },
    });
    const answer = asCell(() => interrupts.interrupt(["x_00000009"]));
    expect([answer, terminations, interrupts.has("x_00000009")]).toEqual([
      { context: "AsyncResource", cell: "c_aaaaaa" },
      [],
      true,
    ]);
  });
});

describe("createInterrupts with no user code on the stack", () => {
  it("names the frames of code outside the cells in one notice, and terminates nothing", () => {
    const { interrupts, terminations, reports } = realHook();
    expect(interrupts.interrupt([])).toBeUndefined();
    expect(terminations).toEqual([]);
    // The test runner's own frames are code outside the cells here: files under node_modules.
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContainEqual(expect.stringContaining("node_modules"));
  });

  it("names nothing on a second call, or when only the kernel's code and Node's run", () => {
    const again = realHook({ runningStore: () => ({ cell: "c_aaaaaa", execution: "x_00000001" }) });
    again.interrupts.interrupt(["x_00000001"], true);
    const kernelOnly = realHook({ outsideFrames: () => [] });
    kernelOnly.interrupts.interrupt([]);
    expect([again.reports, again.terminations, kernelOnly.reports]).toEqual([[], [], []]);
  });
});

describe("installHook", () => {
  it("defines the hook under its symbol, not writable, not configurable and not enumerable", () => {
    const target = {};
    const hook = (): undefined => undefined;
    installHook(target, hook);
    expect(Reflect.get(target, interruptKey)).toBe(hook);
    expect(Object.getOwnPropertyDescriptor(target, interruptKey)).toMatchObject({
      writable: false,
      configurable: false,
      enumerable: false,
    });
    expect(Reflect.set(target, interruptKey, () => 1)).toBe(false);
    expect(interruptKey).toBe(Symbol.for("jsnb.kernel.interrupt"));
  });
});
