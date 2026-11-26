// The event stream: envelopes with a seq that counts per notebook for the daemon's life (the
// workspace-level stream, notebook "", has its own), validated with core's schemas, each delivered once per subscriber.
import type { EventType, eventData } from "@jsnb/core";
import { EventEnvelope } from "@jsnb/core";
import type { z } from "zod";

/** What `emit` takes as the data of an event type. */
export type EventInput<T extends EventType> = z.input<(typeof eventData)[T]>;

/** A connection that receives events: a socket that called events.subscribe. */
type Subscriber = {
  readonly id: string;
  readonly deliver: (event: EventEnvelope) => void;
};

/** The workspace-level stream's notebook value (settings.changed, packages.*). */
export const workspaceStream = "";

export type EventBus = {
  /** Validates and sends an event; returns the envelope. An invalid one is a daemon bug and throws. */
  readonly emit: <T extends EventType>(
    notebook: string,
    type: T,
    data: EventInput<T>,
  ) => EventEnvelope;
  /** The last seq of a notebook (`""` for the workspace-level stream); 0 before its first event. */
  readonly seqOf: (notebook: string) => number;
  /** Adds a notebook (or, with undefined, the whole workspace) to what a subscriber receives; returns the seq. */
  readonly subscribe: (subscriber: Subscriber, notebook?: string) => number;
  /**
   * A notebook's stream goes on under a new ref (its file moved): each subscriber of `from` also receives `to`,
   * whose seq goes on from the higher of the two, so a follower sees no step back.
   */
  readonly moveStream: (from: string, to: string) => void;
  /** Forgets a subscriber (its socket closed). */
  readonly unsubscribe: (id: string) => void;
  /** Hears every event in the daemon, after its subscribers (the language service's triggers); returns the stop. */
  readonly listen: (listener: (event: EventEnvelope) => void) => () => void;
};

type Subscription = { subscriber: Subscriber; workspace: boolean; notebooks: Set<string> };

const receives = (subscription: Subscription, notebook: string): boolean =>
  subscription.workspace || (notebook !== workspaceStream && subscription.notebooks.has(notebook));

/** The stream of `from` goes on as `to`: its subscribers receive `to` too, its seq never steps back. */
function moveStream(
  state: { readonly seqs: Map<string, number>; readonly subscriptions: Map<string, Subscription> },
  from: string,
  to: string,
): void {
  state.seqs.set(to, Math.max(state.seqs.get(from) ?? 0, state.seqs.get(to) ?? 0));
  for (const subscription of state.subscriptions.values()) {
    if (subscription.notebooks.has(from)) subscription.notebooks.add(to);
  }
}

/** A bus whose envelopes carry `now()` as their `ts`. */
export function createEventBus(now: () => Date): EventBus {
  const seqs = new Map<string, number>();
  const subscriptions = new Map<string, Subscription>();
  const listeners = new Set<(event: EventEnvelope) => void>();
  const seqOf = (notebook: string): number => seqs.get(notebook) ?? 0;
  return {
    emit: (notebook, type, data) => {
      const seq = seqOf(notebook) + 1;
      const envelope = EventEnvelope.parse({ notebook, seq, ts: now().toISOString(), type, data });
      seqs.set(notebook, seq);
      for (const subscription of subscriptions.values()) {
        if (receives(subscription, notebook)) subscription.subscriber.deliver(envelope);
      }
      for (const listener of listeners) listener(envelope);
      return envelope;
    },
    seqOf,
    subscribe: (subscriber, notebook) => {
      const subscription = subscriptions.get(subscriber.id) ?? {
        subscriber,
        workspace: false,
        notebooks: new Set<string>(),
      };
      if (notebook === undefined) subscription.workspace = true;
      else subscription.notebooks.add(notebook);
      subscriptions.set(subscriber.id, subscription);
      return seqOf(notebook ?? workspaceStream);
    },
    moveStream: (from, to) => {
      moveStream({ seqs, subscriptions }, from, to);
    },
    unsubscribe: (id) => {
      subscriptions.delete(id);
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
