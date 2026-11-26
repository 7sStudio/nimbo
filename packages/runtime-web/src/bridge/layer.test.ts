// Tests the bridge layer: what each binding kind installs, and the restart tombstones.
import { JsnbError, KernelRestarted } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { createLayer, install, tombstone } from "./layer.js";
import type { StubContext } from "./stub.js";

const context: StubContext = {
  notebook: "demo.jsnb",
  transport: { call: () => Promise.resolve({ result: 7 }) },
  rpcTimeoutMs: 1000,
  maxBytesPerValue: 1024,
  onRedacted: () => undefined,
  pauses: { paused: () => false, heldMs: () => 0 },
};

const notTransferable = {
  name: "NotTransferable",
  message:
    "stripe is a Stripe instance on the server and cannot be copied to the browser. Export a function that uses it instead.",
  frames: [],
  raw: "",
  data: { name: "stripe", type: "Stripe" },
};

const installed = () => {
  const layer = createLayer();
  install(
    layer,
    {
      createIntent: { kind: "fn" },
      prices: {
        kind: "value",
        json: [{ id: "p1", at: { $type: "date", iso: "2026-01-01T00:00:00.000Z" } }],
      },
      stripe: { kind: "error", error: notTransferable },
    },
    context,
  );
  return layer;
};

describe("install", () => {
  it("gives a function an async stub, a value a decoded copy, an error a getter that throws it", async () => {
    const layer = installed();
    const stub = layer.values.createIntent as () => Promise<unknown>;
    expect(await stub()).toBe(7);
    expect(layer.values.prices).toEqual([{ id: "p1", at: new Date("2026-01-01T00:00:00.000Z") }]);
    expect(() => layer.values.stripe).toThrow(JsnbError);
    expect(() => layer.values.stripe).toThrow(notTransferable.message);
    expect([...layer.kinds]).toEqual([
      ["createIntent", "fn"],
      ["prices", "value"],
      ["stripe", "error"],
    ]);
    expect(Object.getPrototypeOf(layer.values)).toBeNull();
  });

  it("decodes each install afresh, so one run's copy is its own", () => {
    const json = [{ n: 1 }];
    const first = createLayer();
    const second = createLayer();
    install(first, { rows: { kind: "value", json } }, context);
    install(second, { rows: { kind: "value", json } }, context);
    const [row] = first.values.rows as { n: number }[];
    if (row) row.n = 99;
    expect(second.values.rows).toEqual([{ n: 1 }]);
    expect(json).toEqual([{ n: 1 }]);
  });
});

describe("tombstone", () => {
  it("makes listed stubs reject and listed snapshots throw KernelRestarted, and drops the rest", async () => {
    const layer = installed();
    tombstone(layer, {
      createIntent: { cell: "c_d4e5f6", index: 2 },
      prices: { cell: "c_d4e5f6", index: 2 },
    });
    const stub = layer.values.createIntent as () => Promise<unknown>;
    const error = await stub().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KernelRestarted);
    expect((error as KernelRestarted).message).toBe(
      "createIntent was defined before the kernel restarted. Re-run server cell 2.",
    );
    expect(() => layer.values.prices).toThrow(KernelRestarted);
    expect(Object.hasOwn(layer.values, "stripe")).toBe(false);
    expect([...layer.kinds.keys()]).toEqual(["createIntent", "prices"]);
  });

  it("ignores inherited names in the restart map", () => {
    const layer = createLayer();
    install(layer, { toString: { kind: "value" as const, json: 1 } }, context);
    tombstone(layer, {});
    expect(Object.hasOwn(layer.values, "toString")).toBe(false);
  });
});
