// The queue of /npm/'s builds: its bound, the requests of one key sharing a build, a build no one
// waits for leaving the line or cancelled, and the limit measured from a build's start, not from the request.
import { describe, expect, it } from "vitest";

import { BuildTimedOut, createBuildQueue, createTurns, reasonOf } from "./buildQueue.js";

type Seen = { running: number; most: number; readonly cancelled: string[] };

/** Rejects once `signal` aborts. */
const abortion = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject: (reason: Error) => void) => {
    signal.addEventListener("abort", () => {
      reject(reasonOf(signal));
    });
  });

/** Builds that run until `finish` is called, noting how many run at once and which were cancelled. */
function gated(seen: Seen) {
  let finish: (value: string) => void = () => undefined;
  const done = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const work = (name: string) => async (signal: AbortSignal) => {
    seen.running += 1;
    seen.most = Math.max(seen.most, seen.running);
    signal.addEventListener(
      "abort",
      () => {
        seen.cancelled.push(name);
      },
      { once: true },
    );
    try {
      return await Promise.race([done, abortion(signal)]);
    } finally {
      seen.running -= 1;
    }
  };
  return {
    work,
    finish: (value: string): void => {
      finish(value);
    },
  };
}

const open = (): AbortSignal => new AbortController().signal;

const pause = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

describe("the build queue's bound", () => {
  it("runs at most its bound at once, the rest in order, and one build per key however many ask", async () => {
    const seen: Seen = { running: 0, most: 0, cancelled: [] };
    const turns = createTurns({ concurrency: 2, timeoutMs: 10_000 });
    const queue = createBuildQueue<string>(turns);
    const gate = gated(seen);
    let runs = 0;
    const counted = (signal: AbortSignal) => {
      runs += 1;
      return gate.work("shared")(signal);
    };
    const shared = [queue("shared", counted, open()), queue("shared", counted, open())];
    const keys = Array.from({ length: 6 }, (_, at) => `k${String(at)}`);
    const others = keys.map((key) => queue(key, gate.work(key), open()));
    await pause(20);
    expect(turns.load()).toEqual({ running: 2, queued: 5 });
    gate.finish("built");
    expect(await Promise.all([...shared, ...others])).toEqual(
      Array.from({ length: 8 }, () => "built"),
    );
    expect([runs, seen.most, turns.load()]).toEqual([1, 2, { running: 0, queued: 0 }]);
  });
});

describe("the build queue's cancellation", () => {
  it("drops a waiting build once its requests left, and cancels a running one once the last of them did", async () => {
    const seen: Seen = { running: 0, most: 0, cancelled: [] };
    const turns = createTurns({ concurrency: 1, timeoutMs: 10_000 });
    const queue = createBuildQueue<string>(turns);
    const gate = gated(seen);
    const [first, second, third] = [
      new AbortController(),
      new AbortController(),
      new AbortController(),
    ];
    const running = queue("running", gate.work("running"), first.signal);
    const joined = queue("running", gate.work("running"), second.signal);
    let started = false;
    const never = (): Promise<string> => {
      started = true;
      return Promise.resolve("never");
    };
    const waiting = queue("waiting", never, third.signal);
    third.abort(new Error("gone"));
    await expect(waiting).rejects.toThrow("gone");
    first.abort(new Error("first gone"));
    await expect(running).rejects.toThrow("first gone");
    expect(seen.cancelled).toEqual([]); // the second request still waits for it
    second.abort(new Error("second gone"));
    await expect(joined).rejects.toThrow("second gone");
    expect(seen.cancelled).toEqual(["running"]);
    await pause(20);
    expect([started, turns.load()]).toEqual([false, { running: 0, queued: 0 }]);
    expect(await queue("running", () => Promise.resolve("again"), open())).toBe("again");
  });
});

describe("the build queue's limit", () => {
  it("measures a build's limit from its start, not from the request that waited for its turn", async () => {
    const queue = createBuildQueue<string>(createTurns({ concurrency: 1, timeoutMs: 300 }));
    const takes = (ms: number) => (signal: AbortSignal) =>
      Promise.race([pause(ms).then(() => `took ${String(ms)}`), abortion(signal)]);
    const answers = await Promise.allSettled([
      queue("a", takes(200), open()),
      queue("b", takes(200), open()), // 400 ms after its request, 200 after its start
      queue("c", takes(800), open()),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    const [, , late] = answers;
    expect(late.status === "rejected" ? late.reason : undefined).toBeInstanceOf(BuildTimedOut);
  });
});
