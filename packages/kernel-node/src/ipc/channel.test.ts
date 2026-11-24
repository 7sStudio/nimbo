// Tests the child's channel over a stub transport in process.send's place, whose callbacks the test calls: daemon
// messages validated, kernel messages sent with their callbacks counted, and, as stubs of what Node's IPC does not do
// on demand, a send refused (a closed channel, at which the kernel exits) and a callback that comes at once (Node's
// IPC always calls back later). The real channel runs in every integration test: a malformed daemon message reaches
// the real child in childProcess.integration.test.ts, and a send an interrupt stopped inside process.send is
// interruptBatches.integration.test.ts's cell interrupted while displaying.
import { describe, expect, it } from "vitest";

import { createChannel, parseDaemonMessage } from "./channel.js";

describe("parseDaemonMessage", () => {
  it("accepts a daemon message and describes one that fails validation", () => {
    expect(parseDaemonMessage({ type: "shutdown" })).toEqual({
      ok: true,
      message: { type: "shutdown" },
    });
    const refused = parseDaemonMessage({ type: "eval" });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.issues).toContain("type");
  });
});

describe("createChannel", () => {
  it("runs afterLastSend once every message sent so far has been handed over", () => {
    const callbacks: ((error: Error | null) => void)[] = [];
    const sent: unknown[] = [];
    const channel = createChannel(
      (message, callback) => {
        sent.push(message);
        callbacks.push(callback);
      },
      () => undefined,
    );
    let done = 0;
    channel.afterLastSend(() => (done += 1));
    expect(done).toBe(1);
    channel.send({ type: "ready", pid: 1 });
    channel.send({ type: "exports", names: [] });
    channel.afterLastSend(() => (done += 1));
    callbacks[0]?.(null);
    expect(done).toBe(1);
    callbacks[1]?.(null);
    expect(done).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it("reports a send the other end refused (stub: a closed channel)", () => {
    const errors: Error[] = [];
    const channel = createChannel(
      (_message, callback) => {
        callback(new Error("channel closed"));
      },
      (error) => errors.push(error),
    );
    channel.send({ type: "ready", pid: 1 });
    expect(errors.map((error) => error.message)).toEqual(["channel closed"]);
  });
});

describe("createChannel when a send answers at once (stub)", () => {
  it("counts a send answered at once as done", () => {
    const callbacks: ((error: Error | null) => void)[] = [];
    let mode: "now" | "later" = "now";
    const channel = createChannel(
      (_message, callback) => {
        if (mode === "now") callback(null);
        else callbacks.push(callback);
      },
      () => undefined,
    );
    channel.send({ type: "exports", names: [] });
    mode = "later";
    channel.send({ type: "exports", names: [] });
    let done = 0;
    channel.afterLastSend(() => (done += 1));
    expect(done).toBe(0);
    callbacks[0]?.(null);
    expect(done).toBe(1);
  });
});
