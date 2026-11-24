// Tests the process-hook check of 04-kernel §3.3 over an emitter standing in for `process` (fixtures/hookedEmitter.ts, a
// stub named as one: replacing the test process's own hooks would deafen Vitest's IPC; the real process is tested
// through the real child in processHooks.integration.test.ts). A replacement that does not deliver is put back for Node's own at once and reported once probed, whether it queues
// nothing, drops the arguments, throws, is no function, drops "message" or lives on a replaced prototype; a wrapper that
// calls the original is kept as it was; one locked in place is reported as not restored; and a send runs under Node's
// own nextTick, the cell's fake put back afterwards.
import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { nodeEmit, nodeTick, silent, standIn } from "./fixtures/hookedEmitter.js";
import { captureProcessHooks } from "./processHooks.js";

/** Runs a probe's call of a replacement as it is (the realm runs it under the blamed cell's store). */
const direct = (call: () => void): void => {
  call();
};

/** An emit that calls EventEmitter's, as signal-exit's wrapper does. */
function forwarding(this: unknown, ...args: unknown[]): unknown {
  if (typeof nodeEmit !== "function") throw new Error("EventEmitter has no emit");
  return Reflect.apply(nodeEmit, this, args);
}

describe("captureProcessHooks with Node's own hooks", () => {
  it("checks nothing and runs a send as it is", () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    expect(hooks.check(direct)).toBeUndefined();
    expect(hooks.withNodeNextTick(() => proc.nextTick)).toBe(nodeTick);
  });
});

describe("a nextTick that does not deliver", () => {
  const cases: Record<string, unknown> = {
    "queues nothing": silent,
    "drops the arguments": (fn: () => void) => {
      nodeTick(fn);
    },
    throws: () => {
      throw new Error("no ticks here");
    },
    "is no function": 5,
  };
  for (const [what, replacement] of Object.entries(cases)) {
    it(`is put back for Node's own at once and reported when it ${what}`, async () => {
      const proc = standIn();
      const hooks = captureProcessHooks(proc);
      proc.nextTick = replacement;
      const decided = hooks.check(direct);
      expect(proc.nextTick).toBe(nodeTick);
      expect(await decided).toEqual([{ name: "process.nextTick", restored: true }]);
      expect(proc.nextTick).toBe(nodeTick);
    });
  }
});

describe("the probes' calls", () => {
  it("go through the runner they are given, one per replacement", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    proc.nextTick = silent;
    proc.emit = silent;
    let calls = 0;
    const findings = await hooks.check((call) => {
      calls += 1;
      call();
    });
    expect([calls, findings?.length]).toEqual([2, 2]);
  });
});

describe("a nextTick that delivers", () => {
  it("is kept: put back as it was once probed", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const wrapper = (...args: Parameters<typeof nodeTick>): void => {
      nodeTick(...args);
    };
    proc.nextTick = wrapper;
    const decided = hooks.check(direct);
    expect(proc.nextTick).toBe(nodeTick);
    expect(await decided).toEqual([]);
    expect(proc.nextTick).toBe(wrapper);
  });

  it("is left alone when the cell replaced it again before the probe decided", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    proc.nextTick = (...args: Parameters<typeof nodeTick>): void => {
      nodeTick(...args);
    };
    const decided = hooks.check(direct);
    const again = (...args: Parameters<typeof nodeTick>): void => {
      nodeTick(...args);
    };
    proc.nextTick = again;
    expect(await decided).toEqual([]);
    expect(proc.nextTick).toBe(again);
  });
});

describe("an emit that does not deliver", () => {
  it("is put back (its own property removed) and reported when it drops everything", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    proc.emit = () => false;
    expect(await hooks.check(direct)).toEqual([{ name: "process.emit", restored: true }]);
    expect(Object.hasOwn(proc, "emit")).toBe(false);
  });

  it("is reported when it drops only message; the probe reaches no listener of the cell, and leaves none", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const heard: unknown[] = [];
    proc.on("message", (message: unknown) => heard.push(message));
    proc.emit = function (this: unknown, event: unknown, ...args: unknown[]): unknown {
      return event === "message" ? false : Reflect.apply(forwarding, this, [event, ...args]);
    };
    expect(await hooks.check(direct)).toEqual([{ name: "process.emit", restored: true }]);
    proc.emit = forwarding;
    expect(await hooks.check(direct)).toEqual([]);
    expect([proc.emit, heard, proc.listenerCount("message")]).toEqual([forwarding, [], 1]);
  });

  it("is shadowed by Node's own when the prototype's emit was replaced", async () => {
    class Patched extends EventEmitter {}
    const proc = standIn(Patched.prototype);
    const hooks = captureProcessHooks(proc);
    Patched.prototype.emit = () => false;
    expect(await hooks.check(direct)).toEqual([{ name: "process.emit", restored: true }]);
    expect([Object.hasOwn(proc, "emit"), proc.emit]).toEqual([true, nodeEmit]);
  });
});

describe("a hook Node's own goes back on another way", () => {
  it("puts Node's nextTick back as a value when the cell's is writable but no longer configurable", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    Object.defineProperty(proc, "nextTick", { value: silent, writable: true, configurable: false });
    expect(await hooks.check(direct)).toEqual([{ name: "process.nextTick", restored: true }]);
    expect(proc.nextTick).toBe(nodeTick);
  });

  it("puts Node's emit back as a value over a cell's own that is writable but no longer configurable", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    Object.defineProperty(proc, "emit", { value: silent, writable: true, configurable: false });
    expect(await hooks.check(direct)).toEqual([{ name: "process.emit", restored: true }]);
    expect(proc.emit).toBe(nodeEmit);
  });

  it("keeps a wrapper on a replaced prototype by removing the shadow it was probed through", async () => {
    class Patched extends EventEmitter {}
    const proc = standIn(Patched.prototype);
    const hooks = captureProcessHooks(proc);
    Reflect.set(Patched.prototype, "emit", forwarding);
    const decided = hooks.check(direct);
    expect([Object.hasOwn(proc, "emit"), proc.emit]).toEqual([true, nodeEmit]);
    expect(await decided).toEqual([]);
    expect([Object.hasOwn(proc, "emit"), proc.emit]).toEqual([false, forwarding]);
  });
});

describe("a hook locked in place", () => {
  it("is reported as not restored, and a send runs under it as it is", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    Object.defineProperty(proc, "nextTick", {
      value: silent,
      writable: false,
      configurable: false,
    });
    expect(hooks.withNodeNextTick(() => proc.nextTick)).toBe(silent);
    expect(await hooks.check(direct)).toEqual([{ name: "process.nextTick", restored: false }]);
  });
});

describe("a send under a fake nextTick", () => {
  it("runs under Node's own, the fake put back afterwards, even when the send throws", () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    proc.nextTick = silent;
    expect(hooks.withNodeNextTick(() => proc.nextTick)).toBe(nodeTick);
    expect(proc.nextTick).toBe(silent);
    expect(() =>
      hooks.withNodeNextTick(() => {
        throw new Error("refused");
      }),
    ).toThrow("refused");
    expect(proc.nextTick).toBe(silent);
  });
});
