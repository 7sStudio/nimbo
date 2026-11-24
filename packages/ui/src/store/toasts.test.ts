// The toast stack: three at most, 6 s each, paused while hovered, the same one renewed rather than repeated.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toastMs, toastQueue } from "./toasts.js";

describe("toastQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the three newest", () => {
    const queue = toastQueue();
    for (const title of ["a", "b", "c", "d"]) queue.toast({ kind: "info", title });
    expect(queue.toasts.value.map((toast) => toast.title)).toEqual(["b", "c", "d"]);
  });

  it("drops a toast after 6 s, not while paused, and again 6 s after resume", () => {
    const queue = toastQueue();
    const id = queue.toast({ kind: "success", title: "Copied" });
    queue.pause(id);
    vi.advanceTimersByTime(toastMs * 2);
    expect(queue.toasts.value).toHaveLength(1);
    queue.resume(id);
    vi.advanceTimersByTime(toastMs - 1);
    expect(queue.toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(queue.toasts.value).toHaveLength(0);
  });

  it("dismisses at once, and a resume of a gone toast does nothing", () => {
    const queue = toastQueue();
    const id = queue.toast({
      kind: "error",
      title: "Boom",
      action: { label: "Retry", command: "notebook.save" },
    });
    queue.dismiss(id);
    queue.resume(id);
    vi.advanceTimersByTime(toastMs);
    expect(queue.toasts.value).toEqual([]);
  });
});

describe("toastQueue, the same news twice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews the same toast instead of stacking it again, but stacks toasts with an action", () => {
    const queue = toastQueue();
    const first = queue.toast({ kind: "error", title: "Not authorized", text: "x" });
    vi.advanceTimersByTime(toastMs - 1);
    expect(queue.toast({ kind: "error", title: "Not authorized", text: "x" })).toBe(first);
    vi.advanceTimersByTime(toastMs - 1);
    expect(queue.toasts.value).toHaveLength(1);
    const undo = { label: "Undo", command: "undo.restore" };
    queue.toast({ kind: "info", title: "Deleted", action: undo });
    queue.toast({ kind: "info", title: "Deleted", action: undo });
    expect(queue.toasts.value).toHaveLength(3);
  });
});
