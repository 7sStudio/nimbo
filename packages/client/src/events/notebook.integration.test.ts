// A notebook subscription against the peer: hydrate with buffering, events in seq
// order, duplicates dropped, resync on a gap and on a malformed event.
import { describe, expect, it } from "vitest";

import { InvalidResponse } from "../errors/transport.js";
import { deletedAt, notebookPath } from "../fixtures/notebook.js";
import { followNotebook, serveNotebook } from "../fixtures/subscriptions.js";
import { socketWorld } from "../fixtures/world.js";

const world = socketWorld();

describe("subscribeNotebook", () => {
  it("hydrates, then delivers the buffered and the later events above the seq, in order, each once", async () => {
    const daemon = await world.peer();
    const { subscribes } = serveNotebook(daemon, {
      seqs: [3],
      onGet: (socket) => {
        for (const seq of [2, 5, 4, 4]) socket.notify("event", deletedAt(seq));
        return undefined;
      },
    });
    const { log, errors } = await followNotebook(world.connect(daemon));
    expect(log.entries).toEqual(["state 1 @3", "cell.deleted 4", "cell.deleted 5"]);
    const socket = daemon.sockets[0];
    for (const seq of [5, 6, 6]) socket?.notify("event", deletedAt(seq));
    socket?.notify("event", deletedAt(9, "other.jsnb"));
    socket?.notify("event", deletedAt(7));
    await expect(log.until(5)).resolves.toEqual([
      ...log.entries.slice(0, 3),
      "cell.deleted 6",
      "cell.deleted 7",
    ]);
    expect(subscribes).toEqual([{ notebook: notebookPath }]);
    expect(errors.entries).toEqual([]);
  });
});

describe("subscribeNotebook gaps", () => {
  it("resyncs on a gap: events.subscribe and notebook.get again, then on from the new seq", async () => {
    const daemon = await world.peer();
    const { subscribes } = serveNotebook(daemon, { seqs: [3, 6] });
    const { log } = await followNotebook(world.connect(daemon));
    const socket = daemon.sockets[0];
    socket?.notify("event", deletedAt(4));
    socket?.notify("event", deletedAt(6));
    await log.until(3);
    socket?.notify("event", deletedAt(7));
    await expect(log.until(4)).resolves.toEqual([
      "state 1 @3",
      "cell.deleted 4",
      "state 2 @6",
      "cell.deleted 7",
    ]);
    expect(subscribes).toHaveLength(2);
  });

  it("lets an unknown event type advance the seq without delivering it or faking a gap", async () => {
    const daemon = await world.peer();
    const { subscribes } = serveNotebook(daemon, { seqs: [3] });
    const { log } = await followNotebook(world.connect(daemon));
    const socket = daemon.sockets[0];
    socket?.notify("event", { ...deletedAt(4), type: "cell.renamed", data: { anything: true } });
    socket?.notify("event", deletedAt(5));
    await expect(log.until(2)).resolves.toEqual(["state 1 @3", "cell.deleted 5"]);
    expect(subscribes).toHaveLength(1);
  });
});

describe("subscribeNotebook on malformed events", () => {
  it("treats a malformed event as lost: InvalidResponse to onError, then a resync", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, { seqs: [3, 4, 4] });
    const { log, errors } = await followNotebook(world.connect(daemon));
    const socket = daemon.sockets[0];
    socket?.notify("event", { ...deletedAt(4), data: { cell: 42 } });
    await log.until(2);
    socket?.notify("event", { seq: "five" });
    await log.until(3);
    expect(log.entries).toEqual(["state 1 @3", "state 2 @4", "state 3 @4"]);
    expect(errors.entries.map((error) => error.constructor)).toEqual([
      InvalidResponse,
      InvalidResponse,
    ]);
  });
});

describe("subscribeNotebook on a malformed event before the start", () => {
  it("rejects the start with InvalidResponse, as any failure before the start does, and calls no onError", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, {
      seqs: [3],
      onGet: (socket) => {
        // An envelope with no usable seq is caught as it arrives, before the state is delivered.
        socket.notify("event", { ...deletedAt(4), seq: "four" });
        return undefined;
      },
    });
    const errors: unknown[] = [];
    const start = followNotebook(world.connect(daemon), { onError: (error) => errors.push(error) });
    await expect(start).rejects.toBeInstanceOf(InvalidResponse);
    expect(errors).toEqual([]);
  });
});
