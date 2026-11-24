// Tests the bridge client through runs (05-bridge §2 to §4, §7): stubs, copies, error bindings, failures, redaction.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BridgeHandler } from "../fixtures/transport.js";
import type { World } from "../fixtures/world.js";
import { createWorld, textOf, valueOf } from "../fixtures/world.js";

let world: World;
let answer: BridgeHandler = () => ({ result: null });
beforeEach(async () => {
  world = await createWorld({
    bridge: (fn, args) => answer(fn, args),
    limits: { rpcTimeoutMs: 50 },
  });
});
afterEach(async () => {
  await world.dispose();
});

const fn = { kind: "fn" } as const;

describe("a stub in a cell", () => {
  it("awaits sync and async server answers with real Dates, Maps and BigInts", async () => {
    answer = (name, args) =>
      name === "createIntent"
        ? { result: { amount: args[0], at: { $type: "date", iso: "2026-10-12T00:00:00.000Z" } } }
        : Promise.resolve({
            result: [{ $type: "map", entries: [["n", { $type: "bigint", value: "2" }]] }],
          });
    const run = await world.run(
      "const intent = await createIntent(2000)\nconst [m] = await rows();\n[intent.amount, intent.at instanceof Date, m.get('n')]",
      {
        bindings: { createIntent: fn, rows: fn },
      },
    );
    expect(valueOf(run)).toEqual([2000, true, 2n]);
  });

  it("round-trips Dates, Maps, BigInts and bytes as arguments and result", async () => {
    answer = (_name, args) => ({ result: args });
    const source =
      "const [d, m, b, u] = await echo(new Date(0), new Map([['k', 1]]), 5n, new Uint8Array([1, 2]));\n[d.getTime(), m.get('k'), b, [...u]]";
    expect(valueOf(await world.run(source, { bindings: { echo: fn } }))).toEqual([
      0,
      1,
      5n,
      [1, 2],
    ]);
  });
});

describe("a stub's refusals", () => {
  it("refuses a DOM node as an argument, before calling", async () => {
    const run = await world.run("await createIntent(display.div())", {
      bindings: { createIntent: fn },
    });
    expect(run.status.error).toMatchObject({
      name: "ArgumentNotSerializable",
      message:
        "Argument 1 of createIntent(...) is an HTMLDivElement and cannot be sent to the server.",
    });
    expect(world.transport.calls.some((call) => call.method === "bridge.call")).toBe(false);
  });

  it("times out after bridge.rpcTimeoutMs", async () => {
    answer = () => new Promise(() => undefined);
    const run = await world.run("await createIntent(2000)", { bindings: { createIntent: fn } });
    expect(run.status.error).toMatchObject({
      name: "RpcTimeout",
      data: { name: "createIntent", args: [2000], timeoutMs: 50 },
    });
  });
});

describe("a stub's failures and concurrency", () => {
  it("rejects with the server's error, which the cell can catch, with the server stack as cause", async () => {
    const error = {
      name: "CardError",
      message: "declined",
      frames: [{ cell: "c_d4e5f6", line: 3, col: 1 }],
      raw: "CardError: declined",
    };
    answer = () =>
      Promise.reject(Object.assign(new Error("failed"), { code: 2001, data: { error } }));
    const source =
      "await pay().catch((e) => [e.name, e.message, e.cause.frames[0].line, e instanceof Error])";
    expect(valueOf(await world.run(source, { bindings: { pay: fn } }))).toEqual([
      "CardError",
      "declined",
      3,
      true,
    ]);
  });

  it("answers concurrent calls independently", async () => {
    answer = (_name, [n]) => Promise.resolve({ result: Number(n) * 10 });
    const run = await world.run("await Promise.all([f(1), f(2), f(3)])", { bindings: { f: fn } });
    expect(valueOf(run)).toEqual([10, 20, 30]);
  });

  it("warns on the calling cell's stderr when the kernel redacted the result (04-kernel §10)", async () => {
    answer = () => ({ result: "***", redacted: true });
    const run = await world.run("await createIntent()", { bindings: { createIntent: fn } });
    const warning = await world.transport.until(
      (r) => r.execution === run.execution && r.output?.kind === "stream",
    );
    expect(textOf(warning.output ? [warning.output] : [], "stderr")).toBe(
      "redacted a secret in the result of createIntent\n",
    );
  });
});
