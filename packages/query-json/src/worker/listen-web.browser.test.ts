// Tests of listen-web.ts in Chromium over a real MessageChannel standing in for the worker's scope.
import { describe, expect, it } from "vitest";

import { ok } from "../errors.ts";
import { listenWeb } from "./listen-web.ts";

describe("listenWeb", () => {
  it("answers each message on the scope with what serve returns", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      listenWeb(port1, (task) => Promise.resolve(ok({ echo: task })));
      port1.start();
      const reply = new Promise<unknown>((resolve) => {
        port2.addEventListener("message", (event: MessageEvent<unknown>) => {
          resolve(event.data);
        });
      });
      port2.start();
      port2.postMessage({ kind: "warm-jq" });
      expect(await reply).toEqual({ ok: true, value: { echo: { kind: "warm-jq" } } });
    } finally {
      port1.close();
      port2.close();
    }
  });
});
