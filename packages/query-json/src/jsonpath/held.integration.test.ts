// Worker-backed (integration tier): JSONPath selects over held values in the real worker thread, its
// posts recorded. A held value reaches the worker with its first query only, again after a timeout replaced the worker,
// and goes from the worker on release or past the bound, the oldest first.
import { afterEach, describe, expect, it } from "vitest";

import type { HeldSelect, HoldingSelectEngine } from "../engine.ts";
import { chargeList, galleryQuery } from "../fixtures/records.ts";
import type { Recording } from "../fixtures/recording.ts";
import { recording, shapeOf } from "../fixtures/recording.ts";
import type { JsonPathEngineOptions } from "./engine.ts";
import { createJsonPathEngineWith } from "./engine.ts";

let engine: HoldingSelectEngine;
let workers: Recording;
afterEach(() => engine.dispose());

/** An engine over the recorded real worker; no select runs in the calling thread, so each one reaches the worker. */
async function start(options: JsonPathEngineOptions = {}): Promise<void> {
  workers = recording();
  engine = createJsonPathEngineWith({ mainThreadNodeLimit: 0, ...options }, workers.spawn);
  await engine.load();
}

const compiled = (query: string): HeldSelect => {
  const result = engine.compile(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const charges = chargeList(400);
const paths = (count: number) =>
  Array.from({ length: count }, (_, at) => `$['data'][${String(at)}]`);
const held = (key: string, carried: boolean) => ({ kind: "jsonpath-held", key, carried });

describe("JSONPath over a held value", () => {
  it("sends the value with the first query only, and answers as a select over the value itself", async () => {
    await start();
    engine.hold("k", charges);
    const own = await compiled(galleryQuery).select(charges);
    expect(await compiled(galleryQuery).selectHeld("k")).toEqual(own);
    expect(await compiled("$.data[0:3]").selectHeld("k")).toEqual({
      ok: true,
      value: { paths: paths(3) },
    });
    expect(workers.posted().map(shapeOf)).toEqual([
      { kind: "jsonpath" },
      held("k", true),
      held("k", false),
    ]);
  });

  it("sends the value again to the worker that replaced a timed-out one, and answers", async () => {
    await start();
    engine.hold("k", charges);
    await compiled("$.data[0]").selectHeld("k");
    const list = Array.from({ length: 20_000 }).reduce<unknown>(
      (next) => ({ value: 1, next }),
      null,
    );
    expect(await compiled("$..value").select(list, { timeoutMs: 100 })).toMatchObject({
      ok: false,
      error: { kind: "timeout" },
    });
    expect(await compiled("$.data[1]").selectHeld("k")).toEqual({
      ok: true,
      value: { paths: ["$['data'][1]"] },
    });
    expect(workers.posted().map(shapeOf).slice(-1)).toEqual([held("k", true)]);
    expect(workers.spawned()).toBe(2);
  });
});

describe("JSONPath held values released", () => {
  it("releases a key in the worker: its queries fail after that, until it is held again", async () => {
    await start();
    engine.hold("k", charges);
    await compiled("$.data[0]").selectHeld("k");
    engine.release("k");
    expect(await compiled("$.data[0]").selectHeld("k")).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        message: "Nothing is held under k. Hold the value (hold), then run the query.",
      },
    });
    engine.hold("k", [1]);
    expect(await compiled("$[0]").selectHeld("k")).toEqual({
      ok: true,
      value: { paths: ["$[0]"] },
    });
    expect(workers.posted().map(shapeOf).slice(1)).toEqual([
      { kind: "release", keys: ["k"] },
      held("k", true),
    ]);
  });
});

describe("JSONPath held values and their bound", () => {
  it("forgets the oldest values past heldMaxBytes, in the worker too", async () => {
    const bytes = JSON.stringify(charges).length;
    await start({ heldMaxBytes: () => 2 * bytes });
    for (const key of ["a", "b", "c"]) {
      engine.hold(key, charges);
      expect(await compiled("$.data[0]").selectHeld(key)).toMatchObject({ ok: true });
    }
    expect(workers.posted().map(shapeOf).slice(-1)).toEqual([{ ...held("c", true), drop: ["a"] }]);
    expect(await compiled("$.data[0]").selectHeld("a")).toMatchObject({ ok: false });
    expect(await compiled("$.data[0]").selectHeld("b")).toMatchObject({ ok: true });
    expect(workers.posted().map(shapeOf).slice(-1)).toEqual([held("b", false)]);
  });

  it("answers a query asked before its key was released on the value it was asked for", async () => {
    await start();
    engine.hold("k", charges);
    const running = compiled(galleryQuery).select(charges);
    const asked = compiled("$.data[2]").selectHeld("k"); // queued behind the running select
    engine.release("k");
    expect(await asked).toEqual({ ok: true, value: { paths: ["$['data'][2]"] } });
    expect(await running).toMatchObject({ ok: true });
    expect(workers.posted().map(shapeOf)).toEqual([{ kind: "jsonpath" }, { kind: "jsonpath" }]);
  });

  it("starts no worker to release what a stopped worker held", async () => {
    await start();
    engine.hold("k", charges);
    await compiled("$.data[0]").selectHeld("k");
    const list = Array.from({ length: 20_000 }).reduce<unknown>(
      (next) => ({ value: 1, next }),
      null,
    );
    await compiled("$..value").select(list, { timeoutMs: 100 });
    engine.release("k");
    expect([workers.spawned(), workers.posted().map(shapeOf).at(-1)]).toEqual([
      1,
      { kind: "jsonpath" },
    ]);
  });
});
