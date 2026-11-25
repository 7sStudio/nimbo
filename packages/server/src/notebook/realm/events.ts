// Push events (05-bridge §6): the kernel's `emit` flushes go to the attached page as realm.event, one request at a time
// in the order they were emitted, so a page that falls behind holds the queue back. The queue keeps at most
// `maxPending` events and `maxPendingBytes` of data (a burst past either drops the oldest), and a request carries at
// most `maxPerRequest` events and `maxRequestBytes`. With no page attached an event is dropped (the kernel drops
// them itself once it is told). Each name's counts answer bridge.events: the `maxNames` most recently emitted names,
// older ones folded into one `other` row, so a loop of distinct names never grows the table.
import type { BridgeEvent, CellId } from "@jsnb/core";
import { RealmEventAnswer } from "@jsnb/core";
import type { EventBatch } from "@jsnb/kernel-node";

import type { SessionContext } from "../session/context.js";
import type { RealmState } from "./state.js";

type Drop = "noPage" | "noListener" | "overflow";

type EventStat = {
  readonly name: string;
  emitted: number;
  delivered: number;
  dropped: number;
  lastDrop: Drop | null;
  lastAt: string;
  cell: CellId | null;
};

type OtherNames = {
  folded: number;
  unnamed: number;
  emitted: number;
  delivered: number;
  dropped: number;
};

type EventStats = {
  readonly attached: boolean;
  readonly total: number;
  readonly events: readonly EventStat[];
  readonly other: OtherNames | null;
};

export type EventChannel = {
  /** A flush of the kernel's queue. */
  readonly take: (batch: EventBatch) => void;
  /** The names that start with `prefix`, the most recent first, at most `limit`. */
  readonly stats: (query: {
    readonly prefix?: string | undefined;
    readonly limit: number;
  }) => EventStats;
};

const limits = {
  maxPending: 1000,
  maxPendingBytes: 16 * 1024 * 1024,
  maxPerRequest: 200,
  maxRequestBytes: 4 * 1024 * 1024,
  maxNames: 500,
};

type Pending = { readonly event: BridgeEvent; readonly bytes: number };

type Channel = {
  readonly context: SessionContext;
  readonly state: RealmState;
  /** Least recently emitted first. */
  readonly stats: Map<string, EventStat>;
  other: OtherNames | null;
  readonly pending: Pending[];
  pendingBytes: number;
  inFlight: boolean;
  /** The bridge.activity event waiting to go out, at most one a second. */
  signal: ReturnType<typeof setTimeout> | undefined;
};

/** Tells subscribers the counts moved, a second after the first change since the last time it did. */
function signal(channel: Channel): void {
  if (channel.signal !== undefined) return;
  channel.signal = setTimeout(() => {
    channel.signal = undefined;
    channel.context.emit("bridge.activity", { at: channel.context.now().toISOString() });
  }, 1000);
  channel.signal.unref();
}

const otherOf = (channel: Channel): OtherNames =>
  (channel.other ??= { folded: 0, unnamed: 0, emitted: 0, delivered: 0, dropped: 0 });

/** `name`'s row, made the most recent; the least recent goes to `other` past `maxNames`. */
function emitted(channel: Channel, name: string, at: string): EventStat {
  const found = channel.stats.get(name);
  if (found) channel.stats.delete(name);
  const stat = found ?? {
    name,
    emitted: 0,
    delivered: 0,
    dropped: 0,
    lastDrop: null,
    lastAt: at,
    cell: null,
  };
  channel.stats.set(name, stat);
  for (const [oldest, row] of channel.stats) {
    if (channel.stats.size <= limits.maxNames) break;
    channel.stats.delete(oldest);
    const other = otherOf(channel);
    other.folded += 1;
    other.emitted += row.emitted;
    other.delivered += row.delivered;
    other.dropped += row.dropped;
  }
  return stat;
}

/** Counts on `name` as they come: on its row while it is tracked, else on `other`. */
function count(
  channel: Channel,
  name: string,
  { delivered = 0, dropped = 0, why }: { delivered?: number; dropped?: number; why: Drop },
): void {
  const stat = channel.stats.get(name);
  const row = stat ?? otherOf(channel);
  row.delivered += delivered;
  row.dropped += dropped;
  if (stat && dropped > 0) stat.lastDrop = why;
}

