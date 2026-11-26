// Worker-backed (integration tier): jq programs over held values in the real worker thread, its posts
// recorded. A held value's JSON text reaches the worker with its first program only (jq still parses it at each run),
// again after a timeout replaced the worker, and goes from the worker on release or past the bound, the oldest first.
import { afterEach, describe, expect, it } from "vitest";

import type { HeldTransform, HoldingTransformEngine } from "../engine.ts";
import { chargeList } from "../fixtures/records.ts";
import type { Recording } from "../fixtures/recording.ts";
import { recording, shapeOf } from "../fixtures/recording.ts";
import type { JqEngineOptions } from "./engine.ts";
import { createJqEngineWith } from "./engine.ts";

let engine: HoldingTransformEngine;
let workers: Recording;
afterEach(() => engine.dispose());

async function start(options: JqEngineOptions = {}): Promise<void> {
  workers = recording();
  engine = createJqEngineWith(options, workers.spawn);
  await engine.load();
}

const compiled = (program: string): HeldTransform => {
  const result = engine.compile(program);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const charges = chargeList(400);
const held = (key: string, carried: boolean) => ({ kind: "jq-held", key, carried });
const failed = '[.data[] | select(.status == "failed")] | length';

describe("jq over a held value", () => {
  it("sends the value with the first program only, and answers as a run over the value itself", async () => {
    await start();
    engine.hold("k", charges);
    const own = await compiled(failed).transform(charges);
    expect(await compiled(failed).transformHeld("k")).toEqual(own);
    expect(await compiled(".data[3].id").transformHeld("k")).toEqual({
      ok: true,
      value: { value: "ch_000003", count: 1 },
    });
    expect(workers.posted().map(shapeOf)).toEqual([
      { kind: "warm-jq" },
      { kind: "jq" },
      held("k", true),
      held("k", false),
    ]);
  });

  it("sends the value again to the worker that replaced a timed-out one, and answers", async () => {
    await start();
    engine.hold("k", charges);
    await compiled(".data | length").transformHeld("k");
    expect(await compiled("last(repeat(1))").transform(null, { timeoutMs: 50 })).toMatchObject({
      ok: false,
      error: { kind: "timeout" },
    });
    expect(await compiled(".data | length").transformHeld("k")).toEqual({
      ok: true,
      value: { value: 400, count: 1 },
    });
    expect(workers.posted().map(shapeOf).slice(-1)).toEqual([held("k", true)]);
    expect(workers.spawned()).toBe(2);
  });
});

describe("jq held values released", () => {
  it("releases a key in the worker: its programs fail after that, until it is held again", async () => {
    await start();
    engine.hold("k", charges);
    await compiled(".data | length").transformHeld("k");
    engine.release("k");
    expect(await compiled(".").transformHeld("k")).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message: "Nothing is held under k. Hold the value (hold), then run the query.",
      },
    });
    engine.hold("k", { n: 1 });
    expect(await compiled(".n").transformHeld("k")).toEqual({
      ok: true,
      value: { value: 1, count: 1 },
    });
    expect(workers.posted().map(shapeOf).slice(2)).toEqual([
      { kind: "release", keys: ["k"] },
      held("k", true),
    ]);
  });
});

describe("jq held values and their bound", () => {
  it("forgets the oldest values past heldMaxBytes, in the worker too", async () => {
    const bytes = JSON.stringify(charges).length;
    await start({ heldMaxBytes: 2 * bytes });
    for (const key of ["a", "b", "c"]) {
      engine.hold(key, charges);
      expect(await compiled(".has_more").transformHeld(key)).toMatchObject({ ok: true });
    }
    expect(workers.posted().map(shapeOf).slice(-1)).toEqual([{ ...held("c", true), drop: ["a"] }]);
    expect(await compiled(".").transformHeld("a")).toMatchObject({ ok: false });
    expect(await compiled(".url").transformHeld("b")).toEqual({
      ok: true,
      value: { value: "/v1/charges", count: 1 },
    });
    expect(workers.posted().map(shapeOf).slice(-1)).toEqual([held("b", false)]);
  });

  it("runs every program of a value larger than the bound over the value it carries", async () => {
    await start({ heldMaxBytes: 10 });
    engine.hold("k", charges);
    for (let run = 0; run < 2; run += 1) {
      expect(await compiled(".data | length").transformHeld("k")).toEqual({
        ok: true,
        value: { value: 400, count: 1 },
      });
    }
    expect(workers.posted().map(shapeOf).slice(1)).toEqual([{ kind: "jq" }, { kind: "jq" }]);
  });
});
