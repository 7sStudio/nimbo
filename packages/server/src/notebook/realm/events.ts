// Push events (05-bridge §6): the kernel's `emit` flushes go to the attached page as realm.event, one request at a time
// in the order they were emitted, so a page that falls behind holds the queue back; the queue keeps at most
// `maxPending` events (a burst past it drops the oldest). With no page attached an event is dropped. Each name's
// counts (emitted, delivered to a listener, dropped and why) answer bridge.events.
import type { BridgeEvent, CellId } from "@jsnb/core";
import { RealmEventAnswer } from "@jsnb/core";
import type { EventBatch } from "@jsnb/kernel-node";

import type { SessionContext } from "../session/context.js";
import type { RealmState } from "./state.js";

type Drop = "noPage" | "noListener" | "overflow";

export type EventStat = {
  readonly name: string;
  emitted: number;
  delivered: number;
  dropped: number;
  lastDrop: Drop | null;
  lastAt: string;
  cell: CellId | null;
};

export type EventChannel = {
  /** A flush of the kernel's queue. */
  readonly take: (batch: EventBatch) => void;
  readonly stats: () => readonly EventStat[];
};

/** Events the daemon holds for a page that has not answered yet. */
const maxPending = 1000;
/** Events in one realm.event. */
const maxPerRequest = 200;

type Channel = {
  readonly context: SessionContext;
  readonly state: RealmState;
  readonly stats: Map<string, EventStat>;
  readonly pending: BridgeEvent[];
  inFlight: boolean;
};

function statOf(channel: Channel, name: string): EventStat {
  const found = channel.stats.get(name);
  if (found) return found;
  const lastAt = channel.context.now().toISOString();
  const stat = { name, emitted: 0, delivered: 0, dropped: 0, lastDrop: null, lastAt, cell: null };
  channel.stats.set(name, stat);
  return stat;
}

function drop(channel: Channel, name: string, count: number, why: Drop): void {
  if (count <= 0) return;
  const stat = statOf(channel, name);
  stat.dropped += count;
  stat.lastDrop = why;
}

/** The page's answer to a batch: per name, the events a listener heard were delivered, the rest dropped. */
function answered(channel: Channel, events: readonly BridgeEvent[], answer: unknown): void {
  const { heard } = RealmEventAnswer.parse(answer);
  const sent = new Map<string, number>();
  for (const { name } of events) sent.set(name, (sent.get(name) ?? 0) + 1);
  for (const [name, count] of sent) {
    const listened = Math.min(heard[name] ?? 0, count);
    statOf(channel, name).delivered += listened;
    drop(channel, name, count - listened, "noListener");
  }
}

/** Sends the next batch unless one is waiting for the page; with no page attached, the pending events are dropped. */
function pump(channel: Channel): void {
  const { pending, state, context } = channel;
  if (channel.inFlight || pending.length === 0) return;
  const { attachment } = state;
  if (!attachment) {
    for (const event of pending.splice(0)) drop(channel, event.name, 1, "noPage");
    return;
  }
  const events = pending.splice(0, maxPerRequest);
  channel.inFlight = true;
  attachment.page
    .request("realm.event", { events }, attachment.detached.signal)
    .then((answer) => {
      answered(channel, events, answer);
    })
    .catch((error: unknown) => {
      for (const event of events) drop(channel, event.name, 1, "noPage");
      context.log.debug({ err: error }, "the page did not take realm.event");
    })
    .finally(() => {
      channel.inFlight = false;
      pump(channel);
    });
}

/** One event from the kernel: counted, then queued for the page or dropped when none is attached. */
function queue(channel: Channel, event: BridgeEvent): void {
  const stat = statOf(channel, event.name);
  stat.emitted += 1;
  stat.lastAt = event.at;
  stat.cell = event.cell ?? null;
  if (!channel.state.attachment) {
    drop(channel, event.name, 1, "noPage");
    return;
  }
  channel.pending.push(event);
  if (channel.pending.length <= maxPending) return;
  const oldest = channel.pending.shift();
  if (oldest) drop(channel, oldest.name, 1, "overflow");
}

export function createEventChannel(context: SessionContext, state: RealmState): EventChannel {
  const channel: Channel = { context, state, stats: new Map(), pending: [], inFlight: false };
  return {
    take: ({ events, dropped }) => {
      for (const [name, count] of Object.entries(dropped)) {
        statOf(channel, name).emitted += count;
        drop(channel, name, count, "overflow");
      }
      for (const event of events) queue(channel, event);
      pump(channel);
    },
    stats: () => [...channel.stats.values()].map((stat) => ({ ...stat })),
  };
}
