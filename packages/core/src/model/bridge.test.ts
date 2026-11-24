// Tests the bridge protocol shapes of 05-bridge §9.
import { describe, expect, it } from "vitest";

import {
  BridgeEvent,
  RealmExecute,
  RealmInterrupt,
  RealmInterruptAnswer,
  RealmReport,
  RealmReset,
  RealmSnapshot,
  SnapshotBinding,
} from "./bridge.js";

describe("RealmExecute", () => {
  it("carries the three binding kinds", () => {
    const message = RealmExecute.parse({
      execution: "x_9f8e7d6c",
      cell: "c_a1b2c3",
      code: "",
      map: "{}",
      bindings: {
        createIntent: { kind: "fn" },
        prices: { kind: "value", json: [1, 2] },
        stripe: {
          kind: "error",
          error: { name: "NotTransferable", message: "m", frames: [], raw: "" },
        },
      },
    });
    expect(Object.keys(message.bindings)).toHaveLength(3);
    expect(SnapshotBinding.safeParse({ kind: "class" }).success).toBe(false);
  });

  it("carries the client's public env when the daemon sends it", () => {
    const base = { execution: "x_9f8e7d6c", cell: "c_a1b2c3", code: "", map: "{}", bindings: {} };
    expect(RealmExecute.parse(base).env).toBeUndefined();
    expect(RealmExecute.parse({ ...base, env: { PUBLIC_URL: "u" } }).env).toEqual({
      PUBLIC_URL: "u",
    });
    expect(RealmExecute.safeParse({ ...base, env: { PUBLIC_N: 1 } }).success).toBe(false);
  });
});

describe("RealmExecute's limits", () => {
  it("carries the run's limits, all four whole and positive, when the daemon sends them", () => {
    const base = { execution: "x_9f8e7d6c", cell: "c_a1b2c3", code: "", map: "{}", bindings: {} };
    const limits = {
      rpcTimeoutMs: 120_000,
      maxBytesPerValue: 1024,
      maxValueBytes: 2048,
      maxStreamBytes: 4096,
    };
    expect(RealmExecute.parse(base).limits).toBeUndefined();
    expect(RealmExecute.parse({ ...base, limits }).limits).toEqual(limits);
    expect(
      RealmExecute.safeParse({ ...base, limits: { ...limits, rpcTimeoutMs: 0 } }).success,
    ).toBe(false);
    expect(RealmExecute.safeParse({ ...base, limits: { rpcTimeoutMs: 1 } }).success).toBe(false);
  });
});

describe("RealmExecute's unbound names", () => {
  it("carries an ErrorInfo per name the daemon could not bind", () => {
    const base = { execution: "x_9f8e7d6c", cell: "c_a1b2c3", code: "", map: "{}", bindings: {} };
    const error = { name: "NotExported", message: "m", frames: [], raw: "" };
    expect(RealmExecute.parse(base).unbound).toBeUndefined();
    expect(RealmExecute.parse({ ...base, unbound: { crypto: error } }).unbound).toEqual({
      crypto: error,
    });
    expect(RealmExecute.safeParse({ ...base, unbound: { crypto: "no" } }).success).toBe(false);
  });
});

describe("RealmInterrupt", () => {
  it("names the execution the page should end, and the page answers what that run defined", () => {
    expect(RealmInterrupt.parse({ execution: "x_9f8e7d6c" })).toEqual({ execution: "x_9f8e7d6c" });
    expect(RealmInterrupt.safeParse({ execution: "nope" }).success).toBe(false);
    expect(RealmInterruptAnswer.parse({ defines: ["box"] })).toEqual({ defines: ["box"] });
    const dom = { html: "<button>Pay</button>", text: "Pay" };
    expect(RealmInterruptAnswer.parse({ defines: [], dom })).toEqual({ defines: [], dom });
    expect(RealmInterruptAnswer.parse({})).toEqual({});
    expect(RealmInterruptAnswer.safeParse({ defines: "box" }).success).toBe(false);
  });
});

describe("RealmReset", () => {
  it("is the full reset without bridge and a kernel restart with it", () => {
    expect(RealmReset.parse({})).toEqual({});
    const restart = RealmReset.parse({ bridge: { createIntent: { cell: "c_d4e5f6", index: 2 } } });
    expect(restart.bridge).toEqual({ createIntent: { cell: "c_d4e5f6", index: 2 } });
    expect(RealmReset.safeParse({ bridge: { f: { cell: "c_d4e5f6", index: 0 } } }).success).toBe(
      false,
    );
    expect(RealmReset.safeParse({ bridge: { f: { cell: "bad", index: 1 } } }).success).toBe(false);
  });
});

describe("RealmReport", () => {
  it("accepts an output, a status with defines, and the small messages", () => {
    expect(
      RealmReport.parse({
        realmId: "r1",
        execution: "x_9f8e7d6c",
        output: { kind: "dom", html: "", text: "" },
      }).output?.kind,
    ).toBe("dom");
    expect(
      RealmReport.parse({ realmId: "r1", execution: "x_9f8e7d6c", status: "ok", defines: ["a"] })
        .defines,
    ).toEqual(["a"]);
    const failed = RealmReport.parse({
      realmId: "r1",
      execution: "x_9f8e7d6c",
      status: "error",
      error: {
        name: "TypeError",
        message: "m",
        frames: [{ cell: "c_a1b2c3", line: 2, col: 1 }],
        raw: "",
      },
      durationMs: 1.5,
      defines: [],
    });
    expect(failed.error?.name).toBe("TypeError");
    expect(failed.durationMs).toBe(1.5);
    expect(RealmReset.parse({})).toEqual({});
    expect(RealmSnapshot.parse({ cell: "c_a1b2c3" }).cell).toBe("c_a1b2c3");
    expect(BridgeEvent.parse({ name: "paid", data: { id: 1 } }).name).toBe("paid");
  });
});
