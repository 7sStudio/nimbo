// The kernel runtime (04-kernel §2, §4, §6): daemon messages validated into an inbox that drains one message per
// event-loop turn, each dispatched to its flow in its own promise job; an interrupt that terminates a cell then clears
// only that microtask queue and no other message is lost. A `cancel` is recorded as it arrives, never queued, so the
// inbox drops a request the daemon abandoned before the kernel started it. Late errors are attributed by
// AsyncLocalStorage (§5.3).
import type { CellId } from "@jsnb/core";

import { bindingsFlow } from "./bindingsQuery.js";
import { onOwnRejection, startUserCode } from "./builtins/userCode.js";
import { callFlow } from "./call.js";
import { disposeFlow } from "./disposeCell.js";
import { parseDaemonMessage } from "./ipc/channel.js";
import type { DaemonMessage } from "./ipc/messages.js";
import { notice } from "./ipc/notice.js";
import type { StreamName } from "./outputs/sink.js";
import type { Realm, RealmDeps } from "./realm.js";
import { createRealm } from "./realm.js";
import type { Recent } from "./recent.js";
import { createRecent } from "./recent.js";
import { runCell } from "./run.js";
import { routeFlow } from "./serveRoute.js";
import { snapshotFlow } from "./snapshot.js";
import type { Store } from "./store.js";

type RuntimeDeps = RealmDeps & {
  /** Ends the process with `code` once every message sent has left it: 0 on `shutdown`, 1 when one cannot be read. */
  readonly end: (code: number) => void;
  /** Schedules the next inbox turn: setImmediate in production. */
  readonly defer: (turn: () => void) => void;
};

export type Runtime = {
  /** A message from the daemon, as `process.on("message")` hands it over. */
  readonly receive: (raw: unknown) => void;
  /** An uncaught exception or unhandled rejection: an error output on its store's cell, else a log notice. */
  readonly lateError: (error: unknown) => void;
  /** Takes stdout or stderr text written under a store for the sink; false when no store is current (the log's). */
  readonly write: (stream: StreamName, text: string) => boolean;
  /** The interval's process-hook check (04-kernel §3.3), blaming the cell whose code ran last. */
  readonly checkHooks: () => void;
  /** The interrupt hook's: the same, and the replacements kept earlier probed again. */
  readonly recheckHooks: () => void;
  /** The store of the code running now (its execution, and the run or request it belongs to); undefined outside any. */
  readonly runningStore: () => Store | undefined;
  /** The cell compiled under `url`, a cell frame's script name (04-kernel §4 step 3). */
  readonly cellOf: (url: string) => CellId | undefined;
  /** The kernel log notice of an interrupt that leaves code outside the cells running, naming its `frames` (§6). */
  readonly reportOutside: (frames: readonly string[]) => void;
};

/** A notice in the daemon's kernel log, naming the notebook. */
function logNotice(realm: Realm, msg: string, detail: Record<string, unknown>): void {
  realm.log("stderr", `${notice(msg, { notebook: realm.config.notebook, ...detail })}\n`);
}

/**
 * Runs a flow. Every flow ends its run or answers its request itself, whatever the code it runs throws; what can still
 * fail out of one is a send (its answer could not leave), logged as the last resort rather than lost.
 */
function keep(realm: Realm, type: string, flow: () => Promise<void> | void): void {
  const failed = (error: unknown): void => {
    logNotice(realm, `the ${type} flow could not send its answer`, {
      error: realm.errorInfo(error),
    });
  };
  try {
    onOwnRejection(flow(), failed);
  } catch (error) {
    failed(error);
  }
}

type Request = Exclude<DaemonMessage, { type: "shutdown" | "cancel" | "page" }>;

/** How many abandoned requests are remembered, as for interrupted executions (04-kernel §6). */
const abandonedKept = 1000;

/** True for a request whose id the daemon abandoned: its caller was already answered, so it never starts. */
const isAbandoned = (message: DaemonMessage, abandoned: Recent<number>): boolean =>
  "id" in message && abandoned.has(message.id);

