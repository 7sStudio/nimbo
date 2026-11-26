// Tests the wrapped timers and queueMicrotask with fake real timers (the test fires
// each handle, so nothing waits on time; Node's timers run under the wrappers in corpusDisposers and interruptBatches'
// integration tests): the callback started in a promise job under the registering store and the process hooks checked
// once it returned, disposal when the cell re-runs, removal once a timeout fires, errors reported on the cell, and calls
// Node would refuse handed to Node.
import { describe, expect, it } from "vitest";

import { createDisposers } from "./disposers.js";
import { createTimers } from "./timers.js";

type Store = { readonly cell: string; readonly execution: string };
type FakeHandle = { readonly fire: () => void; readonly ms: number | undefined; cleared: boolean };

const store: Store = { cell: "c_aaaaaa", execution: "x_aaaaaaaa" };

function harness(current: Store | undefined = store) {
  const handles: FakeHandle[] = [];
  const errors: [Store | undefined, unknown][] = [];
  const stores: (Store | undefined)[] = [];
  const disposers = createDisposers();
  const refused: unknown[] = [];
  const checked: (Store | undefined)[] = [];
  let active: Store | undefined;
  const schedule = (fire: () => void, ms?: number): FakeHandle => {
    const handle: FakeHandle = { fire, ms, cleared: false };
    handles.push(handle);
    return handle;
  };
  const timers = createTimers<Store, FakeHandle, FakeHandle>({
    currentStore: () => current,
    runIn: (inner, fn) => {
      active = inner;
      stores.push(active);
      fn();
    },
    addDisposer: disposers.add,
    onError: (inner, error) => errors.push([inner, error]),
    afterCall: (inner) => {
      checked.push(inner);
    },
    real: {
      setTimeout: schedule,
      setInterval: schedule,
      clear: (handle) => (handle.cleared = true),
      setImmediate: (fire) => schedule(fire),
      clearImmediate: (handle) => (handle.cleared = true),
      queueMicrotask: (callback) => {
        refused.push(callback);
      },
    },
  });
  return { timers, handles, errors, stores, disposers, refused, checked };
}

describe("createTimers", () => {
  it("starts the callback in a promise job under the store of its registration, then checks the hooks", async () => {
    const { timers, handles, stores, checked } = harness();
    let called: unknown[] = [];
    let checksWhenCalled = -1;
    const callback = (...args: unknown[]): void => {
      called = args;
      checksWhenCalled = checked.length;
    };
    timers.setTimeout(callback, 5, "a", 1); // under test
    expect(handles[0]?.ms).toBe(5);
    handles[0]?.fire();
    expect(called).toEqual([]);
    await Promise.resolve();
    expect(called).toEqual(["a", 1]);
    expect(stores).toEqual([store]);
    expect([checksWhenCalled, checked]).toEqual([0, [store]]);
  });

  it("clears a pending timer when its cell's disposers run, and forgets a timeout once it fired", async () => {
    const { timers, handles, disposers } = harness();
    timers.setTimeout(() => 1, 10); // under test
    timers.setTimeout(() => 1, 10); // under test
    handles[1]?.fire();
    await disposers.run("c_aaaaaa");
    expect(handles.map(({ cleared }) => cleared)).toEqual([true, false]);
  });

  it("keeps an interval registered until the cell's disposers clear it", async () => {
    const { timers, handles, disposers } = harness();
    timers.setInterval(() => 1, 1); // under test
    handles[0]?.fire();
    handles[0]?.fire();
    await disposers.run("c_aaaaaa");
    expect(handles[0]?.cleared).toBe(true);
  });
});

describe("createTimers errors", () => {
  it("reports a throw and a rejection on the registering cell", async () => {
    const { timers, handles, errors } = harness();
    const late = () => {
      throw new Error("late");
    };
    timers.setTimeout(late, 1); // under test
    timers.setTimeout(() => Promise.reject(new Error("rejected")), 1); // under test
    for (const handle of handles) handle.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(errors.map(([inner, error]) => [inner, (error as Error).message])).toEqual([
      [store, "late"],
      [store, "rejected"],
    ]);
  });

  it("hands a call Node would refuse to the real timer, and registers nothing without a store", () => {
    const { timers, handles, disposers } = harness(undefined);
    expect(() => timers.setTimeout("not a function", 1)).not.toThrow(); // under test
    timers.setTimeout(() => 1, "7"); // under test
    expect(handles.map(({ ms }) => ms)).toEqual([1, 7]);
    return disposers.run("c_aaaaaa").then((failures) => {
      expect(failures).toEqual([]);
    });
  });
});

describe("createTimers setImmediate", () => {
  it("starts the callback in a promise job under its store, and clears a pending one when its cell re-runs", async () => {
    const { timers, handles, stores, disposers } = harness();
    let called: unknown[] = [];
    timers.setImmediate((...args: unknown[]) => (called = args), "a");
    timers.setImmediate(() => 1);
    timers.setImmediate(() => 1);
    handles[0]?.fire();
    handles[1]?.fire();
    expect(called).toEqual([]);
    await Promise.resolve();
    expect([called, stores]).toEqual([["a"], [store, store]]);
    await disposers.run("c_aaaaaa");
    expect(handles.map(({ cleared }) => cleared)).toEqual([false, false, true]);
    expect(() => timers.setImmediate("not a function")).not.toThrow();
  });
});

describe("createTimers queueMicrotask", () => {
  it("starts the callback in a promise job under the caller's store and reports its throw on that cell", async () => {
    const { timers, stores, errors, refused } = harness();
    let called = false;
    timers.queueMicrotask(() => (called = true));
    timers.queueMicrotask(() => {
      throw new Error("late");
    });
    expect(called).toBe(false);
    await Promise.resolve();
    expect([called, stores]).toEqual([true, [store, store]]);
    expect(errors.map(([inner, error]) => [inner, (error as Error).message])).toEqual([
      [store, "late"],
    ]);
    timers.queueMicrotask("not a function");
    expect(refused).toEqual(["not a function"]);
  });
});
