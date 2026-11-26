// A notebook subscription's recovery and end against the peer: a resync after
// every reconnect, a drop during the first hydrate, failures, and closing with the connection or by its owner.
import { NotebookNotFound } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { ConnectionClosed } from "../errors/transport.js";
import { deletedAt, notebookPath } from "../fixtures/notebook.js";
import { followNotebook, serveNotebook } from "../fixtures/subscriptions.js";
import { socketWorld } from "../fixtures/world.js";

const world = socketWorld();

describe("subscribeNotebook across reconnects", () => {
  it("resyncs after every reconnect", async () => {
    const daemon = await world.peer();
    const { subscribes } = serveNotebook(daemon, { seqs: [3, 8] });
    const { log } = await followNotebook(world.connect(daemon));
    for (const socket of daemon.sockets) socket.drop();
    await expect(log.until(2)).resolves.toEqual(["state 1 @3", "state 2 @8"]);
    expect(subscribes).toHaveLength(2);
  });

  it("starts after a reconnect when the connection drops during the first hydrate", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, {
      seqs: [3],
      onGet: (_socket, n) => (n === 1 ? { destroy: true } : undefined),
    });
    const { log } = await followNotebook(world.connect(daemon));
    expect(log.entries).toEqual(["state 2 @3"]);
  });
});

describe("subscribeNotebook failures", () => {
  it("rejects when the first hydrate fails, and delivers nothing", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, {
      seqs: [3],
      onGet: () => ({
        error: { code: 1001, message: "no such notebook", data: { path: notebookPath } },
      }),
    });
    await expect(followNotebook(world.connect(daemon))).rejects.toBeInstanceOf(NotebookNotFound);
  });

  it("closes and reports to onError when a resync fails", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, {
      seqs: [3, 9],
      onGet: (_socket, n) =>
        n === 2
          ? { error: { code: 1001, message: "closed", data: { path: notebookPath } } }
          : undefined,
    });
    const { errors, subscription } = await followNotebook(world.connect(daemon));
    daemon.sockets[0]?.notify("event", deletedAt(9));
    const [error] = await errors.until(1);
    expect(error).toBeInstanceOf(NotebookNotFound);
    expect(subscription.isOpen()).toBe(false);
  });
});

describe("subscribeNotebook closing", () => {
  it("closes with the connection, and stops delivering once closed by its owner", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, { seqs: [3] });
    const client = world.connect(daemon);
    const first = await followNotebook(client);
    const second = await followNotebook(client);
    first.subscription.close();
    daemon.sockets[0]?.notify("event", deletedAt(4));
    await second.log.until(2);
    expect(first.log.entries).toEqual(["state 1 @3"]);
    expect(first.subscription.isOpen()).toBe(false);
    client.close();
    const [error] = await second.errors.until(1);
    expect(error).toBeInstanceOf(ConnectionClosed);
    expect(second.subscription.isOpen()).toBe(false);
  });
});
