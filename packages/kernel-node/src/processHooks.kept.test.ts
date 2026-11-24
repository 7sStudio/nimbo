// Tests what the process-hook checks of 04-kernel §3.3 do with a replacement they kept, over the emitter standing in
// for `process` (fixtures/hookedEmitter.ts, a stub named as one; the real process is tested in
// processHooksKept.integration and processHookAccessors.integration): a wrapper function or an accessor found to
// deliver is not called again by a later check while it stays the same (the same value, getter or Proxy in the same
// descriptor), so one that has stopped delivering is found only by the interrupt hook's check (`recheck`), which puts a
// kept one aside for Node's own and probes it again; one whose descriptor changed, one made again after the kernel saw
// Node's own, and another one replacing it are probed as new; and a check skips the replacement a probe already awaits,
// and probes one the cell put in its place since.
import { describe, expect, it } from "vitest";

import { nodeTick, standIn } from "./fixtures/hookedEmitter.js";
import { captureProcessHooks } from "./processHooks.js";

/** Runs a probe's call as it is (the realm runs it under the blamed cell's store). */
const direct = (call: () => void): void => {
  call();
};

/** Whether a switchable tick forwards, and how many times it was called. */
type Switch = { delivers: boolean; calls?: number };

/** A tick that forwards to Node's own while `on.delivers`, as an APM agent's wrapper does, and drops it otherwise. */
const switchable =
  (on: Switch) =>
  (...args: Parameters<typeof nodeTick>) => {
    on.calls = (on.calls ?? 0) + 1;
    if (on.delivers) nodeTick(...args);
  };

/** The getter of `target`'s own accessor `key`. */
const ownGetter = (target: object, key: string): unknown =>
  Reflect.get(Object(Object.getOwnPropertyDescriptor(target, key)), "get");

describe("a replacement kept once it delivered", () => {
  it("is not called by a later check while it stays the same: the wrapper stays in place", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const on: Switch = { delivers: true };
    const wrapper = switchable(on);
    proc.nextTick = wrapper;
    expect([await hooks.check(direct), on]).toEqual([[], { delivers: true, calls: 1 }]);
    expect([hooks.check(direct), hooks.check(direct), proc.nextTick, on.calls]).toEqual([
      undefined,
      undefined,
      wrapper,
      1,
    ]);
  });

  it("is not read by a later check while it stays the same: the accessor stays in place", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const reads: string[] = [];
    const get = (): unknown => {
      reads.push("get");
      return nodeTick;
    };
    Object.defineProperty(proc, "nextTick", { get, configurable: true });
    expect(await hooks.check(direct)).toEqual([]);
    expect([hooks.check(direct), ownGetter(proc, "nextTick"), reads]).toEqual([
      undefined,
      get,
      ["get"],
    ]);
  });
});

describe("a kept replacement at an interrupt", () => {
  it("is probed again by the interrupt's check, put aside for Node's own while it decides, and kept", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const on: Switch = { delivers: true };
    const wrapper = switchable(on);
    proc.nextTick = wrapper;
    expect(await hooks.check(direct)).toEqual([]);
    const again = hooks.recheck(direct);
    expect(proc.nextTick).toBe(nodeTick);
    expect([await again, proc.nextTick, on.calls, hooks.check(direct)]).toEqual([
      [],
      wrapper,
      2,
      undefined,
    ]);
  });

  it("is found by the interrupt's check only once it stopped delivering, Node's own put back", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const on: Switch = { delivers: true };
    proc.nextTick = switchable(on);
    expect(await hooks.check(direct)).toEqual([]);
    on.delivers = false;
    expect(hooks.check(direct)).toBeUndefined();
    expect(await hooks.recheck(direct)).toEqual([{ name: "process.nextTick", restored: true }]);
    expect([proc.nextTick, hooks.check(direct)]).toEqual([nodeTick, undefined]);
  });
});

describe("a kept replacement that changed", () => {
  it("is put aside again once another replaces it, which is probed as new", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    proc.nextTick = switchable({ delivers: true });
    expect(await hooks.check(direct)).toEqual([]);
    proc.nextTick = switchable({ delivers: false });
    const decided = hooks.check(direct);
    expect(proc.nextTick).toBe(nodeTick);
    expect(await decided).toEqual([{ name: "process.nextTick", restored: true }]);
  });

  it("is probed as new once its descriptor changed, and kept in the new one", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const on: Switch = { delivers: true };
    const wrapper = switchable(on);
    proc.nextTick = wrapper;
    expect(await hooks.check(direct)).toEqual([]);
    Object.defineProperty(proc, "nextTick", { value: wrapper, enumerable: false });
    expect(await hooks.check(direct)).toEqual([]);
    const descriptor = Object.getOwnPropertyDescriptor(proc, "nextTick");
    expect([descriptor?.value, descriptor?.enumerable, on.calls]).toEqual([wrapper, false, 2]);
    expect(hooks.check(direct)).toBeUndefined();
  });

  it("is probed as new when the cell made it again after the kernel saw Node's own", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const on: Switch = { delivers: true };
    const wrapper = switchable(on);
    proc.nextTick = wrapper;
    expect(await hooks.check(direct)).toEqual([]);
    proc.nextTick = nodeTick;
    expect(hooks.check(direct)).toBeUndefined();
    proc.nextTick = wrapper;
    expect([await hooks.check(direct), proc.nextTick, on.calls]).toEqual([[], wrapper, 2]);
  });
});

describe("a check while a probe has not decided", () => {
  it("probes a replacement the cell put in place since, and that probe decides", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    proc.nextTick = switchable({ delivers: true });
    const first = hooks.check(direct);
    proc.nextTick = switchable({ delivers: false });
    const second = hooks.check(direct);
    expect(proc.nextTick).toBe(nodeTick);
    expect([await first, await second]).toEqual([
      [],
      [{ name: "process.nextTick", restored: true }],
    ]);
    expect(proc.nextTick).toBe(nodeTick);
  });

  it("keeps the later of two replacements put aside one after the other", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const [earlier, later] = [switchable({ delivers: true }), switchable({ delivers: true })];
    proc.nextTick = earlier;
    const first = hooks.check(direct);
    proc.nextTick = later;
    const second = hooks.check(direct);
    expect([await first, await second, proc.nextTick]).toEqual([[], [], later]);
  });

  it("leaves the replacement it awaits to the probe, the interrupt's check too", async () => {
    const proc = standIn();
    const hooks = captureProcessHooks(proc);
    const wrapper = switchable({ delivers: true });
    proc.nextTick = wrapper;
    const first = hooks.check(direct);
    proc.nextTick = wrapper;
    expect([hooks.check(direct), hooks.recheck(direct)]).toEqual([undefined, undefined]);
    expect([await first, proc.nextTick]).toEqual([[], wrapper]);
  });
});
