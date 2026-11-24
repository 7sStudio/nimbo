// The context of a notebook session (02-architecture §2, §4): its cells from the loaded file, its kernel supervisor with
// the kernel's log, status and routes as events, its autosave, its retained values, all sharing one emit and log.
import type { IdGenerator, Settings } from "@jsnb/core";
import type { KernelEntry } from "@jsnb/kernel-node";

import type { EventBus } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import { kernelLogPath } from "../../files/logs/kernelLog.js";
import { KernelSupervisor } from "../../kernel/supervisor.js";
import type { Adapter } from "../../kernel/debug/adapter.js";
import type { JsonEngines } from "../query/engines.js";
import type { RealmDeps } from "../realm/state.js";
import { createCellStore } from "./cells.js";
import type { Emit, SessionContext, SessionHooks } from "./context.js";
import type { LoadedDocument } from "./fileForm.js";
import { savesOutputs, textOf } from "./fileForm.js";
import type { FileHooks } from "./sessionFile.js";
import { autosaverOf, followingKernelLog, livePlace } from "./sessionFile.js";
import { createExportsClock } from "./runs/exportsClock.js";
import { createRetained } from "./runs/retained.js";

export type SessionOptions = {
  readonly ref: string;
  readonly path: string;
  readonly root: string;
  readonly logsDir: string;
  readonly loaded: LoadedDocument;
  /** The file's text as read (or as notebook.create wrote it). */
  readonly fileText: string;
  readonly bus: EventBus;
  readonly log: Log;
  readonly ids: IdGenerator;
  readonly now: () => Date;
  readonly settings: () => Settings;
  readonly port: () => number;
  readonly kernelEntry: KernelEntry | undefined;
  /** The daemon's JSON query engines; each session has its own SQL tables under `sqlDirectory`. */
  readonly engines: JsonEngines;
  readonly sqlDirectory: string;
  /** What the client realm needs of the daemon: its redaction and the public env. */
  readonly realm: RealmDeps;
  /** How long the session waits for its kernel's snapshot or bindings answer and its page's reset. */
  readonly requestTimeoutMs: number;
  /** The daemon's js-debug, which the notebook's debugger attaches to its kernel. */
  readonly debugAdapter: Adapter;
  /** A save found nothing at the notebook's path: the workspace looks for where the file moved (moves.ts, 07 §5). */
  readonly missing?: () => Promise<void>;
  /** How often the file is stat'ed for an external edit the folder's events missed (watch.ts); 2 s by default. */
  readonly fileCheckMs?: number;
  /** The quiet time after a file event before the check; 100 ms by default. */
  readonly watchDebounceMs?: number;
};

const kernelConfig = (settings: Settings) => ({
  nodePath: settings["kernel.nodePath"],
  limits: {
    maxValueBytes: settings["outputs.maxValueBytes"],
    maxStreamBytes: settings["outputs.maxStreamBytes"],
    maxBytesPerValue: settings["bridge.maxBytesPerValue"],
    retainFullValue: settings["outputs.retainFullValue"],
    retainMaxBytes: settings["outputs.retainMaxBytes"],
  },
});

type Parts = { readonly emit: Emit; readonly log: Log; readonly hooks: SessionHooks };

/** The notebook's kernel supervisor: status and routes as events, late outputs and exports to the session's hooks. */
function kernelOf(
  options: SessionOptions,
  parts: Parts,
  writeLog: (line: string) => void,
  launched: (budget: number) => void,
): KernelSupervisor {
  const { emit, hooks } = parts;
  const config = () => {
    const made = kernelConfig(options.settings());
    launched(made.limits.retainMaxBytes); // the budget this kernel cuts full forms at
    return made;
  };
  return new KernelSupervisor({
    ...{
      workspace: options.root,
      notebook: options.ref,
      port: options.port,
      entry: options.kernelEntry,
    },
    ...{ now: options.now, log: parts.log, config },
    sink: {
      status: (status) => {
        emit("kernel.status", status);
      },
      output: (late) => {
        hooks.lateOutput(late);
      },
      exports: (names) => {
        hooks.exports(names);
      },
      routes: (routes) => {
        emit("routes.changed", { routes: [...routes] });
      },
      ended: () => {
        hooks.kernelEnded();
      },
      log: writeLog,
    },
  });
}

/** Where the session's notebook and its kernel log are (07-file-format §7). */
function placeOf({ ref, path, root, logsDir, requestTimeoutMs }: SessionOptions) {
  const logPath = kernelLogPath(logsDir, ref);
  return { ref, path, root, logPath, requestTimeoutMs, identity: undefined, holdKey: ref };
}

/** The runs' shared state at the start: nothing retained, the budget from the settings. */
function runsOf(options: SessionOptions): SessionContext["runs"] {
  return {
    retained: createRetained(() => options.settings()["outputs.retainMaxBytes"]),
    exports: createExportsClock(),
    ending: false,
    restarts: 0,
    executions: 0,
    kernelBudget: options.settings()["outputs.retainMaxBytes"],
  };
}

/** What contextOf adds to the context: the kernel log's close, and the log's move to a new ref (07 §5). */
export type OwnedContext = SessionContext & {
  readonly closeLog: () => void;
  /** Closes the kernel log, moves its files to `to`'s name and opens it there. */
  readonly moveLog: (to: string) => Promise<void>;
};

/** The context of a session over `options`: its kernel is created, not started. */
export function contextOf(options: SessionOptions, hooks: FileHooks = {}): OwnedContext {
  const { bus, now } = options;
  const log = options.log.child({ notebook: options.ref });
  // the ref and the file are the context's, read at each use: a followed move changes them (07 §5)
  const emit: Emit = (type, data) => {
    bus.emit(context.ref, type, data);
  };
  const place = livePlace(() => context);
  const sessionHooks: SessionHooks = {
    lateOutput: () => undefined,
    exports: () => undefined,
    kernelEnded: () => undefined,
    beforeServerRun: () => Promise.resolve(),
    debuggerLines: () => [],
    debugPause: () => Promise.resolve({ reason: "pause" }),
    debugResumed: () => Promise.resolve(),
  };
  const cells = createCellStore(options.loaded.records);
  const kernelLog = followingKernelLog(options.logsDir, options.ref, log);
  const parts = { emit, log, hooks: sessionHooks };
  const context: OwnedContext = {
    ...placeOf(options),
    ...{ cells, header: { ...options.loaded.header } },
    ...parts,
    ...{ ids: options.ids, now, settings: options.settings },
    closeLog: kernelLog.close,
    moveLog: (to) => kernelLog.move(context.ref, to),
    runs: runsOf(options),
    kernel: kernelOf(options, parts, kernelLog.write, (budget) => {
      context.runs.kernelBudget = budget;
    }),
    autosave: autosaverOf(options, { ...parts, place, files: hooks }, () => {
      const save = savesOutputs(options.settings(), context.header);
      // what the file holds from now on decides `auto` next time, as a reopened file's own key would
      context.header = { ...context.header, outputs: save };
      return textOf(context.header, cells.list(), { save, redact: options.realm.redact });
    }),
  };
  return context;
}
