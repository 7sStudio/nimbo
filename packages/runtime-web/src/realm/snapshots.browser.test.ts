// Tests value snapshots, error bindings and a kernel restart through runs.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { World } from "../fixtures/world.js";
import { createWorld, valueOf } from "../fixtures/world.js";

let world: World;
let calls = 0;
beforeEach(async () => {
  calls = 0;
  world = await createWorld({ bridge: () => ({ result: (calls += 1) }) });
});
afterEach(async () => {
  await world.dispose();
});

const prices = { kind: "value", json: [{ id: "p1" }] } as const;
const stripe = {
  kind: "error",
  error: {
    name: "NotTransferable",
    message:
      "stripe is a Stripe instance on the server and cannot be copied to the browser. Export a function that uses it instead.",
    frames: [],
    raw: "",
    data: { name: "stripe", type: "Stripe" },
  },
} as const;
const restarted = {
  bridge: { createIntent: { cell: "c_d4e5f6", index: 2 }, prices: { cell: "c_d4e5f6", index: 2 } },
};

describe("snapshots and error bindings", () => {
  it("give each run its own copy of a value", async () => {
    await world.run("prices[0].id = 'changed'\nprices[0].id", { bindings: { prices } });
    expect(valueOf(await world.run("prices[0].id", { bindings: { prices } }))).toBe("p1");
  });

  it("fail a run that reads a non-transferable export with the daemon's message", async () => {
    const run = await world.run("stripe.customers", { bindings: { stripe } });
    expect(run.status.error).toMatchObject({
      name: "NotTransferable",
      message: stripe.error.message,
      data: stripe.error.data,
    });
  });
});

describe("realm.reset { bridge }", () => {
  it("turns current stubs and snapshots into KernelRestarted, keeps client definitions, and heals on re-run", async () => {
    const source =
      "const keep = 'client'\nfunction pay() { return createIntent() }\nfunction list() { return prices }";
    const definer = await world.run(source, {
      bindings: { createIntent: { kind: "fn" }, prices, stripe },
    });
    expect(await world.realm.handle("realm.reset", restarted)).toEqual({});
    const stub = await world.run("await pay()");
    expect(stub.status.error).toMatchObject({
      name: "KernelRestarted",
      message: "createIntent was defined before the kernel restarted. Re-run server cell 2.",
    });
    expect((await world.run("list()")).status.error).toMatchObject({ name: "KernelRestarted" });
    expect(valueOf(await world.run("keep"))).toBe("client");
    await world.run(source, {
      cell: definer.cell,
      bindings: { createIntent: { kind: "fn" }, prices },
    });
    expect(valueOf(await world.run("[await pay(), list()]"))).toEqual([1, [{ id: "p1" }]]);
  });

  it("removes a name the restart map does not list", async () => {
    await world.run("function read() { return typeof stripe }", { bindings: { stripe } });
    await world.realm.handle("realm.reset", { bridge: {} });
    expect(valueOf(await world.run("read()"))).toBe("undefined");
  });
});