/** The flow that answers `message`. */
function flowOf(realm: Realm, message: Request): () => Promise<void> | void {
  switch (message.type) {
    case "execute":
      return () => runCell(realm, message);
    case "call":
      return () => callFlow(realm, message);
    case "snapshot":
      return () => snapshotFlow(realm, message);
    case "bindings":
      return () => bindingsFlow(realm, message);
    case "route":
      return () => routeFlow(realm, message);
    case "dispose":
      return () => disposeFlow(realm, message);
  }
}

function dispatch(
  realm: Realm,
  message: Request | { type: "shutdown" },
  end: (code: number) => void,
): void {
  if (message.type !== "shutdown") {
    keep(realm, message.type, flowOf(realm, message));
    return;
  }
  realm.sink.flushAll();
  end(0);
}

/**
 * A daemon message, validated; undefined for one that failed validation (logged and ignored) and for one whose reading
 * threw. That happens only when a cell broke a built-in the validation reads (Zod reads the global `Promise`, 04-kernel
 * §3.3): this kernel could then read no message again, so it ends, its log saying why, and the daemon reports its
 * death instead of a run that never answers.
 */
function read(realm: Realm, raw: unknown, end: (code: number) => void): DaemonMessage | undefined {
  let parsed: ReturnType<typeof parseDaemonMessage>;
  try {
    parsed = parseDaemonMessage(raw);
  } catch (error) {
    try {
      logNotice(realm, "a daemon message could not be read, so the kernel ends", {
        error: realm.errorInfo(error),
      });
    } finally {
      end(1);
    }
    return undefined;
  }
  if (parsed.ok) return parsed.message;
  logNotice(realm, "a daemon message failed validation and was ignored", { issues: parsed.issues });
  return undefined;
}

/**
 * The inbox of `realm`: what `receive` takes, one message dispatched per event-loop turn, a `cancel` recorded as it
 * arrives. `draining` stands only while a turn is pending: set once a turn is scheduled, cleared by the turn that finds
 * the inbox empty. Whatever stops between two statements leaves at worst a spare turn, never a flag with no turn.
 */
function createInbox(realm: Realm, deps: RuntimeDeps): (raw: unknown) => void {
  const inbox: (Request | { type: "shutdown" })[] = [];
  const abandoned = createRecent<number>(abandonedKept);
  let draining = false;
  const turn = (): void => {
    const message = inbox.shift();
    if (message === undefined) {
      draining = false;
      return;
    }
    // The next turn is scheduled before this message's job exists: a termination there cannot cancel it. The flows
    // call user code synchronously, so the dispatch starts as user code does, in a promise job (04-kernel §6).
    deps.defer(turn);
    if (isAbandoned(message, abandoned)) return;
    startUserCode(() => {
      dispatch(realm, message, deps.end);
    });
  };
  return (raw) => {
    const message = read(realm, raw, deps.end);
    if (message === undefined) return;
    if (message.type === "cancel") {
      for (const id of message.ids) abandoned.add(id);
      return;
    }
    if (message.type === "page") {
      realm.builtins.listening(message.listening);
      return;
    }
    inbox.push(message);
    if (draining) return;
    deps.defer(turn);
    draining = true;
  };
}

/** The runtime over a fresh realm. */
export function createRuntime(deps: RuntimeDeps): Runtime {
  const realm = createRealm(deps);
  return {
    receive: createInbox(realm, deps),
    lateError: (error) => {
      realm.reportError(realm.stores.current(), error);
    },
    write: realm.builtins.write,
    checkHooks: () => {
      void realm.checkHooks(realm.stores.last());
    },
    recheckHooks: () => {
      void realm.recheckHooks(realm.stores.last());
    },
    runningStore: realm.stores.current,
    cellOf: realm.compiler.cellOf,
    reportOutside: (frames) => {
      const msg = "an interrupt found code outside the cells running and did not stop it";
      logNotice(realm, `${msg}; kernel.restart does`, { frames });
    },
  };
}