/** The page's answer to a batch: per name, the events a listener heard were delivered, the rest dropped. */
function answered(channel: Channel, events: readonly BridgeEvent[], answer: unknown): void {
  const heard = new Map(
    RealmEventAnswer.parse(answer).heard.map((each) => [each.name, each.count]),
  );
  const sent = new Map<string, number>();
  for (const { name } of events) sent.set(name, (sent.get(name) ?? 0) + 1);
  for (const [name, total] of sent) {
    const listened = Math.min(heard.get(name) ?? 0, total);
    count(channel, name, { delivered: listened, dropped: total - listened, why: "noListener" });
  }
}

/** The next request's events: at most `maxPerRequest` and `maxRequestBytes`, at least one. */
function nextBatch(channel: Channel): BridgeEvent[] {
  const batch: BridgeEvent[] = [];
  let bytes = 0;
  while (channel.pending.length > 0 && batch.length < limits.maxPerRequest) {
    const next = channel.pending[0];
    if (!next || (batch.length > 0 && bytes + next.bytes > limits.maxRequestBytes)) break;
    channel.pending.shift();
    channel.pendingBytes -= next.bytes;
    bytes += next.bytes;
    batch.push(next.event);
  }
  return batch;
}

/** Sends the next batch unless one is waiting for the page; with no page attached, the pending events are dropped. */
function pump(channel: Channel): void {
  const { pending, state, context } = channel;
  if (channel.inFlight || pending.length === 0) return;
  const { attachment } = state;
  if (!attachment) {
    for (const { event } of pending.splice(0))
      count(channel, event.name, { dropped: 1, why: "noPage" });
    channel.pendingBytes = 0;
    return;
  }
  const events = nextBatch(channel);
  channel.inFlight = true;
  attachment.page
    .request("realm.event", { events }, attachment.detached.signal)
    .then((answer) => {
      answered(channel, events, answer);
      signal(channel);
    })
    .catch((error: unknown) => {
      for (const event of events) count(channel, event.name, { dropped: 1, why: "noPage" });
      context.log.debug({ err: error }, "the page did not take realm.event");
    })
    .finally(() => {
      channel.inFlight = false;
      pump(channel);
    });
}

/** One event from the kernel: counted, then queued for the page or dropped when none is attached. */
function queue(channel: Channel, event: BridgeEvent): void {
  const stat = emitted(channel, event.name, event.at);
  stat.emitted += 1;
  stat.lastAt = event.at;
  stat.cell = event.cell ?? null;
  if (!channel.state.attachment) {
    count(channel, event.name, { dropped: 1, why: "noPage" });
    return;
  }
  const bytes = JSON.stringify(event.data).length;
  channel.pending.push({ event, bytes });
  channel.pendingBytes += bytes;
  while (
    channel.pending.length > limits.maxPending ||
    (channel.pendingBytes > limits.maxPendingBytes && channel.pending.length > 1)
  ) {
    const oldest = channel.pending.shift();
    if (!oldest) break;
    channel.pendingBytes -= oldest.bytes;
    count(channel, oldest.event.name, { dropped: 1, why: "overflow" });
  }
}

/** What the kernel dropped itself: past its queue, with no page listening, or names past its budget (null). */
function takeDropped(channel: Channel, dropped: EventBatch["dropped"]): void {
  for (const { name, count: n, why, at, cell } of dropped) {
    if (name === null) {
      const other = otherOf(channel);
      other.emitted += n;
      other.dropped += n;
      other.unnamed += n;
      continue;
    }
    const stat = emitted(channel, name, at);
    stat.emitted += n;
    stat.lastAt = at;
    stat.cell = cell ?? null;
    count(channel, name, { dropped: n, why });
  }
}

function statsOf(channel: Channel, query: Parameters<EventChannel["stats"]>[0]): EventStats {
  const rows = [...channel.stats.values()]
    .reverse()
    .filter((row) => query.prefix === undefined || row.name.startsWith(query.prefix));
  return {
    attached: channel.state.attachment !== undefined,
    total: rows.length,
    events: rows.slice(0, query.limit).map((row) => ({ ...row })),
    other: channel.other === null ? null : { ...channel.other },
  };
}

export function createEventChannel(context: SessionContext, state: RealmState): EventChannel {
  const channel: Channel = {
    ...{ context, state, stats: new Map(), other: null },
    ...{ pending: [], pendingBytes: 0, inFlight: false, signal: undefined },
  };
  return {
    take: ({ events, dropped }) => {
      takeDropped(channel, dropped);
      for (const event of events) queue(channel, event);
      pump(channel);
      signal(channel);
    },
    stats: (query) => statsOf(channel, query),
  };
}
