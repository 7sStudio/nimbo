// A workspace subscription (events.subscribe without `notebook`): every event of every notebook as it arrives,
// duplicates dropped per notebook, a gap reported to onGap with delivery going on; a reconnect subscribes again.
import type { ApiIssue, EventEnvelope, JsnbError } from "@jsnb/core";
import { eventsSubscribe, isJsnbError } from "@jsnb/core";

import { ConnectionDropped, InvalidResponse } from "../errors/transport.js";
import { readEvent, readHead } from "./envelope.js";
import type { EventFeed, Subscription } from "./lifecycle.js";
import { Shell } from "./lifecycle.js";
import type { SeqByNotebook, SeqGap } from "./workspaceOrder.js";
import { track } from "./workspaceOrder.js";

export type WorkspaceSubscriptionOptions = {
  /** Every event of every notebook, in arrival order, each once. */
  readonly onEvent: (event: EventEnvelope) => void;
  /** A notebook's events went missing (a drop, a reconnect); the next one is still delivered. */
  readonly onGap: (gap: SeqGap) => void;
  /**
   * After the start: a malformed event (dropped), or the failure that closed the subscription. Before the start, any
   * failure, a malformed event included, rejects the start instead.
   */
  readonly onError: (error: JsnbError) => void;
};

/** The state of one workspace subscription. */
class WorkspaceSync {
  readonly #feed: EventFeed;
  readonly #options: WorkspaceSubscriptionOptions;
  readonly #shell: Shell;
  #seen: SeqByNotebook = new Map();

  constructor(feed: EventFeed, options: WorkspaceSubscriptionOptions) {
    this.#feed = feed;
    this.#options = options;
    this.#shell = new Shell(feed, {
      receive: (params) => {
        this.#receive(params);
      },
      resync: () => {
        this.#resubscribe();
      },
      onError: options.onError,
    });
    this.#resubscribe();
  }

  get start(): Promise<Subscription> {
    return this.#shell.start;
  }

  #receive(params: unknown): void {
    const head = readHead(params);
    if (!head.ok) {
      this.#malformed(head.issues);
      return;
    }
    const tracked = track(this.#seen, head.value);
    this.#seen = tracked.seen;
    if (!tracked.deliver) return;
    const gap = tracked.gap;
    const told =
      gap === undefined ||
      this.#shell.guard("onGap", () => {
        this.#options.onGap(gap);
      });
    if (!told) return;
    const delivery = readEvent(head.value);
    if (delivery.kind === "malformed") this.#malformed(delivery.issues);
    if (delivery.kind !== "event") return;
    this.#shell.guard("onEvent", () => {
      this.#options.onEvent(delivery.event);
    });
  }

  #malformed(issues: readonly ApiIssue[]): void {
    this.#shell.recover(new InvalidResponse({ method: "event", issues })); // dropped once started; fails a start
  }

  #resubscribe(): void {
    // #subscribe ends the subscription on a failed call; anything else it throws is a bug, reported, not dropped.
    void this.#subscribe().catch(this.#feed.report);
  }

  async #subscribe(): Promise<void> {
    try {
      await this.#feed.call(eventsSubscribe, {});
      this.#shell.started();
    } catch (error) {
      if (!isJsnbError(error)) throw error;
      // A drop is followed by the reconnect's own subscribe; any other failure ends the subscription.
      if (!(error instanceof ConnectionDropped)) this.#shell.fail(error);
    }
  }
}

/** Starts a workspace subscription; resolves once events.subscribe answered, rejects if it fails. */
export function subscribeWorkspace(
  feed: EventFeed,
  options: WorkspaceSubscriptionOptions,
): Promise<Subscription> {
  return new WorkspaceSync(feed, options).start;
}
