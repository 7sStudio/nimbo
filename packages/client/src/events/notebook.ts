// A notebook subscription: events.subscribe, notebook.get, then every event above
// the returned seq in order; a gap, a malformed event or a reconnect runs the same hydrate again.
import type { ApiIssue, EventEnvelope, JsnbError, NotebookState } from "@jsnb/core";
import { eventsSubscribe, isJsnbError, notebookGet } from "@jsnb/core";

import type { Caller } from "../call/caller.js";
import { ConnectionDropped, InvalidResponse } from "../errors/transport.js";
import type { RawEvent } from "./envelope.js";
import { readEvent, readHead } from "./envelope.js";
import type { EventFeed, Subscription } from "./lifecycle.js";
import { Shell } from "./lifecycle.js";
import type { Ordering, Step } from "./order.js";
import { buffering, receive, start } from "./order.js";

export type NotebookSubscriptionOptions = {
  readonly notebook: string;
  /** The full state and the seq it stands at: first, then after every resync; replace the mirror with it. */
  readonly onState: (state: NotebookState, seq: number) => void;
  /** Every event above that seq, in order, each once. */
  readonly onEvent: (event: EventEnvelope) => void;
  /**
   * After the start: a malformed event (a resync follows), or the failure that closed the subscription. Before the
   * start, any failure, a malformed event included, rejects the start instead.
   */
  readonly onError: (error: JsnbError) => void;
};

type Fetched =
  | { readonly ok: true; readonly seq: number; readonly state: NotebookState }
  | { readonly ok: false; readonly error: JsnbError };

async function fetchState(call: Caller, notebook: string, signal: AbortSignal): Promise<Fetched> {
  try {
    const { seq } = await call(eventsSubscribe, { notebook }, { signal });
    const { notebook: state } = await call(notebookGet, { notebook }, { signal });
    return { ok: true, seq, state };
  } catch (error) {
    if (!isJsnbError(error)) throw error;
    return { ok: false, error }; // a failed call: the subscription decides whether it ends there
  }
}

/** The state of one notebook subscription across hydrates. */
class NotebookSync {
  readonly #feed: EventFeed;
  readonly #options: NotebookSubscriptionOptions;
  readonly #shell: Shell;
  #ordering: Ordering<RawEvent> = buffering();
  #generation = 0;
  #hydrating: AbortController | undefined;

  constructor(feed: EventFeed, options: NotebookSubscriptionOptions) {
    this.#feed = feed;
    this.#options = options;
    this.#shell = new Shell(feed, {
      receive: (params) => {
        this.#receive(params);
      },
      resync: () => {
        this.#resync();
      },
      onError: options.onError,
    });
    this.#resync();
  }

  get start(): Promise<Subscription> {
    return this.#shell.start;
  }

  #receive(params: unknown): void {
    const head = readHead(params);
    if (!head.ok) this.#lost(head.issues);
    else if (head.value.notebook === this.#options.notebook) {
      this.#deliver(receive(this.#ordering, head.value));
    }
  }

  #deliver(step: Step<RawEvent>): void {
    this.#ordering = step.ordering;
    for (const event of step.deliver) {
      if (!this.#shell.isOpen()) return;
      const delivery = readEvent(event);
      if (delivery.kind === "malformed") {
        this.#lost(delivery.issues);
        return;
      }
      if (delivery.kind !== "event") continue;
      const delivered = this.#shell.guard("onEvent", () => {
        this.#options.onEvent(delivery.event);
      });
      if (!delivered) return;
    }
    if (step.gap) this.#resync();
  }

  /** A malformed event counts as lost: once started the state is fetched again; before, the start fails. */
  #lost(issues: readonly ApiIssue[]): void {
    if (this.#shell.recover(new InvalidResponse({ method: "event", issues }))) this.#resync();
  }

  #resync(): void {
    // #hydrate ends the subscription on a failed call; anything else it throws is a bug, reported, not dropped.
    void this.#hydrate().catch(this.#feed.report);
  }

  async #hydrate(): Promise<void> {
    this.#generation += 1;
    const mine = this.#generation;
    this.#ordering = buffering();
    // The calls of an older hydrate are withdrawn, so a reconnect does not send them a second time.
    this.#hydrating?.abort();
    this.#hydrating = new AbortController();
    const fetched = await fetchState(
      this.#feed.call,
      this.#options.notebook,
      this.#hydrating.signal,
    );
    // A newer hydrate, or a close, owns the state now; a drop is followed by the reconnect's own hydrate.
    if (mine !== this.#generation || !this.#shell.isOpen()) return;
    if (!fetched.ok) {
      if (!(fetched.error instanceof ConnectionDropped)) this.#shell.fail(fetched.error);
      return;
    }
    const applied = this.#shell.guard("onState", () => {
      this.#options.onState(fetched.state, fetched.seq);
    });
    if (!applied) return;
    this.#shell.started();
    this.#deliver(start(this.#ordering, fetched.seq));
  }
}

/** Starts a notebook subscription; resolves once the first state is delivered, rejects if that hydrate fails. */
export function subscribeNotebook(
  feed: EventFeed,
  options: NotebookSubscriptionOptions,
): Promise<Subscription> {
  return new NotebookSync(feed, options).start;
}
