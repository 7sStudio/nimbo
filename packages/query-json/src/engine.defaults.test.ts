// Unit tier: what each engine applies when given no options. Their workers are real MessageChannels whose far end never
// answers (or answers only warm-jq), and the clock is faked, so the 5 000 ms and 30 s limits run in microseconds.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompiledSelect } from "./engine.ts";
import { queryDefaults } from "./engine.ts";
import type { Result } from "./errors.ts";
import { ok } from "./errors.ts";
import type { ChannelWorkers } from "./fixtures/channels.ts";
import { channelWorkers } from "./fixtures/channels.ts";
import { createJqEngineWith } from "./jq/engine.ts";
import { createJsonPathEngineWith } from "./jsonpath/engine.ts";
import type { WorkerTask } from "./worker/protocol.ts";

const timedOutAt5000 = {
  ok: false,
  error: {
    kind: "timeout",
    message:
      "The query ran longer than 5000 ms and was stopped. Narrow it, or raise query.timeoutMs.",
  },
};

/** Answers warm-jq, so the jq engine loads, and never anything else. */
const warmOnly = (task: unknown): Promise<Result<unknown>> =>
  (task as WorkerTask).kind === "warm-jq"
    ? Promise.resolve(ok(null))
    : new Promise(() => undefined);

/** Moves the fake clock to 4 999 ms, checks `run` is still pending, then to 5 000 ms and returns what it settled to. */
const pastTheDefault = async (run: Promise<unknown>): Promise<unknown> => {
  let settled = false;
  void run.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(4999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  return run;
};

let workers: ChannelWorkers[] = [];
const track = (created: ChannelWorkers): ChannelWorkers => {
  workers.push(created);
  return created;
};
/** Loaded and compiled before the tests, so the test measures only the select and its timer. */
const jsonpathWorkers = channelWorkers();
const jsonpath = createJsonPathEngineWith({}, jsonpathWorkers.spawn);
let quadratic: CompiledSelect;
beforeAll(async () => {
  await jsonpath.load();
  const compiled = jsonpath.compile("$[?count($[*]) > 0]");
  if (!compiled.ok) throw new Error(compiled.error.message);
  quadratic = compiled.value;
});
afterAll(async () => {
  jsonpathWorkers.close();
  await jsonpath.dispose();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  workers.forEach((created) => {
    created.close();
  });
  workers = [];
  vi.useRealTimers();
});

describe("engine defaults", () => {
  it("are query.timeoutMs 5 000 ms, 100 000 nodes and 100 ms in the calling thread, 512 MB in a worker", () => {
    expect(queryDefaults).toEqual({
      timeoutMs: 5000,
      mainThreadNodeLimit: 100_000,
      mainThreadSliceMs: 100,
      memoryMb: 512,
    });
  });

  it("stop a JSONPath select after 5 000 ms when the engine has no timeout option", async () => {
    expect(await pastTheDefault(quadratic.select([1, 2, 3]))).toEqual(timedOutAt5000);
  });

  it("stop a jq program after 5 000 ms when the engine has no timeout option", async () => {
    const engine = createJqEngineWith({}, track(channelWorkers(warmOnly)).spawn);
    await engine.load();
    const compiled = engine.compile(".");
    if (!compiled.ok) throw new Error(compiled.error.message);
    expect(await pastTheDefault(compiled.value.transform(1))).toEqual(timedOutAt5000);
  });

  it("give jq 30 s to start, then say so without pointing at query.timeoutMs", async () => {
    const engine = createJqEngineWith({}, track(channelWorkers()).spawn);
    const loading = engine.load();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(engine.compile(".")).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    await vi.advanceTimersByTimeAsync(1);
    await loading;
    expect(engine.compile(".")).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message:
          "jq did not start within 30 s. Reload the page or restart the daemon, then call load() again.",
      },
    });
  });
});
