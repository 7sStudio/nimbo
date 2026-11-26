// The realm's window and document listeners: each wrapped for late errors and removed with its run's
// disposers; one registry for the realm, so the DOM's own bookkeeping holds across runs (once, signal, remove).
import type { Disposers } from "./disposers.js";
import type { Callable } from "./guard.js";
import { guard, isCallable } from "./guard.js";

type ListenerMethods = {
  readonly addEventListener: (type: unknown, listener: unknown, options?: unknown) => void;
  readonly removeEventListener: (type: unknown, listener: unknown, options?: unknown) => void;
};

export type ListenerRegistry = {
  /** The two methods on `target` for one run: what it adds is disposed with its disposers. */
  readonly on: (
    target: EventTarget,
    disposers: Disposers,
    onError: (error: unknown) => void,
  ) => ListenerMethods;
};

type Entry = {
  readonly target: EventTarget;
  readonly type: string;
  readonly listener: Listener;
  readonly capture: boolean;
  readonly wrapped: Callable;
  /** Removes the entry from its run's disposers. */
  readonly undispose: () => void;
};

type Run = {
  readonly target: EventTarget;
  readonly disposers: Disposers;
  readonly onError: (error: unknown) => void;
};

const field = (options: unknown, key: string): unknown =>
  typeof options === "object" && options !== null ? Reflect.get(options, key) : undefined;

const captureOf = (options: unknown): boolean =>
  typeof options === "boolean" ? options : Boolean(field(options, "capture"));

const signalOf = (options: unknown): AbortSignal | undefined => {
  const signal = field(options, "signal");
  return signal instanceof AbortSignal ? signal : undefined;
};

type ListenerObject = { readonly handleEvent: (event: unknown) => unknown };
type Listener = Callable | ListenerObject;

/** WebIDL turns any function or object into the EventListener callback; `handleEvent` is looked up when it fires. */
const isListener = (value: unknown): value is Listener =>
  typeof value === "function" || (typeof value === "object" && value !== null);

/** Calls the listener as the DOM would; an object without handleEvent fails with the engine's own TypeError. */
function invoke(listener: Listener, self: unknown, event: unknown): unknown {
  return isCallable(listener)
    ? Reflect.apply(listener, self, [event])
    : listener.handleEvent(event);
}

/** One registry per realm: the DOM's (target, type, listener, capture) identity, whichever run added the listener. */
export function createListenerRegistry(): ListenerRegistry {
  const book: Entry[] = [];

  const find = (
    target: EventTarget,
    type: string,
    listener: Listener,
    options: unknown,
  ): Entry | undefined => {
    const capture = captureOf(options);
    return book.find(
      (e) =>
        e.target === target && e.type === type && e.listener === listener && e.capture === capture,
    );
  };

  /** The entry leaves the registry and its run's disposers; the DOM already let go of it (once, signal) or is told. */
  const release = (entry: Entry): void => {
    const index = book.indexOf(entry);
    if (index < 0) return;
    book.splice(index, 1);
    entry.undispose();
  };

  const drop = (entry: Entry): void => {
    release(entry);
    entry.target.removeEventListener(entry.type, entry.wrapped, { capture: entry.capture });
  };

  const register = (run: Run, type: string, listener: Listener, options: unknown): void => {
    const once = Boolean(field(options, "once"));
    const fire = function (this: unknown, event: unknown): unknown {
      if (once) release(entry); // the DOM removes a once listener before it calls it
      return invoke(listener, this, event);
    };
    const capture = captureOf(options);
    const wrapped = guard(fire, run.onError);
    // The run's list is open (addEventListener checked), so this cleanup runs later, once `entry` exists.
    const undispose = run.disposers.add(() => {
      drop(entry);
    });
    const entry: Entry = { target: run.target, type, listener, capture, wrapped, undispose };
    book.push(entry);
    Reflect.apply(run.target.addEventListener.bind(run.target), undefined, [
      type,
      wrapped,
      options,
    ]);
    const onAbort = (): void => {
      release(entry);
    };
    signalOf(options)?.addEventListener("abort", onAbort, { once: true });
  };

  /**
   * A stale run adds nothing (its disposers already ran) and an aborted signal adds nothing, as in the DOM; removal by
   * type, listener and capture works from any run, since the registry is the realm's.
   */
  const methods = (run: Run): ListenerMethods => {
    const addEventListener = (type: unknown, listener: unknown, options?: unknown): void => {
      if (!isListener(listener) || run.disposers.closed() || signalOf(options)?.aborted === true)
        return;
      const name = String(type);
      if (find(run.target, name, listener, options) === undefined)
        register(run, name, listener, options);
    };
    const removeEventListener = (type: unknown, listener: unknown, options?: unknown): void => {
      const entry = isListener(listener)
        ? find(run.target, String(type), listener, options)
        : undefined;
      if (entry) drop(entry);
      else
        Reflect.apply(run.target.removeEventListener.bind(run.target), undefined, [
          type,
          listener,
          options,
        ]);
    };
    return { addEventListener, removeEventListener };
  };

  return { on: (target, disposers, onError) => methods({ target, disposers, onError }) };
}
