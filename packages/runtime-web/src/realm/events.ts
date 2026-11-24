// Push events (05-bridge §6): `on(name, callback)` in a client cell listens to a server cell's `emit(name, data)`. The
// listener belongs to its run: a re-run, a reset, a detach or the cell's deletion disposes it with the run's other
// cleanups. realm.event delivers each event, in order, to every listener of its name in the order they were added;
// each delivery is an `event` output on the listening run, up to `maxEventOutputs` per run (the listener still hears
// the rest), and a callback's throw is an `error` output there. An event no listener hears is gone: there is no replay.
import type { RealmEvent, RealmEventAnswer } from "@jsnb/core";
import { decode } from "@jsnb/core";

import type { Disposers } from "./disposers.js";
import type { Streams } from "./streams.js";
import type { Callable } from "./guard.js";
import { isCallable } from "./guard.js";

/** The run a listener reports on. */
type ListeningRun = {
  readonly disposers: Disposers;
  readonly streams: Streams;
  readonly report: (output: { kind: "event"; name: string; data: unknown; at: string }) => void;
  readonly reportError: (error: unknown) => void;
};

type Listener = { readonly name: string; readonly callback: Callable; readonly run: ListeningRun };

export type EventListeners = {
  /** `on` as one run's code calls it. */
  readonly on: (run: ListeningRun) => (name: unknown, callback: unknown) => () => void;
  readonly deliver: (params: RealmEvent) => RealmEventAnswer;
};

/** Event outputs one run keeps; past it the listener still hears each event. */
const maxEventOutputs = 500;

/** `on`'s arguments, or the TypeError that says how to call it. */
function checked(name: unknown, callback: unknown): { name: string; callback: Callable } {
  const usage = 'on("progress", (data) => …)';
  if (typeof name !== "string" || name === "")
    throw new TypeError(`on() takes an event name, not ${typeof name}: ${usage}.`);
  if (!isCallable(callback))
    throw new TypeError(`on() takes a callback function, not ${typeof callback}: ${usage}.`);
  return { name, callback };
}

type Event = RealmEvent["events"][number];

/** Keeps the delivery as an `event` output while the run has fewer than `maxEventOutputs`, then says so once. */
function record(outputs: WeakMap<ListeningRun, number>, run: ListeningRun, event: Event): void {
  const count = (outputs.get(run) ?? 0) + 1;
  outputs.set(run, count);
  if (count <= maxEventOutputs) {
    run.report({ kind: "event", name: event.name, data: event.data, at: event.at });
    return;
  }
  if (count === maxEventOutputs + 1)
    run.streams.write(
      "stderr",
      `more than ${String(maxEventOutputs)} events reached this run: later ones reach its listeners but are not kept as outputs\n`,
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

export function createEventListeners(): EventListeners {
  const listeners = new Set<Listener>();
  const outputs = new WeakMap<ListeningRun, number>();
  return {
    on: (run) => (name, callback) => {
      const listener = { ...checked(name, callback), run };
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
    deliver: ({ events }) => {
      const heard: Record<string, number> = {};
      for (const event of events) {
        const hearing = [...listeners].filter((listener) => listener.name === event.name);
        heard[event.name] = (heard[event.name] ?? 0) + (hearing.length > 0 ? 1 : 0);
        for (const listener of hearing) {
          record(outputs, listener.run, event);
          call(listener, event);
        }
      }
      return { heard };
    },
  };
}
