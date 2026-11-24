// Tests useTasks on its own: one task at a time, its signal aborted on cancel or by the next task, the notice that
// says which, a failure converted into a message, and dismissing either line.
import { describe, expect, it } from "vitest";

import { useTasks } from "./useTasks.js";

/** Work that ends only when its signal aborts, then rejects as a cancelled fetch would. */
const hang = (signals: AbortSignal[]) => (signal: AbortSignal) => {
  signals.push(signal);
  return new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new Error("aborted"));
    });
  });
};

describe("useTasks", () => {
  it("names the task the next one cancelled, and fails nothing for it", async () => {
    const tasks = useTasks();
    const signals: AbortSignal[] = [];
    const first = tasks.run("Loading the next 2,000", hang(signals));
    const second = tasks.run("Exporting the full value as JSON", hang(signals));
    await first;
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect([tasks.running.value?.label, tasks.notice.value, tasks.failure.value]).toEqual([
      "Exporting the full value as JSON",
      'Cancelled "Loading the next 2,000": "Exporting the full value as JSON" started.',
      undefined,
    ]);
    tasks.cancel();
    await second;
    expect([tasks.running.value, tasks.notice.value]).toEqual([
      undefined,
      'Cancelled "Exporting the full value as JSON".',
    ]);
    tasks.dismiss("notice");
    expect(tasks.notice.value).toBeUndefined();
  });

  it("turns a failure into a message the user can dismiss", async () => {
    const tasks = useTasks();
    await tasks.run("Loading the next 2,000", () =>
      Promise.reject(new Error("the daemon is gone")),
    );
    expect([tasks.running.value, tasks.failure.value]).toEqual([
      undefined,
      "Loading the next 2,000 failed: the daemon is gone",
    ]);
    tasks.dismiss("failure");
    tasks.fail("The browser did not allow copying to the clipboard.");
    expect(tasks.failure.value).toBe("The browser did not allow copying to the clipboard.");
  });
});
