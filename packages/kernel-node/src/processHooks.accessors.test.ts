// Tests the process-hook check against accessors and Proxies, over the emitter standing in for
// `process` (fixtures/hookedEmitter.ts, a stub named as one; the real process is tested in
// processHookAccessors.integration.test.ts): the check and a send never run a cell's getter or trap; a hook that is an
// accessor, or found through a Proxy, is put aside for Node's own at once, and only the probe reads it, as user code;
// one that delivers is kept as it was, one that throws is reported, one locked in place is reported as not restored;
// and the probe's own listener goes on and off through EventEmitter's methods captured at start.
import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { nodeEmit, nodeTick, standIn } from "./fixtures/hookedEmitter.js";
import { captureProcessHooks } from "./processHooks.js";

/** Runs a probe's call as it is (the realm runs it under the blamed cell's store). */
const direct = (call: () => void): void => {
  call();
};

/** The value of `target`'s own data property `key`, read through its descriptor. */
function ownValue(target: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/** The getter of `target`'s own accessor `key`. */
function ownGetter(target: object, key: string): unknown {
  const descriptor: unknown = Object.getOwnPropertyDescriptor(target, key);
  return typeof descriptor === "object" && descriptor !== null
    ? Reflect.get(descriptor, "get")
    : undefined;
}

/** A tick that forwards to Node's own, as an APM agent's wrapper does. */
const forwardTick = (...args: Parameters<typeof nodeTick>): void => {
  nodeTick(...args);
};

/** A getter that records each read in `reads` and throws. */
const throwing = (reads: string[]) => (): never => {
  reads.push("get");
  throw new Error("no tick");
};

describe("a nextTick accessor whose getter throws", () => {
  it("is put aside without its getter running, and reported once the probe read it", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const reads: string[] = [];
    Object.defineProperty(proc, "nextTick", { get: throwing(reads), configurable: true });
    const decided = hooks.check((call) => {
      reads.push("probe");
      call();
    });
    expect([reads, ownValue(proc, "nextTick")]).toEqual([[], nodeTick]);
    expect(await decided).toEqual([{ name: "process.nextTick", restored: true }]);
    expect([reads, ownValue(proc, "nextTick")]).toEqual([["probe", "get"], nodeTick]);
  });

  it("is reported as not restored when it is locked in place", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    Object.defineProperty(proc, "nextTick", { get: throwing([]), configurable: false });
    expect(await hooks.check(direct)).toEqual([{ name: "process.nextTick", restored: false }]);
  });
});

describe("a nextTick accessor that delivers", () => {
  it("is kept as it was once probed", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const get = (): unknown => forwardTick;
    Object.defineProperty(proc, "nextTick", { get, configurable: true });
    expect(await hooks.check(direct)).toEqual([]);
    expect(ownGetter(proc, "nextTick")).toBe(get);
  });

  it("is never read by a send, which runs under Node's own, the accessor put back afterwards", () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const reads: string[] = [];
    const get = (): unknown => reads.push("get");
    Object.defineProperty(proc, "nextTick", { get, configurable: true });
    expect(hooks.withNodeNextTick(() => ownValue(proc, "nextTick"))).toBe(nodeTick);
    expect([reads, ownGetter(proc, "nextTick")]).toEqual([[], get]);
  });
});

describe("an emit behind an accessor on the prototype chain", () => {
  it("is shadowed by Node's own with no getter run, and the probe reads it with process as the receiver", async () => {
    class Patched extends EventEmitter {}
    const proc = standIn(Patched.prototype);
    const hooks = captureProcessHooks(proc);
    const receivers: unknown[] = [];
    Object.defineProperty(Patched.prototype, "emit", {
      get(this: unknown) {
        receivers.push(this);
        return () => false;
      },
      configurable: true,
    });
    const decided = hooks.check(direct);
    expect([receivers, ownValue(proc, "emit")]).toEqual([[], nodeEmit]);
    expect(await decided).toEqual([{ name: "process.emit", restored: true }]);
    expect(receivers).toEqual([proc]);
  });
});

/** A Proxy over an EventEmitter prototype whose traps record what they are asked. */
function recordingProxy(traps: string[]): object {
  return new Proxy(Object.create(EventEmitter.prototype) as object, {
    get: (target, key, receiver): unknown => {
      traps.push(`get ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor: (target, key) => {
      traps.push("getOwnPropertyDescriptor");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

describe("an emit found through a Proxy on the prototype chain", () => {
  it("runs no trap in the check, and is kept when the Proxy's get gives EventEmitter's emit", async () => {
    const traps: string[] = [];
    const proc = standIn(recordingProxy(traps));
    const hooks = captureProcessHooks(proc);
    traps.length = 0;
    const decided = hooks.check(direct);
    expect([traps, Object.hasOwn(proc, "emit")]).toEqual([[], true]);
    expect(await decided).toEqual([]);
    expect([traps.includes("get emit"), Object.hasOwn(proc, "emit")]).toEqual([true, false]);
  });
});

describe("the emit probe's listener", () => {
  it("goes on and off through EventEmitter's own methods, whatever replaced the process's", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const replaced = (): never => {
      throw new Error("replaced");
    };
    Object.assign(proc, { prependListener: replaced, removeListener: replaced, emit: () => false });
    expect(await hooks.check(direct)).toEqual([{ name: "process.emit", restored: true }]);
    expect(proc.listenerCount("message")).toBe(0);
  });
});
