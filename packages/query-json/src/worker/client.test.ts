// Tests of client.ts's timers at unit tier: the worker is a real MessageChannel whose far end never answers, and the
// clock is faked (09-testing §1.4 allows it here, and only here).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok } from "../errors.ts";
import type { ChannelWorkers } from "../fixtures/channels.ts";
import { channelWorkers } from "../fixtures/channels.ts";
import { createWorkerClient } from "./client.ts";
import { timeoutError } from "./job.ts";
import { isReady, isSelectResult } from "./protocol.ts";

const task = { kind: "jsonpath", query: "$", json: "1" } as const;

/** Whether `promise` has settled, read after the fake clock moves. */
const watch = (promise: Promise<unknown>): (() => boolean) => {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  return () => settled;
};

let workers: ChannelWorkers;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  workers = channelWorkers();
});
afterEach(() => {
  workers.close();
  vi.useRealTimers();
});

describe("createWorkerClient timers", () => {
  it("ends a task the worker never answers as a timeout at timeoutMs, and terminates that worker", async () => {
    const client = createWorkerClient("jsonpath", 512, workers.spawn);
    const pending = client.run(task, isSelectResult, { timeoutMs: 1000 });
    const settled = watch(pending);
    await vi.advanceTimersByTimeAsync(999);
    expect(settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, error: timeoutError(1000) });
    expect(workers.terminated()).toBe(1);
  });

  it("starts the next task in a fresh worker, its clock running from its own start", async () => {
    const client = createWorkerClient("jsonpath", 512, workers.spawn);
    const first = client.run(task, isSelectResult, { timeoutMs: 1000 });
    const second = client.run(task, isSelectResult, { timeoutMs: 300 });
    const secondSettled = watch(second);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toMatchObject({ ok: false, error: { kind: "timeout" } });
    await vi.advanceTimersByTimeAsync(299);
    expect(secondSettled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await second).toEqual({ ok: false, error: timeoutError(300) });
    expect(workers.spawned()).toBe(2);
  });

  it("settles with the worker's answer and clears its timer", async () => {
    const answering = channelWorkers(() => Promise.resolve(ok(null)));
    try {
      const client = createWorkerClient("jq", 512, answering.spawn);
      expect(await client.run({ kind: "warm-jq" }, isReady, { timeoutMs: 1000 })).toEqual({
        ok: true,
        value: null,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      answering.close();
    }
  });
});

describe("createWorkerClient failures", () => {
  it("answers unavailable when the worker cannot start", async () => {
    const client = createWorkerClient("jsonpath", 512, () => {
      throw new Error("blocked by the page's policy");
    });
    expect(await client.run(task, isSelectResult, { timeoutMs: 1000 })).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message:
          "The query worker could not start (Error: blocked by the page's policy). Reload the page or restart the daemon.",
      },
    });
  });

  it("answers a runtime error when the task cannot be posted, and runs the next one", async () => {
    let posts = 0;
    const client = createWorkerClient("jsonpath", 512, (kind, memoryMb, events) => {
      const channel = workers.spawn(kind, memoryMb, events);
      return {
        post: (sent) => {
          posts += 1;
          if (posts === 1) throw new Error("DataCloneError");
          channel.post(sent);
        },
        terminate: () => channel.terminate(),
      };
    });
    expect(await client.run(task, isSelectResult, { timeoutMs: 1000 })).toMatchObject({
      ok: false,
      error: {
        kind: "runtime",
        message: expect.stringMatching(/^The value cannot be sent to the query worker/) as unknown,
      },
    });
    const next = client.run(task, isSelectResult, { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await next).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });
});

describe("createWorkerClient task sources", () => {
  it("builds a task for the worker that runs it, given that worker's generation", async () => {
    const answering = channelWorkers(() => Promise.resolve(ok(null)));
    try {
      const client = createWorkerClient("jq", 512, answering.spawn);
      const seen: number[] = [];
      const source = (generation: number) => {
        seen.push(generation);
        return ok({ kind: "warm-jq" } as const);
      };
      expect(client.generation()).toBe(0);
      await client.run(source, isReady, { timeoutMs: 1000 });
      await client.run(source, isReady, { timeoutMs: 1000 });
      expect([seen, client.generation()]).toEqual([[1, 1], 1]);
    } finally {
      answering.close();
    }
  });

  it("ends a task whose source fails with that failure, posting nothing, and runs the next one", async () => {
    const client = createWorkerClient("jsonpath", 512, workers.spawn);
    const failure = { kind: "runtime", message: "not JSON" } as const;
    expect(
      await client.run(() => ({ ok: false, error: failure }), isSelectResult, { timeoutMs: 1000 }),
    ).toEqual({ ok: false, error: failure });
    const next = client.run(task, isSelectResult, { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await next).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });
});

describe("createWorkerClient tasks only for a running worker", () => {
  it("ends one as done when no worker runs, starting none", async () => {
    const client = createWorkerClient("jsonpath", 512, workers.spawn);
    const release = { kind: "release", keys: ["k"] } as const;
    const options = { timeoutMs: 1000, onlyIfRunning: true };
    expect(await client.run(release, isReady, options)).toEqual({ ok: true, value: null });
    expect(workers.spawned()).toBe(0);
    const timedOutTask = client.run(task, isSelectResult, { timeoutMs: 10 });
    const queued = client.run(release, isReady, options);
    await vi.advanceTimersByTimeAsync(10);
    expect(await timedOutTask).toMatchObject({ ok: false, error: { kind: "timeout" } });
    expect(await queued).toEqual({ ok: true, value: null });
    expect([workers.spawned(), workers.terminated()]).toEqual([1, 1]);
  });
});

describe("createWorkerClient dispose", () => {
  it("ends the running and the queued tasks as aborted", async () => {
    const client = createWorkerClient("jsonpath", 512, workers.spawn);
    const running = client.run(task, isSelectResult, { timeoutMs: 1000 });
    const queued = client.run(task, isSelectResult, { timeoutMs: 1000 });
    await client.dispose();
    for (const result of await Promise.all([running, queued])) {
      expect(result).toMatchObject({ ok: false, error: { kind: "aborted" } });
    }
    expect(workers.terminated()).toBe(1);
  });
});
