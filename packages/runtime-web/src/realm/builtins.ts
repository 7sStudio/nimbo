// A run's builtins layer: console, env, display, dispose, on, the wrapped timers and listeners,
// and the run's views of `window` and `document`. Code reads them through its own run's scope, so attribution is lexical.
import { InvalidDisposer, typeName } from "@jsnb/core";

import type { Display } from "../display/display.js";
import { createConsole } from "./console.js";
import type { Disposers } from "./disposers.js";
import { createGlobalViews } from "./globals.js";
import { isCallable } from "./guard.js";
import type { ListenerRegistry } from "./listeners.js";
import type { Streams } from "./streams.js";
import { createTimers } from "./timers.js";

export type BuiltinParts = {
  readonly env: Readonly<Record<string, unknown>>;
  readonly display: Display;
  readonly disposers: Disposers;
  readonly listeners: ListenerRegistry;
  readonly streams: Streams;
  /** A late failure of a wrapped callback: an `error` output on the run's execution. */
  readonly reportError: (error: unknown) => void;
  /** `on(name, callback)`, listening for the run. */
  readonly on: (name: unknown, callback: unknown, options?: unknown) => () => void;
};

/** `dispose(fn)` registers the cell's own cleanup; a stale run's cleanup runs at once. */
const disposeWith =
  (disposers: Disposers) =>
  (cleanup: unknown): undefined => {
    if (!isCallable(cleanup)) throw new InvalidDisposer({ type: typeName(cleanup) });
    disposers.add(() => Reflect.apply(cleanup, undefined, []));
    return undefined;
  };

/** Every name a run's builtins layer holds (createBuiltins's keys; a browser test keeps the two equal). */
export const builtinNames: readonly string[] = [
  "console",
  "env",
  "display",
  "dispose",
  "on",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "addEventListener",
  "removeEventListener",
  "window",
  "self",
  "globalThis",
  "document",
];

export function createBuiltins(parts: BuiltinParts): Readonly<Record<string, unknown>> {
  const { disposers, reportError } = parts;
  const timers = createTimers(disposers, reportError);
  const onWindow = parts.listeners.on(window, disposers, reportError);
  const onDocument = parts.listeners.on(document, disposers, reportError);
  const views = createGlobalViews({ window: { ...timers, ...onWindow }, document: onDocument });
  return {
    console: createConsole({ write: parts.streams.write, now: () => performance.now() }),
    env: parts.env,
    display: parts.display,
    dispose: disposeWith(disposers),
    on: parts.on,
    ...timers,
    ...onWindow,
    window: views.window,
    self: views.window,
    globalThis: views.window,
    document: views.document,
  };
}
