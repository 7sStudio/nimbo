// Tests startKernel's life with a fake process: a send the daemon end refused (a stub: the fake process refuses it, as a
// closed channel would), uncaught errors with no store, the end on disconnect (SIGKILL to the kernel's own process group
// on POSIX, recorded by the fake, through the process.kill captured at start; an exit where it leads no group and on
// Windows), and shutdown once the last message left. Text a cell writes after its run, flushed by the kernel's 16 ms
// timer, goes through the real child (nodeKernelRun.integration.test.ts, an output after the run to onOutput), and so
// does a daemon that dies (daemonGone.integration.test.ts).
import { describe, expect, it } from "vitest";

import { startKernel } from "./child.js";
import { fakeProcess, noWarmUp } from "./fixtures/fakeProcess.js";

describe("startKernel sends", () => {
  it("logs a send the daemon end refused", async () => {
    const { proc, record } = fakeProcess({ refuse: true });
    await startKernel(proc, { warmUp: noWarmUp });
    expect(JSON.parse(record.err[0] ?? "")).toMatchObject({
      level: "warn",
      error: "channel closed",
    });
  });
});

describe("startKernel listeners", () => {
  it("logs uncaught errors with no store on the original stderr", async () => {
    const { proc, events, record } = fakeProcess();
    await startKernel(proc, { warmUp: noWarmUp });
    events.emit("uncaughtException", new Error("orphan"));
    events.emit("unhandledRejection", "rejected");
    const messages = record.err.map(
      (line) => (JSON.parse(line) as { error: { message: string } }).error.message,
    );
    expect(messages).toEqual(["orphan", "'rejected'"]);
  });

  it("exits once the last message left after a shutdown, and runs without IPC", async () => {
    const { proc, events, record, when } = fakeProcess();
    await startKernel(proc, { warmUp: noWarmUp });
    events.emit("message", { type: "shutdown" });
    await when(() => record.exits.length > 0);
    expect(record.exits).toEqual([0]);
    const silent = fakeProcess({ withIpc: false });
    await startKernel(silent.proc, { warmUp: noWarmUp });
    expect(silent.record.sent).toEqual([]);
  });
});

describe("startKernel on disconnect", () => {
  it("ends its own process group on POSIX, itself included, through the process.kill of its start", async () => {
    const { proc, events, record } = fakeProcess();
    await startKernel(proc, { warmUp: noWarmUp });
    Object.assign(proc, { kill: () => expect.unreachable("a cell's process.kill was called") });
    events.emit("disconnect");
    expect([record.kills, record.exits]).toEqual([[[-4242, "SIGKILL"]], []]);
  });

  it("exits when it leads no process group, and on Windows", async () => {
    const groupless = fakeProcess({ groupless: true });
    await startKernel(groupless.proc, { warmUp: noWarmUp });
    groupless.events.emit("disconnect");
    expect([groupless.record.kills, groupless.record.exits]).toEqual([[[-4242, "SIGKILL"]], [0]]);
    const windows = fakeProcess({ platform: "win32" });
    await startKernel(windows.proc, { warmUp: noWarmUp });
    windows.events.emit("disconnect");
    expect([windows.record.kills, windows.record.exits]).toEqual([[], [0]]);
  });
});
