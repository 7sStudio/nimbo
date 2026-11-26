// The server `emit(name, data)` built-in: plain data, in strict wire form and redacted, queued and sent to
// the daemon in one `events` message per flush. The queue holds at most `maxQueued` events and `maxQueuedBytes` of
// data: a burst past either keeps the latest and counts the ones it dropped. While no page listens (the daemon says
// so), an event is counted and dropped at once, its data never queued. The counts carry at most `maxNames` names a
// flush; the rest are counted under null, so a loop of distinct names never grows a table.
import type { BridgeEvent, CellId } from "@jsnb/core";
import { encodeStrict, EventNotSerializable } from "@jsnb/core";

/** Events dropped since the last flush, by name (null: names past the flush's budget); the ipc schema's shape. */
type DroppedEvents = {
  readonly name: string | null;
  readonly count: number;
  readonly why: "overflow" | "noPage";
  readonly at: string;
  readonly cell?: CellId;
};

/** The kernel's `events` message. */
export type EventsMessage = {
  readonly type: "events";
  readonly events: readonly BridgeEvent[];
  readonly dropped: readonly DroppedEvents[];
};

export type EmitDeps = {
  /** The cell whose code emits, when one does. */
  readonly currentCell: () => CellId | undefined;
  readonly redact: (text: string) => string;
  /** `bridge.maxBytesPerValue`: an event's data crosses whole up to it, as a call's result does. */
  readonly maxBytes: number;
  readonly send: (message: EventsMessage) => void;
  readonly schedule: (flush: () => void) => void;
  readonly clock: () => string;
  readonly limits?: Partial<QueueLimits>;
};

type QueueLimits = {
  readonly maxQueued: number;
  readonly maxQueuedBytes: number;
  readonly maxNames: number;
};

const defaults: QueueLimits = { maxQueued: 1000, maxQueuedBytes: 16 * 1024 * 1024, maxNames: 1000 };

/** An event name is a label, not a payload; `on` takes the same. */
const maxNameLength = 200;

export type Emit = {
  readonly emit: (name: unknown, data?: unknown) => undefined;
  /** Whether a page holds the client realm. */
  readonly listening: (listening: boolean) => void;
};

function checkedName(name: unknown): string {
  if (typeof name === "string" && name.length > 0 && name.length <= maxNameLength) return name;
  const what =
    typeof name === "string" ? `a string of ${String(name.length)} characters` : typeof name;
  throw new TypeError(
    `emit() takes an event name of 1 to ${String(maxNameLength)} characters, not ${what}: emit("progress", data).`,
  );
}

type Wire = { readonly json: unknown; readonly bytes: number };

/** The event's data in strict wire form, redacted, with its JSON size; EventNotSerializable for anything else. */
function wireData(deps: EmitDeps, name: string, data: unknown): Wire {
  const encoded = encodeStrict(data, { maxBytesPerValue: deps.maxBytes, redact: deps.redact });
  if (!encoded.ok) {
    const { type, bytes } = encoded.error;
    throw new EventNotSerializable(
      bytes === undefined ? { name, type } : { name, type, bytes, limit: deps.maxBytes },
    );
  }
  const bytes = Buffer.byteLength(JSON.stringify(encoded.json));
  if (bytes > deps.maxBytes) {
    const type = Array.isArray(data) ? "array" : typeof data === "object" ? "object" : typeof data;
    throw new EventNotSerializable({ name, type, bytes, limit: deps.maxBytes });
  }
  return { json: encoded.json, bytes };
}

type Tally = { count: number; at: string; cell: CellId | undefined };
type Queued = { readonly event: BridgeEvent; readonly bytes: number };

type Why = DroppedEvents["why"];

const bump = (tally: Tally | undefined, at: string, cell: CellId | undefined): Tally => ({
  count: (tally?.count ?? 0) + 1,
  at,
  cell,
});

const entry = (name: string | null, why: Why, { count, at, cell }: Tally): DroppedEvents =>
  cell === undefined ? { name, count, why, at } : { name, count, why, at, cell };

/** The drops of one flush window, by reason and name: the `maxNames` most recent names a reason, the counts of older
 * ones under null. */
function createTallies(maxNames: number) {
  const named = new Map<Why, Map<string, Tally>>([
    ["overflow", new Map()],
    ["noPage", new Map()],
  ]);
  const other = new Map<Why, Tally>();
  return {
    add: (name: string, why: Why, at: string, cell: CellId | undefined): void => {
      const byName = named.get(why) ?? new Map<string, Tally>();
      const tally = byName.get(name);
      byName.delete(name);
      byName.set(name, bump(tally, at, cell));
      for (const [oldest, folded] of byName) {
        if (byName.size <= maxNames) break;
        byName.delete(oldest);
        const sum = other.get(why);
        other.set(why, { ...folded, count: folded.count + (sum?.count ?? 0) });
      }
    },
    take: (): DroppedEvents[] => {
      const list: DroppedEvents[] = [];
      for (const [why, byName] of named) {
        for (const [name, tally] of byName) list.push(entry(name, why, tally));
        byName.clear();
      }
      for (const [why, tally] of other) list.push(entry(null, why, tally));
      other.clear();
      return list;
    },
  };
}

/** The queue between two flushes: bounded by count and bytes, the oldest dropped into `tallies`. */
function createQueue(limits: QueueLimits, tallies: ReturnType<typeof createTallies>) {
  const queue: Queued[] = [];
  let bytes = 0;
  return {
    push: (queued: Queued): void => {
      queue.push(queued);
      bytes += queued.bytes;
      while (
        queue.length > limits.maxQueued ||
        (bytes > limits.maxQueuedBytes && queue.length > 1)
      ) {
        const oldest = queue.shift();
        if (!oldest) return;
        bytes -= oldest.bytes;
        tallies.add(oldest.event.name, "overflow", oldest.event.at, oldest.event.cell);
      }
    },
    take: (): BridgeEvent[] => {
      bytes = 0;
      return queue.splice(0).map((each) => each.event);
    },
  };
}

/** `emit` as cells call it, and the daemon's word on whether a page listens. */
export function createEmit(deps: EmitDeps): Emit {
  const limits = { ...defaults, ...deps.limits };
  const tallies = createTallies(limits.maxNames);
  const queue = createQueue(limits, tallies);
  let listening = true;
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    deps.send({ type: "events", events: queue.take(), dropped: tallies.take() });
  };
  const emit = (name: unknown, data?: unknown): undefined => {
    const checked = checkedName(name);
    const wire = wireData(deps, checked, data);
    const cell = deps.currentCell();
    const at = deps.clock();
    const redacted = deps.redact(checked);
    if (!listening) tallies.add(redacted, "noPage", at, cell);
    else {
      const event = { name: redacted, data: wire.json, at };
      queue.push({ event: cell === undefined ? event : { ...event, cell }, bytes: wire.bytes });
    }
    if (!scheduled) {
      scheduled = true;
      deps.schedule(flush);
    }
    return undefined;
  };
  return {
    emit,
    listening: (value) => {
      listening = value;
    },
  };
}
