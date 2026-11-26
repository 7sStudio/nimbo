// Tests the classification of the async context the code running now is in: the resources Node pushes
// from JavaScript (a Timeout, an Immediate, an AsyncResource, a Promise, a TickObject) by their prototypes, read
// through intrinsics captured when the module loads; a Proxy, the resource or on its chain, as an AsyncResource scope
// with none of its traps run; the natively entered ones and the top level as clean; the known residuals of
// another realm's Promise or plain object and of a Timeout whose prototype was replaced; and the context read in real
// callbacks of each kind.
import {
  AsyncLocalStorage,
  AsyncResource,
  createHook,
  executionAsyncResource,
} from "node:async_hooks";
import { readFile } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { contextOf, pushedContext } from "./asyncContexts.js";

describe("contextOf", () => {
  it("names the resources Node pushes from JavaScript by their prototypes", () => {
    const timer = setTimeout(() => undefined, 60_000); // under test: a Timeout resource, cleared at once
    const immediate = setImmediate(() => undefined);
    clearTimeout(timer);
    clearImmediate(immediate);
    class Scope extends AsyncResource {}
    const resources = [timer, immediate, new Scope("X"), Promise.resolve(), { callback: 1 }];
    expect(resources.map(contextOf)).toEqual([
      "Timeout",
      "Immediate",
      "AsyncResource",
      "Promise",
      "TickObject",
    ]);
  });
});

describe("contextOf on what Node does not push from JavaScript", () => {
  it("finds nothing in a natively entered resource, a primitive or an object of another realm", async () => {
    const fsResource = await new Promise((resolve) => {
      readFile(import.meta.filename, () => {
        resolve(executionAsyncResource());
      });
    });
    const resources = [
      fsResource,
      Object.create(null),
      null,
      7,
      runInNewContext("Promise.resolve()"),
      runInNewContext("({})"),
    ];
    expect(resources.map(contextOf)).toEqual(resources.map(() => undefined));
  });

  it("reads the prototypes by identity, whatever replaces the global isPrototypeOf", () => {
    const own = Object.getOwnPropertyDescriptor(Object.prototype, "isPrototypeOf");
    Object.defineProperty(Object.prototype, "isPrototypeOf", { value: () => false });
    try {
      expect(contextOf(new AsyncResource("X"))).toBe("AsyncResource");
    } finally {
      if (own) Object.defineProperty(Object.prototype, "isPrototypeOf", own);
    }
  });

  it("takes a Timeout whose prototype a cell replaced for a native context: a known residual", () => {
    const timer = setTimeout(() => undefined, 60_000); // under test: a Timeout resource, cleared at once
    clearTimeout(timer);
    Object.setPrototypeOf(timer, null);
    expect(contextOf(timer)).toBeUndefined();
  });
});

/** A Proxy whose every trap records that it ran, and throws. */
function trapped(target: object, ran: string[]): object {
  const trap = (name: string) => (): never => {
    ran.push(name);
    throw new Error(`the ${name} trap ran`);
  };
  return new Proxy(target, { getPrototypeOf: trap("getPrototypeOf"), get: trap("get") });
}

describe("contextOf on a Proxy", () => {
  it("names a Proxy resource, or one with a Proxy on its chain, an AsyncResource scope, running no trap", () => {
    const ran: string[] = [];
    const resource = new AsyncResource("X");
    const behind = Object.setPrototypeOf({}, trapped(AsyncResource.prototype, ran)) as object;
    expect([contextOf(trapped(resource, ran)), contextOf(behind)]).toEqual([
      "AsyncResource",
      "AsyncResource",
    ]);
    expect(ran).toEqual([]);
  });
});

/** The context read inside the callback `schedule` runs. */
function contextIn(schedule: (callback: () => void) => void): Promise<unknown> {
  return new Promise((resolve) => {
    schedule(() => {
      resolve(pushedContext());
    });
  });
}

describe("pushedContext", () => {
  it("reads the context of each kind of callback Node starts from JavaScript", async () => {
    const timer = (callback: () => void) => setTimeout(callback, 0); // under test: a raw timer's context
    const tick = (callback: () => void): void => {
      process.nextTick(callback);
    };
    const scope = (callback: () => void): void => {
      new AsyncResource("X").runInAsyncScope(callback);
    };
    // queueMicrotask makes an AsyncResource scope once a store was used, as in every kernel.
    const microtask = (callback: () => void): void => {
      new AsyncLocalStorage().run(1, () => {
        queueMicrotask(callback);
      });
    };
    const contexts = [
      await contextIn(timer),
      await contextIn(setImmediate),
      await contextIn(tick),
      await contextIn(scope),
      await contextIn(microtask),
    ];
    expect(contexts).toEqual([
      "Timeout",
      "Immediate",
      "TickObject",
      "AsyncResource",
      "AsyncResource",
    ]);
  });
});

describe("pushedContext where Node pushes nothing from JavaScript", () => {
  it("reads a store's own scope as clean", async () => {
    const run = (callback: () => void): void => {
      new AsyncLocalStorage().run(1, callback);
    };
    expect(await contextIn(run)).toBeUndefined();
  });

  it("reads a promise job's context as clean, unless an async hook tracks promises", async () => {
    const job = (callback: () => void): void => {
      void Promise.resolve().then(callback);
    };
    expect(await contextIn(job)).toBeUndefined();
    const hook = createHook({ before: () => undefined, after: () => undefined }).enable();
    try {
      expect(await contextIn(job)).toBe("Promise");
    } finally {
      hook.disable();
    }
  });

  it("reads the context of a callback Node enters natively as clean", async () => {
    const read = (callback: () => void): void => {
      readFile(import.meta.filename, () => {
        callback();
      });
    };
    expect(await contextIn(read)).toBeUndefined();
  });
});
