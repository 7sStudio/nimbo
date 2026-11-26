// Calls over the WebSocket against the peer: the declaration, concurrent calls matched by id,
// calls made while connecting, aborts, closing, and frames the client cannot read.
import { CellNotFound } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { socketUrl } from "../daemon/address.js";
import { CallAborted, ConnectionClosed, InvalidResponse } from "../errors/transport.js";
import type { WireAnswer } from "../fixtures/answers.js";
import { cell, queued } from "../fixtures/values.js";
import { statusLog, untilStatus } from "../fixtures/waiting.js";
import { socketWorld } from "../fixtures/world.js";
import { openWebSocket } from "./socketLike.js";

const world = socketWorld();
const ref = { notebook: "demo.jsnb", cell: "c_a1b2c3" };

describe("a socket client", () => {
  it("declares its token, client and agent on the upgrade and goes live", async () => {
    const daemon = await world.peer();
    const connected = daemon.nextSocket();
    const client = world.connect(daemon, { client: "mcp", agent: "claude-code" });
    const log = statusLog(client);
    expect(client.status()).toBe("connecting");
    const socket = await connected;
    expect(Object.fromEntries(socket.query)).toEqual({
      token: daemon.token,
      client: "mcp",
      agent: "claude-code",
    });
    await untilStatus(client, "live");
    expect(log).toEqual(["live"]);
  });

  it("holds calls made while connecting and sends them once live", async () => {
    const daemon = await world.peer();
    daemon.on("cell.get", () => ({ result: { cell } }));
    const client = world.connect(daemon);
    await expect(client.cell.get(ref)).resolves.toEqual({ cell });
  });
});

describe("a socket client given its own socket", () => {
  it("opens it for the declared URL and speaks through it", async () => {
    const daemon = await world.peer();
    daemon.on("cell.get", () => ({ result: { cell } }));
    const opened: string[] = [];
    const client = world.connect(daemon, {
      openSocket: (url, events) => {
        opened.push(url);
        return openWebSocket(url, events);
      },
    });
    await expect(client.cell.get(ref)).resolves.toEqual({ cell });
    expect(opened).toEqual([socketUrl({ url: daemon.url, token: daemon.token, client: "ui" })]);
  });
});

describe("a socket client's answers", () => {
  it("matches concurrent calls by id, whatever order the answers come in", async () => {
    const daemon = await world.peer();
    const first = Promise.withResolvers<WireAnswer>();
    const arrived = Promise.withResolvers<undefined>();
    daemon.on("cell.run", () => {
      arrived.resolve(undefined);
      return first.promise;
    });
    daemon.on("cell.get", () => ({ result: { cell } }));
    const client = world.connect(daemon);
    const run = client.cell.run(ref);
    await arrived.promise;
    await expect(client.cell.get(ref)).resolves.toEqual({ cell });
    first.resolve({ result: { execution: queued } });
    await expect(run).resolves.toEqual({ execution: queued });
  });

  it("raises the daemon's ApiError, and InvalidResponse for a result that fails the schema", async () => {
    const daemon = await world.peer();
    daemon.on("cell.get", () => ({
      error: { code: 1002, message: "gone", data: { cell: "c_a1b2c3" } },
    }));
    daemon.on("cell.outputs", () => ({ result: { execution: { id: 1 } } }));
    daemon.on("kernel.status", (_params, context) => {
      if (context.transport === "ws")
        context.socket.send('{"jsonrpc":"2.0","id":3,"result":1,"error":{}}');
      return { raw: "" };
    });
    const client = world.connect(daemon);
    await expect(client.cell.get(ref)).rejects.toBeInstanceOf(CellNotFound);
    await expect(client.cell.outputs(ref)).rejects.toBeInstanceOf(InvalidResponse);
    await expect(client.kernel.status({ notebook: "demo.jsnb" })).rejects.toBeInstanceOf(
      InvalidResponse,
    );
  });
});

describe("a socket client aborting a call", () => {
  it("aborts a call: CallAborted at once, the late answer dropped, the connection still usable", async () => {
    const daemon = await world.peer();
    const release = Promise.withResolvers<WireAnswer>();
    const arrived = Promise.withResolvers<undefined>();
    daemon.on("cell.run", () => {
      arrived.resolve(undefined);
      return release.promise;
    });
    daemon.on("cell.get", () => ({ result: { cell } }));
    const client = world.connect(daemon);
    const controller = new AbortController();
    const run = client.cell.run(ref, { signal: controller.signal });
    await arrived.promise;
    controller.abort(new Error("user pressed stop"));
    await expect(run).rejects.toBeInstanceOf(CallAborted);
    await expect(run).rejects.toMatchObject({ cause: new Error("user pressed stop") });
    release.resolve({ result: { execution: queued } });
    await expect(client.cell.get(ref)).resolves.toEqual({ cell });
    await expect(client.cell.get(ref, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
      CallAborted,
    );
  });
});

describe("a socket client closed by its owner", () => {
  it("closes for good: pending and later calls fail with ConnectionClosed, and nothing reconnects", async () => {
    const daemon = await world.peer();
    const arrived = Promise.withResolvers<undefined>();
    daemon.on("cell.run", () => {
      arrived.resolve(undefined);
      return new Promise<WireAnswer>(() => undefined);
    });
    const client = world.connect(daemon);
    const run = client.cell.run(ref);
    await arrived.promise;
    client.close();
    expect(client.status()).toBe("closed");
    await expect(run).rejects.toBeInstanceOf(ConnectionClosed);
    await expect(client.cell.get(ref)).rejects.toMatchObject({
      name: "ConnectionClosed",
      data: { method: "cell.get" },
    });
    client.close();
    expect(daemon.sockets).toHaveLength(1);
  });
});

describe("a socket client given unreadable frames", () => {
  it("answers a frame it cannot read with the JSON-RPC error, and keeps going", async () => {
    const daemon = await world.peer();
    daemon.on("cell.get", () => ({ result: { cell } }));
    const connected = daemon.nextSocket();
    const client = world.connect(daemon);
    const socket = await connected;
    await untilStatus(client, "live");
    socket.send("{not json");
    await expect(socket.nextFrame()).resolves.toMatchObject({ id: null, error: { code: -32700 } });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: "s1", method: 7 }));
    await expect(socket.nextFrame()).resolves.toMatchObject({ id: "s1", error: { code: -32600 } });
    await expect(client.cell.get(ref)).resolves.toEqual({ cell });
  });
});
