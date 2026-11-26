// The daemon's requests to the page on the same socket, answered by registered handlers
// that survive reconnects.
import { BridgeCallFailed } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { untilStatus } from "../fixtures/waiting.js";
import { socketWorld } from "../fixtures/world.js";

const world = socketWorld();

const execute = {
  execution: "x_a1b2c3d4",
  cell: "c_a1b2c3",
  code: "(async (__scope) => {})",
  map: "{}",
  bindings: { createIntent: { kind: "fn" } },
};

describe("a socket client's request handlers", () => {
  it("answer realm.execute with the handler's result, given validated params", async () => {
    const daemon = await world.peer();
    const connected = daemon.nextSocket();
    const client = world.connect(daemon);
    const seen: unknown[] = [];
    client.handle("realm.execute", (params) => {
      seen.push(params.bindings);
      return { accepted: params.execution };
    });
    const socket = await connected;
    await untilStatus(client, "live");
    await expect(socket.request("realm.execute", execute)).resolves.toEqual({
      jsonrpc: "2.0",
      id: "peer-1",
      result: { accepted: "x_a1b2c3d4" },
    });
    expect(seen).toEqual([{ createIntent: { kind: "fn" } }]);
  });
});

describe("a socket client's request handlers on failures", () => {
  it("answer an ApiError with its code, another throw with -32603, bad params with -32602, no handler with -32601", async () => {
    const daemon = await world.peer();
    const connected = daemon.nextSocket();
    const client = world.connect(daemon);
    client.handle("realm.reset", () => {
      throw new BridgeCallFailed({
        error: { name: "TypeError", message: "x", frames: [], raw: "" },
      });
    });
    client.handle("realm.snapshot", async () => {
      await Promise.resolve();
      throw new Error("no container for c_a1b2c3");
    });
    client.handle("realm.execute", () => ({}));
    const socket = await connected;
    await untilStatus(client, "live");
    await expect(socket.request("realm.reset", {})).resolves.toMatchObject({
      error: { code: 2001, data: { error: { name: "TypeError" } } },
    });
    await expect(socket.request("realm.snapshot", { cell: "c_a1b2c3" })).resolves.toMatchObject({
      error: { code: -32603, message: "no container for c_a1b2c3" },
    });
    await expect(socket.request("realm.execute", { cell: "nope" })).resolves.toMatchObject({
      error: { code: -32602 },
    });
    await expect(socket.request("bridge.event", { name: "x", data: 1 })).resolves.toMatchObject({
      error: { code: -32601 },
    });
  });
});

describe("a socket client's request handlers across reconnects", () => {
  it("keep answering after a reconnect, and stop once removed", async () => {
    const daemon = await world.peer();
    const client = world.connect(daemon);
    const remove = client.handle("realm.reset", () => ({ reset: true }));
    await untilStatus(client, "live");
    const reconnected = daemon.nextSocket();
    for (const socket of daemon.sockets) socket.drop();
    const socket = await reconnected;
    await untilStatus(client, "live");
    await expect(socket.request("realm.reset", {})).resolves.toMatchObject({
      result: { reset: true },
    });
    remove();
    await expect(socket.request("realm.reset", {})).resolves.toMatchObject({
      error: { code: -32601 },
    });
  });
});
