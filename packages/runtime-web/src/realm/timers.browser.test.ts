// Tests a run's timers against the real clock: they fire, report failures and stop with the run.
import { describe, expect, it } from "vitest";

import { afterTimers, nextFrame } from "../fixtures/waits.js";
import { createDisposers } from "./disposers.js";
import { createTimers } from "./timers.js";

describe("createTimers, firing", () => {
  it("fires setTimeout with its arguments and returns the real handle", async () => {
    const { setTimeout: start } = createTimers(createDisposers(), () => undefined);
    const { promise, resolve } = Promise.withResolvers<unknown[]>();
    const handle = start(
      (...args: unknown[]) => {
        resolve(args);
      },
      0,
      "a",
      1,
    );
    expect(typeof handle).toBe("number");
    expect(await promise).toEqual(["a", 1]);
  });

  it("passes a string handler through as the page would take it", () => {
    const { setTimeout: start } = createTimers(createDisposers(), () => undefined);
    const handle = start("void 0", 60_000);
    clearTimeout(handle as number);
    expect(typeof handle).toBe("number");
  });
});

describe("createTimers, failures and disposal", () => {
  it("reports a timer and a frame callback that throw", async () => {
    const errors: string[] = [];
    const { promise, resolve } = Promise.withResolvers<undefined>();
    const { setTimeout: start, requestAnimationFrame: frame } = createTimers(
      createDisposers(),
      (error) => {
        errors.push((error as Error).message);
        if (errors.length === 2) resolve(undefined);
      },
    );
    start(() => {
      throw new Error("timer");
    }, 0);
    frame(() => {
      throw new Error("frame");
    });
    await promise;
    expect(errors.sort()).toEqual(["frame", "timer"]);
  });

  it("clears timeouts, intervals and frames when the run's disposers run", async () => {
    const disposers = createDisposers();
    const {
      setTimeout: start,
      setInterval: repeat,
      requestAnimationFrame: frame,
    } = createTimers(disposers, () => undefined);
    const fired: string[] = [];
    start(() => fired.push("timeout"), 0);
    repeat(() => fired.push("interval"), 0);
    frame(() => fired.push("frame"));
    disposers.run(() => undefined);
    await nextFrame();
    await afterTimers(0);
    expect(fired).toEqual([]);
  });
});

describe("createTimers, the disposer list", () => {
  it("drops a timeout's and a frame's disposer once it fired, and keeps an interval's", async () => {
    const disposers = createDisposers();
    const {
      setTimeout: start,
      setInterval: repeat,
      requestAnimationFrame: frame,
    } = createTimers(disposers, () => undefined);
    const fired = Promise.withResolvers<undefined>();
    let count = 0;
    const tick = (): void => {
      count += 1;
      if (count === 50) fired.resolve(undefined);
    };
    for (let n = 0; n < 50; n += 1) start(tick, 0);
    frame(() => undefined);
    const handle = repeat(() => undefined, 60_000);
    expect(disposers.size()).toBe(52);
    await fired.promise;
    await nextFrame();
    expect(disposers.size()).toBe(1);
    clearInterval(handle as number);
  });

  it("schedules nothing once the run's disposers ran", async () => {
    const disposers = createDisposers();
    const { setTimeout: start, requestAnimationFrame: frame } = createTimers(
      disposers,
      () => undefined,
    );
    disposers.run(() => undefined);
    const fired: string[] = [];
    expect(start(() => fired.push("timeout"), 0)).toBe(0);
    expect(frame(() => fired.push("frame"))).toBe(0);
    await nextFrame();
    await afterTimers(0);
    expect([fired, disposers.size()]).toEqual([[], 0]);
  });
});
