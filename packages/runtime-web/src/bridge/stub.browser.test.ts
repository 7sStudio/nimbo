// Tests the stub's timeout against the real clock: RpcTimeout, and a late answer is ignored.
import { RpcTimeout } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { createStub } from "./stub.js";

describe("the stub's timeout", () => {
  it("rejects RpcTimeout after rpcTimeoutMs and ignores the answer that comes later", async () => {
    const { promise: answer, resolve } = Promise.withResolvers<unknown>();
    const stub = createStub("createIntent", {
      notebook: "demo.jsnb",
      transport: { call: () => answer },
      rpcTimeoutMs: 5,
      maxBytesPerValue: 1024,
      onRedacted: () => undefined,
      pauses: { paused: () => false, heldMs: () => 0 },
    });
    const error = await stub(2000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcTimeout);
    expect((error as RpcTimeout).data).toEqual({
      name: "createIntent",
      args: [2000],
      timeoutMs: 5,
    });
    expect((error as RpcTimeout).message).toBe(
      "createIntent(2000) did not answer within 0.005s. The server cell may be blocked; try kernel.interrupt.",
    );
    resolve({ result: 1 });
    await expect(answer).resolves.toEqual({ result: 1 });
  });

  it("answers within the timeout without waiting for it", async () => {
    const stub = createStub("f", {
      notebook: "demo.jsnb",
      transport: { call: () => Promise.resolve({ result: "ok" }) },
      rpcTimeoutMs: 60_000,
      maxBytesPerValue: 1024,
      onRedacted: () => undefined,
      pauses: { paused: () => false, heldMs: () => 0 },
    });
    expect(await stub()).toBe("ok");
  });
});

describe("the stub's timeout while the kernel is paused", () => {
  it("does not count the time the kernel is paused in the debugger", async () => {
    let paused = true;
    let heldMs = 0;
    const stub = createStub("f", {
      notebook: "demo.jsnb",
      transport: {
        call: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              paused = false;
              heldMs = 600;
              resolve({ result: "late" });
            }, 600);
          }),
      },
      rpcTimeoutMs: 50,
      maxBytesPerValue: 1024,
      onRedacted: () => undefined,
      pauses: { paused: () => paused, heldMs: () => heldMs },
    });
    expect(await stub()).toBe("late");
  });
});
