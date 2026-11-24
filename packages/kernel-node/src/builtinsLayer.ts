// The built-ins layer of 04-kernel §3.3 and §8, between the record and the globals: console, env, display, route,
// routeUrl, emit, dispose, require and the wrapped setTimeout, setInterval, setImmediate and queueMicrotask, each wired
// to the current store.
import type { Output } from "@jsnb/core";

import { createDisplay } from "./builtins/display.js";
import type { Disposers } from "./builtins/disposers.js";
import { createDispose } from "./builtins/disposers.js";
import type { EventsMessage } from "./builtins/emit.js";
import { createEmit } from "./builtins/emit.js";
import { createWorkspaceRequire } from "./builtins/imports.js";
import type { RouteTable } from "./builtins/routes.js";
import { createTimers } from "./builtins/timers.js";
import type { Environment } from "./environment.js";
import type { Sink, StreamName } from "./outputs/sink.js";
import { createConsole } from "./outputs/streams.js";
import type { Store, Stores } from "./store.js";

type BuiltinsDeps = {
  readonly workspace: string;
  readonly stores: Stores;
  readonly sink: Sink;
  readonly environment: Environment;
  readonly routes: RouteTable;
  readonly disposers: Disposers;
  /** Writes to the daemon's kernel log: text with no store to own it. */
  readonly log: (stream: StreamName, text: string) => void;
  /** An error raised after its cell's run (a timer): an error output, or a notice without a store. */
  readonly reportError: (store: Store | undefined, error: unknown) => void;
  /** After a timer or queueMicrotask callback returned: the process-hook check of 04-kernel §3.3. */
  readonly afterCallback: (store: Store | undefined) => void;
  /** A value's wire form under the output limits, redacted (display.json). */
  readonly encode: (value: unknown) => unknown;
  /** `emit`'s queue and its flush to the daemon (05-bridge §6). */
  readonly events: {
    readonly send: (message: EventsMessage) => void;
    readonly schedule: (flush: () => void) => void;
    readonly clock: () => string;
    readonly maxBytes: number;
  };
};

export type Builtins = {
  /** The layer's names and values. */
  readonly layer: Readonly<Record<string, unknown>>;
  /** Takes text written to stdout or stderr when a store is current (the sink's), else returns false. */
  readonly write: (stream: StreamName, text: string) => boolean;
};

/** The wrapped timers and queueMicrotask over the realm's own (04-kernel §7), wired to the current store. */
function wrappedTimers(deps: BuiltinsDeps) {
  const real = { setTimeout, setInterval, clear: clearTimeout, setImmediate, clearImmediate };
  return createTimers({
    currentStore: deps.stores.current,
    runIn: deps.stores.run,
    addDisposer: deps.disposers.add,
    onError: deps.reportError,
    afterCall: deps.afterCallback,
    real: { ...real, queueMicrotask },
  });
}

/** The built-ins of the server realm. */
export function createBuiltins(deps: BuiltinsDeps): Builtins {
  const { stores, sink } = deps;
  const write = (stream: StreamName, text: string): boolean => {
    const store = stores.current();
    if (store) sink.write(store, stream, text);
    return store !== undefined;
  };
  const emitHere = (output: Output): void => {
    const store = stores.current();
    if (store) sink.emit(store, output);
  };
  const timers = wrappedTimers(deps);
  const layer = {
    console: createConsole((stream, text) => {
      if (!write(stream, text)) deps.log(stream, text);
    }),
    env: deps.environment.env,
    display: createDisplay({
      emit: emitHere,
      encode: deps.encode,
      redact: deps.environment.redact,
    }),
    route: deps.routes.route,
    routeUrl: deps.routes.routeUrl,
    emit: createEmit({
      ...deps.events,
      currentCell: () => stores.current()?.cell,
      redact: deps.environment.redact,
    }),
    dispose: createDispose(() => stores.current()?.cell, deps.disposers),
    require: createWorkspaceRequire(deps.workspace),
    ...timers,
  };
  return { layer, write };
}
