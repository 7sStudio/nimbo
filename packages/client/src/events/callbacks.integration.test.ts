// Subscriber callbacks that throw (03-api §7.6): the subscription ends with SubscriberFailed through its start or
// onError, and what onError itself throws reaches the connection's reportError; nothing is left unsettled.
import type { JsnbError } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { SubscriberFailed } from "../errors/subscriber.js";
import { deletedAt } from "../fixtures/notebook.js";
import { followNotebook, serveNotebook } from "../fixtures/subscriptions.js";
import { Log } from "../fixtures/waiting.js";
import { socketWorld } from "../fixtures/world.js";

const world = socketWorld();
const reducerBug = new TypeError("reducer bug");
const throwing = (): never => {
  throw reducerBug;
};

describe("a notebook subscriber that throws", () => {
  it("in onState of the first hydrate: the start rejects with SubscriberFailed, its cause the throw", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, { seqs: [3] });
    const start = followNotebook(world.connect(daemon), { onState: throwing });
    await expect(start).rejects.toBeInstanceOf(SubscriberFailed);
    await expect(start).rejects.toMatchObject({ data: { callback: "onState" }, cause: reducerBug });
  });

  it("in onEvent later: onError gets SubscriberFailed, the subscription closes, nothing more arrives", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, { seqs: [3] });
    const delivered = new Log<number>();
    const client = world.connect(daemon);
    const { errors, subscription } = await followNotebook(client, {
      onEvent: (event) => {
        delivered.push(event.seq);
        if (event.seq === 4) throwing();
      },
    });
    // A witness on the same socket: once it has seen event 5, the subscription under test has been handed it too.
    const witness = new Log<number>();
    await client.subscribeWorkspace({
      onEvent: (event) => {
        witness.push(event.seq);
      },
      onGap: () => undefined,
      onError: () => undefined,
    });
    daemon.sockets[0]?.notify("event", deletedAt(4));
    daemon.sockets[0]?.notify("event", deletedAt(5));
    await witness.until(2);
    expect(errors.entries).toMatchObject([
      { name: "SubscriberFailed", data: { callback: "onEvent" } },
    ]);
    expect(subscription.isOpen()).toBe(false);
    expect(delivered.entries).toEqual([4]);
  });
});

describe("a notebook subscriber whose onError throws", () => {
  it("in onError: the throw goes to the connection's reportError", async () => {
    const daemon = await world.peer();
    serveNotebook(daemon, { seqs: [3] });
    const reported = new Log<unknown>();
    const client = world.connect(daemon, { reportError: reported.push });
    await followNotebook(client, { onEvent: throwing, onError: throwing });
    daemon.sockets[0]?.notify("event", deletedAt(4));
    await expect(reported.until(1)).resolves.toEqual([reducerBug]);
  });
});

describe("a workspace subscriber that throws", () => {
  const follow = async (onEvent: () => void, onGap: () => void) => {
    const daemon = await world.peer();
    daemon.on("events.subscribe", () => ({ result: { seq: 0 } }));
    const errors = new Log<JsnbError>();
    const subscription = await world
      .connect(daemon)
      .subscribeWorkspace({ onEvent, onGap, onError: errors.push });
    return { daemon, errors, subscription };
  };

  it("in onGap or onEvent: onError gets SubscriberFailed naming it, and the subscription closes", async () => {
    const gap = await follow(() => undefined, throwing);
    gap.daemon.sockets[0]?.notify("event", deletedAt(1, "a.jsnb"));
    gap.daemon.sockets[0]?.notify("event", deletedAt(3, "a.jsnb"));
    await expect(gap.errors.until(1)).resolves.toMatchObject([{ data: { callback: "onGap" } }]);
    expect(gap.subscription.isOpen()).toBe(false);
    const event = await follow(throwing, () => undefined);
    event.daemon.sockets[0]?.notify("event", deletedAt(1, "a.jsnb"));
    await expect(event.errors.until(1)).resolves.toMatchObject([{ data: { callback: "onEvent" } }]);
    expect(event.subscription.isOpen()).toBe(false);
  });
});
