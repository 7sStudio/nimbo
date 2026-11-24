// One run of a client cell (04-kernel §4, 05-bridge §3.2): its scope view, bridge layer, builtins, streams, disposers.
// A run whose cell re-ran or whose realm reset is stale: its outputs are dropped, its timers were already disposed.
import type { ErrorInfo, Output, SnapshotBinding } from "@jsnb/core";

import type { BridgeLayer } from "../bridge/layer.js";
import { createLayer, install } from "../bridge/layer.js";
import type { RealmTransport } from "../bridge/transport.js";
import type { Containers } from "../display/containers.js";
import { createDisplay } from "../display/display.js";
import { createBuiltins } from "./builtins.js";
import type { Disposers } from "./disposers.js";
import { createDisposers } from "./disposers.js";
import type { EventListeners } from "./events.js";
import type { ListenerRegistry } from "./listeners.js";
import type { PauseClock } from "../bridge/stub.js";
import type { RealmLimits } from "./options.js";
import type { Reports } from "./reports.js";
import type { Streams } from "./streams.js";
import { createStreams } from "./streams.js";
import { createView } from "./view.js";

/** What every run of a realm shares; each run has its own limits (realm.execute carries them, 03-api §4.10). */
export type RunContext = {
  readonly notebook: string;
  readonly transport: RealmTransport;
  readonly record: Record<string, unknown>;
  readonly env: Readonly<Record<string, unknown>>;
  readonly containers: Containers;
  /** The realm's one listener registry (04-kernel §7). */
  readonly listeners: ListenerRegistry;
  /** The realm's `on` listeners (05-bridge §6). */
  readonly events: EventListeners;
  readonly reports: Reports;
  readonly importModule: (specifier: string) => Promise<unknown>;
  readonly errorInfo: (error: unknown) => ErrorInfo;
  /** The time the server kernel spends paused in the debugger, which a stub's timeout does not count. */
  readonly pauses: PauseClock;
};

type RunFlags = {
  /** Until the cell's promise settles; `defines` collects names only meanwhile. */
  inProgress: boolean;
  stale: boolean;
  /** A `display.*` call of this run touched the container: the run reports a `dom` output. */
  usedContainer: boolean;
  /** `performance.now()` when the cell function was called. */
  startedAt: number;
};

export type Run = {
  readonly cell: string;
  readonly execution: string;
  /** The settings this run applies: its stubs' timeout and byte limit, its value and stream budgets. */
  readonly limits: RealmLimits;
  readonly view: Record<string, unknown>;
  readonly bridge: BridgeLayer;
  readonly defines: Set<string>;
  readonly disposers: Disposers;
  readonly streams: Streams;
  readonly flags: RunFlags;
  /** An output of this run's execution, reported while the run is current (late outputs too), dropped once stale. */
  readonly report: (output: Output) => void;
  readonly reportError: (error: unknown) => void;
  readonly install: (bindings: Readonly<Record<string, SnapshotBinding>>) => void;
  /** Resolves when a reset or a re-run abandons the run, so realm.execute answers without waiting for it. */
  readonly abandoned: Promise<undefined>;
  readonly abandon: () => void;
};

type Reporting = Pick<Run, "report" | "reportError" | "streams">;

function reporting(
  context: RunContext,
  execution: string,
  flags: RunFlags,
  limits: RealmLimits,
): Reporting {
  const report = (output: Output): void => {
    if (!flags.stale) void context.reports.output(execution, output); // ordered by the queue; failures reach onError
  };
  const reportError = (error: unknown): void => {
    if (!flags.stale) report({ kind: "error", error: context.errorInfo(error) });
  };
  return { report, reportError, streams: createStreams(limits.maxStreamBytes, report) };
}

/** Stubs report `redacted a secret in the result of fn` on this run's stderr (04-kernel §10). */
function installer(
  context: RunContext,
  run: Pick<Run, "bridge" | "streams" | "limits">,
): Run["install"] {
  const { bridge, streams, limits } = run;
  const stubs = {
    ...context,
    ...limits,
    onRedacted: (fn: string) => {
      streams.write("stderr", `redacted a secret in the result of ${fn}\n`);
    },
  };
  return (bindings) => {
    install(bridge, bindings, stubs);
  };
}

/**
 * The cell's live container, marked used by the run; a stale run gets a detached one of its own instead, so it never
 * creates, mounts or writes the live container (a run that resumes after its cell ran again, or after a reset).
 */
function containerOf(context: RunContext, cell: string, flags: RunFlags): () => HTMLElement {
  let detached: HTMLElement | undefined;
  return () => {
    if (flags.stale) return (detached ??= document.createElement("div"));
    flags.usedContainer = true;
    return context.containers.ensure(cell);
  };
}

export function createRun(
  context: RunContext,
  run: { readonly cell: string; readonly execution: string; readonly limits: RealmLimits },
): Run {
  const { cell, execution, limits } = run;
  const flags: RunFlags = { inProgress: true, stale: false, usedContainer: false, startedAt: 0 };
  const { report, reportError, streams } = reporting(context, execution, flags, limits);
  const disposers = createDisposers();
  const bridge = createLayer();
  const defines = new Set<string>();
  const display = createDisplay(containerOf(context, cell, flags));
  const { env, listeners } = context;
  const on = context.events.on({ disposers, streams, report, reportError });
  const builtins = createBuiltins({ env, display, disposers, listeners, streams, reportError, on });
  const onDefine = (name: string): void => {
    if (flags.inProgress) defines.add(name);
  };
  const view = createView({ ...context, bridge: bridge.values, builtins, onDefine });
  const { promise: abandoned, resolve } = Promise.withResolvers<undefined>();
  return {
    ...{ cell, execution, limits, view, bridge, defines, disposers, streams, flags },
    ...{
      report,
      reportError,
      abandoned,
      abandon: () => {
        resolve(undefined);
      },
    },
    install: installer(context, { bridge, streams, limits }),
  };
}
