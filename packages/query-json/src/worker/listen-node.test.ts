// Tests of listen-node.ts over a real worker_threads MessageChannel in the test's own thread.
import { once } from "node:events";
import { MessageChannel } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { ok } from "../errors.ts";
import { listenNode } from "./listen-node.ts";

describe("listenNode", () => {
  it("answers each message on the port with what serve returns", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      listenNode(port1, (task) => Promise.resolve(ok({ echo: task })));
      port2.postMessage({ kind: "warm-jq" });
      const replies: unknown[] = await once(port2, "message");
      expect(replies[0]).toEqual({ ok: true, value: { echo: { kind: "warm-jq" } } });
    } finally {
      port1.close();
    }
  });

  it("does nothing without a port (outside a worker)", () => {
    expect(() => {
      listenNode(null, () => Promise.resolve(ok(null)));
    }).not.toThrow();
  });
});
