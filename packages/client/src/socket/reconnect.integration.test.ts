// Drops and reconnects: the status the UI mirrors, calls re-sent when safe and
// failed when not, calls held or aborted while reconnecting, 4401 and running out of attempts.
import { Unauthorized } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { CallAborted, ConnectionDropped, DaemonUnreachable } from "../errors/transport.js";
import type { WireAnswer } from "../fixtures/answers.js";
import { cell, queued } from "../fixtures/values.js";
import { statusLog, untilStatus } from "../fixtures/waiting.js";
import { socketWorld } from "../fixtures/world.js";

const world = socketWorld();
const ref = { notebook: "demo.jsnb", cell: "c_a1b2c3" };
const never = (): Promise<WireAnswer> => new Promise(() => undefined);

describe("a socket client that loses its connection", () => {
  it("reconnects, re-sends a read that was in flight and fails a mutating call with ConnectionDropped", async () => {
    const daemon = await world.peer();
    const inFlight = Promise.withResolvers<undefined>();
    let gets = 0;
    let runs = 0;
    daemon.on("cell.get", () => (++gets === 1 ? never() : { result: { cell } }));
    daemon.on("cell.run", () => {
      runs += 1;
      inFlight.resolve(undefined);
      return never();
    });
    const client = world.connect(daemon);
    const log = statusLog(client);
    const get = client.cell.get(ref);
    const run = client.cell.run(ref);
    await inFlight.promise;
    const reconnected = daemon.nextSocket();
    for (const socket of daemon.sockets) socket.drop();
    await expect(run).rejects.toBeInstanceOf(ConnectionDropped);
    await expect(get).resolves.toEqual({ cell });
    await reconnected;
    expect([gets, runs]).toEqual([2, 1]);
    expect(log).toEqual(["live", "reconnecting", "live"]);
  });
});

describe("a socket client reconnecting", () => {
  it("re-sends an idempotent mutating call (cell.update)", async () => {
    const daemon = await world.peer();
    const inFlight = Promise.withResolvers<undefined>();
    let updates = 0;
    daemon.on("cell.update", () => {
      updates += 1;
      if (updates > 1) return { result: { cell } };
      inFlight.resolve(undefined);
      return never();
    });
    const client = world.connect(daemon);
    const update = client.cell.update({ ...ref, source: "2" });
    await inFlight.promise;
    for (const socket of daemon.sockets) socket.drop();
    await expect(update).resolves.toEqual({ cell });
  });

  it("holds calls made while reconnecting until the socket is live again", async () => {
    const daemon = await world.peer();
    daemon.on("cell.run", () => ({ result: { execution: queued } }));
    const client = world.connect(daemon);
    await untilStatus(client, "live");
    for (const socket of daemon.sockets) socket.drop();
    await untilStatus(client, "reconnecting");
    const run = client.cell.run(ref);
    await expect(run).resolves.toEqual({ execution: queued });
    expect(daemon.sockets).toHaveLength(2);
  });
});

describe("a socket client giving up", () => {
  it("gives up after its attempts: closed, with DaemonUnreachable for pending and later calls", async () => {
    const daemon = await world.peer();
    const inFlight = Promise.withResolvers<undefined>();
    daemon.on("cell.get", () => {
      inFlight.resolve(undefined);
      return never();
    });
    const client = world.connect(daemon, { reconnect: { attempts: 2, baseMs: 1, maxMs: 1 } });
    const log = statusLog(client);
    const get = client.cell.get(ref);
    await inFlight.promise;
    await daemon.close();
    const failure = get.catch((error: unknown) => error);
    await expect(failure).resolves.toBeInstanceOf(DaemonUnreachable);
    await expect(failure).resolves.toMatchObject({ data: { url: daemon.url, attempts: 2 } });
    expect(log).toEqual(["live", "reconnecting", "closed"]);
    await expect(client.cell.get(ref)).rejects.toBeInstanceOf(DaemonUnreachable);
  });

  it("gives up at once when the daemon is not there and one attempt is allowed", async () => {
    const daemon = await world.peer();
    await daemon.close();
    const client = world.connect(daemon, { reconnect: { attempts: 1 } });
    await expect(client.workspace.info()).rejects.toMatchObject({
      name: "DaemonUnreachable",
      data: { attempts: 1 },
    });
    expect(client.status()).toBe("closed");
  });

  it("closes for good on 4401: Unauthorized, and no reconnect", async () => {
    const daemon = await world.peer();
    const client = world.connect(daemon, { token: "wrong" });
    const log = statusLog(client);
    await expect(client.cell.get(ref)).rejects.toBeInstanceOf(Unauthorized);
    expect(client.status()).toBe("closed");
    expect(log).toEqual(["live", "closed"]);
    await expect(client.workspace.info()).rejects.toBeInstanceOf(Unauthorized);
    expect(daemon.sockets).toHaveLength(1);
  });
});

describe("a socket client aborting a call while reconnecting", () => {
  it("withdraws the call: CallAborted at once, and it is never sent", async () => {
    const daemon = await world.peer();
    let runs = 0;
    daemon.on("cell.run", () => {
      runs += 1;
      return { result: { execution: queued } };
    });
    daemon.on("cell.get", () => ({ result: { cell } }));
    const client = world.connect(daemon);
    await untilStatus(client, "live");
    for (const socket of daemon.sockets) socket.drop();
    await untilStatus(client, "reconnecting");
    const controller = new AbortController();
    const run = client.cell.run(ref, { signal: controller.signal });
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(CallAborted);
    await untilStatus(client, "live");
    await expect(client.cell.get(ref)).resolves.toEqual({ cell });
    expect(runs).toBe(0);
  });
});
