// Tests a subscription's life on an in-memory feed: start, resync after a reconnect, failure, close, and what happens
// when the subscriber's own callbacks throw.
import type { JsnbError } from "@jsnb/core";
import { Unauthorized } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { SubscriberFailed } from "../errors/subscriber.js";
import { ConnectionClosed } from "../errors/transport.js";
import type { ConnectionStatus } from "../socket/status.js";
import { createStatus } from "../socket/status.js";
import type { EventFeed, ShellHooks } from "./lifecycle.js";
import { Shell } from "./lifecycle.js";

/** A feed whose status and events the test drives, and which keeps what it is asked to report. */
const fakeFeed = (reason?: JsnbError) => {
  const reported: unknown[] = [];
  const status = createStatus((error) => reported.push(error));
  const listeners = new Set<(params: unknown) => void>();
  const feed: EventFeed = {
    call: () => Promise.reject(new Error("no calls here")),
    status: status.get,
    closeReason: () => reason,
    onStatus: status.listen,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    report: (error) => reported.push(error),
  };
  const emit = (params: unknown): void => {
    for (const listener of listeners) listener(params);
  };
  const set = (next: ConnectionStatus): void => {
    status.set(next);
  };
  return { feed, set, emit, reported };
};

const hooks = (onError: (error: JsnbError) => void = () => undefined) => {
  const seen = { received: [] as unknown[], resyncs: 0, errors: [] as JsnbError[] };
  const shellHooks: ShellHooks = {
    receive: (params) => seen.received.push(params),
    resync: () => (seen.resyncs += 1),
    onError: (error) => {
      seen.errors.push(error);
      onError(error);
    },
  };
  return { seen, hooks: shellHooks };
};

describe("Shell", () => {
  it("resolves the start once, passes events while open, resyncs only after a reconnect", async () => {
    const { feed, set, emit } = fakeFeed();
    const { seen, hooks: shellHooks } = hooks();
    const shell = new Shell(feed, shellHooks);
    set("live");
    shell.started();
    shell.started();
    const subscription = await shell.start;
    emit(1);
    set("reconnecting");
    set("live");
    subscription.close();
    emit(2);
    expect(seen).toEqual({ received: [1], resyncs: 1, errors: [] });
    expect(subscription.isOpen()).toBe(false);
  });

  it("rejects the start with the first failure, and reports later ones to onError, once", async () => {
    const early = new Shell(fakeFeed().feed, hooks().hooks);
    early.fail(new Unauthorized());
    await expect(early.start).rejects.toBeInstanceOf(Unauthorized);
    const { seen, hooks: shellHooks } = hooks();
    const late = new Shell(fakeFeed().feed, shellHooks);
    late.started();
    late.fail(new Unauthorized());
    late.fail(new Unauthorized());
    expect(seen.errors).toHaveLength(1);
    expect(late.isOpen()).toBe(false);
  });

  it("fails with the connection's reason when it closes, or ConnectionClosed when its owner closed it", async () => {
    const dead = fakeFeed(new Unauthorized());
    const shell = new Shell(dead.feed, hooks().hooks);
    dead.set("closed");
    await expect(shell.start).rejects.toBeInstanceOf(Unauthorized);
    const closed = fakeFeed();
    const other = new Shell(closed.feed, hooks().hooks);
    closed.set("closed");
    await expect(other.start).rejects.toBeInstanceOf(ConnectionClosed);
  });
});

describe("Shell with throwing callbacks", () => {
  it("ends with SubscriberFailed when a guarded callback throws, the throw as its cause", async () => {
    const thrown = new TypeError("reducer bug");
    const shell = new Shell(fakeFeed().feed, hooks().hooks);
    expect(shell.guard("onState", () => undefined)).toBe(true);
    expect(
      shell.guard("onState", () => {
        throw thrown;
      }),
    ).toBe(false);
    await expect(shell.start).rejects.toMatchObject({
      name: "SubscriberFailed",
      data: { callback: "onState" },
      cause: thrown,
    });
    expect(shell.isOpen()).toBe(false);
  });

  it("sends a throw after the start to onError, and what onError throws to the feed's report", () => {
    const fromOnError = new Error("onError bug");
    const { feed, reported } = fakeFeed();
    const { seen, hooks: shellHooks } = hooks(() => {
      throw fromOnError;
    });
    const shell = new Shell(feed, shellHooks);
    shell.started();
    shell.guard("onEvent", () => {
      throw new Error("reducer bug");
    });
    expect(seen.errors.map((error) => error.constructor)).toEqual([SubscriberFailed]);
    expect(reported).toEqual([fromOnError]);
  });
});

describe("Shell.recover", () => {
  it("fails the start before it, and tells onError after it while staying open", async () => {
    const before = new Shell(fakeFeed().feed, hooks().hooks);
    expect(before.recover(new Unauthorized())).toBe(false);
    await expect(before.start).rejects.toBeInstanceOf(Unauthorized);
    const { seen, hooks: shellHooks } = hooks();
    const after = new Shell(fakeFeed().feed, shellHooks);
    after.started();
    expect(after.recover(new Unauthorized())).toBe(true);
    expect(seen.errors).toHaveLength(1);
    expect(after.isOpen()).toBe(true);
  });
});
