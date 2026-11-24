// A workspace subscription against the peer (03-api §4.8, §7.6): every notebook's events, duplicates dropped per
// notebook, gaps reported while delivery goes on, unknown types skipped, a new events.subscribe after a reconnect.
import type { JsnbError } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { ConnectionClosed, InvalidResponse } from "../errors/transport.js";
import { deletedAt } from "../fixtures/notebook.js";
import type { Peer } from "../fixtures/peer.js";
import { Log } from "../fixtures/waiting.js";
import { socketWorld } from "../fixtures/world.js";
import type { SeqGap } from "./workspaceOrder.js";

const world = socketWorld();

function serve(daemon: Peer) {
  const subscribes = new Log<unknown>();
  daemon.on("events.subscribe", (params) => {
    subscribes.push(params);
    return { result: { seq: 0 } };
  });
  return subscribes;
}

async function follow(daemon: Peer) {
  const log = new Log<string>();
  const gaps = new Log<SeqGap>();
  const errors = new Log<JsnbError>();
  const client = world.connect(daemon);
  const subscription = await client.subscribeWorkspace({
    onEvent: (event) => {
      log.push(`${event.notebook} ${String(event.seq)}`);
    },
    onGap: gaps.push,
    onError: errors.push,
  });
  return { client, log, gaps, errors, subscription };
}

describe("subscribeWorkspace", () => {
  it("subscribes without a notebook and delivers every notebook's events, each once", async () => {
    const daemon = await world.peer();
    const subscribes = serve(daemon);
    const { log, gaps } = await follow(daemon);
    const socket = daemon.sockets[0];
    for (const [notebook, seq] of [
      ["a.jsnb", 1],
      ["b.jsnb", 7],
      ["a.jsnb", 2],
      ["a.jsnb", 2],
      ["b.jsnb", 8],
    ] as const) {
      socket?.notify("event", deletedAt(seq, notebook));
    }
    await expect(log.until(4)).resolves.toEqual(["a.jsnb 1", "b.jsnb 7", "a.jsnb 2", "b.jsnb 8"]);
    expect(subscribes.entries).toEqual([{}]);
    expect(gaps.entries).toEqual([]);
  });

  it("reports a gap and still delivers the event that revealed it", async () => {
    const daemon = await world.peer();
    serve(daemon);
    const { log, gaps } = await follow(daemon);
    const socket = daemon.sockets[0];
    socket?.notify("event", deletedAt(1, "a.jsnb"));
    socket?.notify("event", deletedAt(4, "a.jsnb"));
    await expect(log.until(2)).resolves.toEqual(["a.jsnb 1", "a.jsnb 4"]);
    expect(gaps.entries).toEqual([{ notebook: "a.jsnb", expected: 2, received: 4 }]);
  });
});

describe("subscribeWorkspace on odd events and reconnects", () => {
  it("skips an unknown type without a gap, and reports a malformed event to onError", async () => {
    const daemon = await world.peer();
    serve(daemon);
    const { log, gaps, errors } = await follow(daemon);
    const socket = daemon.sockets[0];
    socket?.notify("event", { ...deletedAt(1, "a.jsnb"), type: "cell.renamed" });
    socket?.notify("event", { ...deletedAt(2, "a.jsnb"), data: { cell: 1 } });
    socket?.notify("event", { notebook: "a.jsnb" });
    socket?.notify("event", deletedAt(3, "a.jsnb"));
    await expect(log.until(1)).resolves.toEqual(["a.jsnb 3"]);
    await errors.until(2);
    expect(errors.entries.every((error) => error instanceof InvalidResponse)).toBe(true);
    expect(gaps.entries).toEqual([]);
  });

  it("subscribes again after a reconnect and reports the events it missed as a gap", async () => {
    const daemon = await world.peer();
    const subscribes = serve(daemon);
    const { log, gaps } = await follow(daemon);
    daemon.sockets[0]?.notify("event", deletedAt(1, "a.jsnb"));
    await log.until(1);
    const reconnected = daemon.nextSocket();
    for (const socket of daemon.sockets) socket.drop();
    const socket = await reconnected;
    await subscribes.until(2);
    socket.notify("event", deletedAt(5, "a.jsnb"));
    await expect(gaps.until(1)).resolves.toEqual([
      { notebook: "a.jsnb", expected: 2, received: 5 },
    ]);
  });
});

describe("subscribeWorkspace failures", () => {
  it("rejects when events.subscribe fails, and closes with the connection", async () => {
    const daemon = await world.peer();
    daemon.on("events.subscribe", () => ({ error: { code: -32601, message: "not here" } }));
    await expect(follow(daemon)).rejects.toMatchObject({ name: "MethodNotFound" });
    const other = await world.peer();
    serve(other);
    const { client, errors, subscription } = await follow(other);
    client.close();
    await expect(errors.until(1)).resolves.toEqual([expect.any(ConnectionClosed)]);
    expect(subscription.isOpen()).toBe(false);
  });
});

describe("subscribeWorkspace on a malformed event before the start", () => {
  it("rejects the start with InvalidResponse, and calls no onError", async () => {
    const daemon = await world.peer();
    daemon.on("events.subscribe", (_params, context) => {
      if (context.transport === "ws") context.socket.notify("event", { notebook: "a.jsnb" });
      return { result: { seq: 0 } };
    });
    const errors: unknown[] = [];
    const start = world.connect(daemon).subscribeWorkspace({
      onEvent: () => undefined,
      onGap: () => undefined,
      onError: (error) => errors.push(error),
    });
    await expect(start).rejects.toBeInstanceOf(InvalidResponse);
    expect(errors).toEqual([]);
  });
});
