// Push events: `on(name, callback, { latest? })` in a client cell listens to a server cell's
// `emit(name, data)`. The listener belongs to its run: a re-run, a reset, a detach or the cell's deletion disposes it
// with the run's other cleanups. realm.event delivers each event, in order, to every listener of its name in the order
// they were added, yielding to the page between slices so a slow listener never freezes it; a `latest` listener gets
// only the last event of its name in each batch. Each delivery is an `event` output on the listening run, its data
// encoded under the run's value limit, while the run has kept fewer than `maxEventOutputs` of them and
// `maxEventBytes` of their data (the listener still hears the rest); a callback's throw is an `error` output there. An
// event no listener hears is gone: there is no replay.
import type { RealmEvent, RealmEventAnswer } from "@jsnb/core";
import { decode, encode } from "@jsnb/core";

import type { Disposers } from "./disposers.js";
import type { Callable } from "./guard.js";
import { isCallable } from "./guard.js";
import { redact } from "./redact.js";
import type { Streams } from "./streams.js";

/** The run a listener reports on. */
type ListeningRun = {
  readonly disposers: Disposers;
  readonly streams: Streams;
  /** `outputs.maxValueBytes` of the run: an event output's data is cut to it as a value output's is. */
  readonly maxValueBytes: number;
  readonly report: (output: { kind: "event"; name: string; data: unknown; at: string }) => void;
  readonly reportError: (error: unknown) => void;
};

type Listener = {
  readonly name: string;
  readonly callback: Callable;
  readonly latest: boolean;
  readonly run: ListeningRun;
};

export type EventListeners = {
  /** `on` as one run's code calls it. */
  readonly on: (
    run: ListeningRun,
  ) => (name: unknown, callback: unknown, options?: unknown) => () => void;
  readonly deliver: (params: RealmEvent) => Promise<RealmEventAnswer>;
};

/** Event outputs one run keeps, and the bytes of their data; past either the listener still hears each event. */
const maxEventOutputs = 500;
const maxEventBytes = 1024 * 1024;
/** How long a slice of deliveries runs before the page gets its turn. */
const sliceMs = 8;
/** As `emit` takes it. */
const maxNameLength = 200;

const usage = 'on("progress", (data) => …)';

/** `on`'s arguments, or the TypeError that says how to call it. */
function checked(name: unknown, callback: unknown, options: unknown) {
  if (typeof name !== "string" || name.length === 0 || name.length > maxNameLength)
    throw new TypeError(
      `on() takes an event name of 1 to ${String(maxNameLength)} characters, not ${typeof name === "string" ? `a string of ${String(name.length)} characters` : typeof name}: ${usage}.`,
    );
  if (!isCallable(callback))
    throw new TypeError(`on() takes a callback function, not ${typeof callback}: ${usage}.`);
  const latest =
    typeof options === "object" && options !== null && Reflect.get(options, "latest") === true;
  return { name, callback, latest };
}

type Event = RealmEvent["events"][number];
type Kept = { count: number; bytes: number; told: boolean };

/** Keeps the delivery as an `event` output while the run is under its budgets, then says so once. */
function record(kept: WeakMap<ListeningRun, Kept>, run: ListeningRun, event: Event): void {
  const so = kept.get(run) ?? { count: 0, bytes: 0, told: false };
  kept.set(run, so);
  if (so.count < maxEventOutputs && so.bytes < maxEventBytes) {
    so.count += 1;
    const { json } = encode(decode(event.data), { maxBytes: run.maxValueBytes, redact });
    so.bytes += JSON.stringify(json).length;
    run.report({ kind: "event", name: event.name, data: json, at: event.at });
    return;
  }
  if (so.told) return;
  so.told = true;
  run.streams.write(
    "stderr",
    `more than ${String(maxEventOutputs)} events or ${String(maxEventBytes / 1024 / 1024)} MB of event data reached this run: later events reach its listeners but are not kept as outputs\n`,
  );
}

/** Calls one listener with its own copy of the data; a throw or a rejection is an `error` output on its run. */
function call(listener: Listener, event: Event): void {
  try {
    const result: unknown = Reflect.apply(listener.callback, undefined, [decode(event.data)]);
    if (result instanceof Promise) result.catch(listener.run.reportError);
  } catch (error) {
    listener.run.reportError(error);
  }
}

/** The page's turn: a task, so rendering and input run before the next slice. */
const yieldToPage = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export function createEventListeners(): EventListeners {
  const listeners = new Set<Listener>();
  const kept = new WeakMap<ListeningRun, Kept>();
  return {
    on: (run) => (name, callback, options) => {
      const listener = { ...checked(name, callback, options), run };
      if (run.disposers.closed()) return () => undefined;
      listeners.add(listener);
      const undispose = run.disposers.add(() => listeners.delete(listener));
      const dispose = (): void => {
        listeners.delete(listener);
        undispose();
      };
      // named as route()'s disposer is, which the page hides as a cell's last value; a bundler may rename the const
      return Object.defineProperty(dispose, "name", { value: "dispose" });
    },
    deliver: async ({ events }) => {
      const heard = new Map<string, number>();
      const last = new Map<string, number>();
      events.forEach((event, index) => last.set(event.name, index));
      let sliceStart = performance.now();
      for (const [index, event] of events.entries()) {
        if (performance.now() - sliceStart > sliceMs) {
          await yieldToPage();
          sliceStart = performance.now();
        }
        const hearing = [...listeners].filter((listener) => listener.name === event.name);
        if (hearing.length > 0) heard.set(event.name, (heard.get(event.name) ?? 0) + 1);
        for (const listener of hearing) {
          if (listener.latest && last.get(event.name) !== index) continue;
          if (!listeners.has(listener)) continue;
          record(kept, listener.run, event);
          call(listener, event);
        }
      }
      return { heard: [...heard].map(([name, count]) => ({ name, count })) };
    },
  };
}
