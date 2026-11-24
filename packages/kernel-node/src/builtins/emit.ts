// The server `emit(name, data)` built-in (05-bridge §6): plain data, in strict wire form and redacted, queued and sent to
// the daemon in one `events` message per flush. The queue holds at most `maxQueued` events: a burst past it keeps the
// latest and counts the ones it dropped, by name, so a loop that emits faster than the page reads never grows a buffer.
import type { BridgeEvent, CellId } from "@jsnb/core";
import { encodeStrict, EventNotSerializable } from "@jsnb/core";

/** The kernel's `events` message (04-kernel §2.1). */
export type EventsMessage = {
  readonly type: "events";
  readonly events: readonly BridgeEvent[];
  readonly dropped: Readonly<Record<string, number>>;
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
  readonly maxQueued?: number;
};

/** Events held between two flushes; past it the oldest go. */
const maxQueuedEvents = 1000;
/** An event name is a label, not a payload. */
const maxNameLength = 200;

function checkedName(name: unknown): string {
  if (typeof name === "string" && name.length > 0 && name.length <= maxNameLength) return name;
  const what =
    typeof name === "string" ? `a string of ${String(name.length)} characters` : typeof name;
  throw new TypeError(
    `emit() takes an event name of 1 to ${String(maxNameLength)} characters, not ${what}: emit("progress", data).`,
  );
}

/** The event's data in strict wire form, redacted; EventNotSerializable for anything that is not plain data. */
function wireData(deps: EmitDeps, name: string, data: unknown): unknown {
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
  return encoded.json;
}

/** `emit` as cells call it. */
export function createEmit(deps: EmitDeps): (name: unknown, data?: unknown) => undefined {
  const limit = deps.maxQueued ?? maxQueuedEvents;
  const queue: BridgeEvent[] = [];
  const dropped = new Map<string, number>();
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    const events = queue.splice(0);
    deps.send({ type: "events", events, dropped: Object.fromEntries(dropped) });
    dropped.clear();
  };
  return (name, data) => {
    const checked = checkedName(name);
    const json = wireData(deps, checked, data);
    const cell = deps.currentCell();
    const event = { name: deps.redact(checked), data: json, at: deps.clock() };
    queue.push(cell === undefined ? event : { ...event, cell });
    if (queue.length > limit) {
      const oldest = queue.shift();
      if (oldest) dropped.set(oldest.name, (dropped.get(oldest.name) ?? 0) + 1);
    }
    if (!scheduled) {
      scheduled = true;
      deps.schedule(flush);
    }
    return undefined;
  };
}
