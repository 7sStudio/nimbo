// The life of an event subscription on a connection (02-architecture §4.2, 03-api §7.6): it starts when its first
// sync succeeds, syncs again after every reconnect, and ends when its owner closes it, the connection closes, a sync
// fails, or the subscriber's own callback throws.
import type { JsnbError } from "@jsnb/core";

import type { Caller } from "../call/caller.js";
import type { SubscriberCallback } from "../errors/subscriber.js";
import { SubscriberFailed } from "../errors/subscriber.js";
import { ConnectionClosed } from "../errors/transport.js";
import type { ConnectionStatus } from "../socket/status.js";

/** What a subscription needs of a connection. */
export type EventFeed = {
  readonly call: Caller;
  readonly status: () => ConnectionStatus;
  /** Why the connection closed for good; undefined when its owner closed it. */
  readonly closeReason: () => JsnbError | undefined;
  readonly onStatus: (listener: (status: ConnectionStatus) => void) => () => void;
  readonly onEvent: (listener: (params: unknown) => void) => () => void;
  /** Where an error goes that no caller waits for, such as one onError throws. */
  readonly report: (error: unknown) => void;
};

/** A running subscription; closing it stops delivery here (the daemon keeps sending to the socket, which drops them). */
export type Subscription = {
  readonly close: () => void;
  readonly isOpen: () => boolean;
};

/** What the shell calls back into. */
export type ShellHooks = {
  readonly receive: (params: unknown) => void;
  /** The connection is live again after a drop. */
  readonly resync: () => void;
  readonly onError: (error: JsnbError) => void;
};

/** The part every subscription shares: open or closed, started or not, and how its errors reach the subscriber. */
export class Shell {
  readonly start: Promise<Subscription>;
  readonly #feed: EventFeed;
  readonly #hooks: ShellHooks;
  readonly #first = Promise.withResolvers<Subscription>();
  readonly #stops: (() => void)[] = [];
  #open = true;
  #started = false;
  #previous: ConnectionStatus;

  constructor(feed: EventFeed, hooks: ShellHooks) {
    this.#feed = feed;
    this.#hooks = hooks;
    this.#previous = feed.status();
    this.start = this.#first.promise;
    this.#stops.push(
      feed.onEvent((params) => {
        if (this.#open) hooks.receive(params);
      }),
      feed.onStatus((status) => {
        this.#statusChanged(status);
      }),
    );
  }

  isOpen(): boolean {
    return this.#open;
  }

  /** The first sync succeeded: the start resolves, once. */
  started(): void {
    if (this.#open && !this.#started) {
      const close = (): void => {
        this.#close();
      };
      this.#first.resolve({ close, isOpen: () => this.#open });
    }
    this.#started = true;
  }

  /** Ends the subscription: the start rejects with `error`, or onError gets it once started. */
  fail(error: JsnbError): void {
    if (!this.#open) return;
    this.#close();
    if (this.#started) this.#warn(error);
    else this.#first.reject(error);
  }

  /**
   * A failure the subscription survives once started: onError hears of it and this is true. Before the start it ends
   * the subscription like any start failure (the start rejects) and this is false.
   */
  recover(error: JsnbError): boolean {
    if (!this.#started) {
      this.fail(error);
      return false;
    }
    this.#warn(error);
    return true;
  }

  /** Tells onError; if onError itself throws, that goes to the feed's report, never back into the subscription. */
  #warn(error: JsnbError): void {
    try {
      this.#hooks.onError(error);
    } catch (thrown) {
      this.#feed.report(thrown); // onError is the last resort: what it throws is reported, not lost
    }
  }

  /** Runs a subscriber callback; if it throws, the subscription ends with SubscriberFailed and this is false. */
  guard(callback: SubscriberCallback, run: () => void): boolean {
    try {
      run();
      return true;
    } catch (thrown) {
      this.fail(new SubscriberFailed({ callback }, { cause: thrown }));
      return false;
    }
  }

  #statusChanged(status: ConnectionStatus): void {
    if (status === "live" && this.#previous === "reconnecting") this.#hooks.resync();
    if (status === "closed") {
      this.fail(this.#feed.closeReason() ?? new ConnectionClosed({ method: "events.subscribe" }));
    }
    this.#previous = status;
  }

  #close(): void {
    this.#open = false;
    for (const stop of this.#stops) stop();
  }
}
