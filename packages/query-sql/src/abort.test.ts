// The deadline: the caller's signal or the timeout, whichever fires first, and which one it was.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deadline } from "./abort.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deadline", () => {
  it("fires timeout when the time passes first", () => {
    const stop = deadline(undefined, 100);
    vi.advanceTimersByTime(99);
    expect(stop.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(stop.signal.aborted).toBe(true);
    expect(stop.stopped()).toBe("timeout");
    expect(stop.error().data.reason).toBe("timeout");
    expect(stop.error().message).toContain("100 ms");
  });

  it("fires cancelled when the caller aborts first, and the timer no longer counts", () => {
    const caller = new AbortController();
    const stop = deadline(caller.signal, 100);
    caller.abort();
    vi.advanceTimersByTime(200);
    expect(stop.stopped()).toBe("cancelled");
    expect(stop.error().data.reason).toBe("cancelled");
  });
});

describe("deadline edges", () => {
  it("is already stopped for an already-aborted signal", () => {
    const stop = deadline(AbortSignal.abort(), 100);
    expect(stop.signal.aborted).toBe(true);
    expect(stop.stopped()).toBe("cancelled");
  });

  it("never fires with an infinite timeout", () => {
    const stop = deadline(undefined, Infinity);
    vi.advanceTimersByTime(1e9);
    expect(stop.stopped()).toBeUndefined();
    expect(stop.error().data.reason).toBe("cancelled");
  });

  it("stops listening after clear", () => {
    const caller = new AbortController();
    const stop = deadline(caller.signal, 100);
    stop.clear();
    caller.abort();
    vi.advanceTimersByTime(200);
    expect(stop.stopped()).toBeUndefined();
  });
});
