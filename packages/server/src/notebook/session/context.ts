// What every part of an open notebook's session shares: its ref and file, its cells, the document's own fields, the
// events it emits (on its own stream), the kernel, the autosave, the clock and ids, the settings and the log.
import type { CellId, DebugPause, EventType, IdGenerator, Settings } from "@jsnb/core";
import type { EventBatch, ExportEntry, LateOutput } from "@jsnb/kernel-node";

import type { EventInput } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { FileIdentity } from "../../files/atomicWrite.js";
import type { KernelSupervisor } from "../../kernel/supervisor.js";
import type { Autosaver } from "./autosaveApi.js";
import type { CellStore } from "./cells.js";
import type { ExportsClock } from "./runs/exportsClock.js";
import type { Retained } from "./runs/retained.js";

/** The notebook file's own fields, written back as they were read (07-file-format §2, §4). */
export type DocumentHeader = {
  readonly version: number;
  readonly extra: Readonly<Record<string, unknown>>;
  /** The file had an `outputs` key when it was read: outputs.save `auto` keeps saving them. */
  readonly outputs: boolean;
};

export type Emit = <T extends EventType>(type: T, data: EventInput<T>) => void;

/** What the kernel reports outside a run, wired by the parts that use it (runs, the bridge). */
export type SessionHooks = {
  lateOutput: (late: LateOutput) => void;
  exports: (names: readonly ExportEntry[]) => void;
  /** A flush of the kernel's `emit` calls (05-bridge §6). */
  events: (batch: EventBatch) => void;
  /** Whether a page holds the client realm, told to a kernel when it is ready (05-bridge §6). */
  pageAttached: () => boolean;
  /** A deleted client cell: the attached page runs its cleanups (its timers, listeners and `on` end). */
  disposeClient: (cell: CellId) => void;
  /** The kernel died or a restart killed it: the exports it had are gone. */
  kernelEnded: () => void;
  /** Awaited before a server cell's code goes to the kernel: the debugger attaches first when the notebook debugs. */
  beforeServerRun: () => Promise<void>;
  /** A client cell's breakpoint lines, compiled as `debugger;` statements. */
  debuggerLines: (cell: CellId) => readonly number[];
  /** Where and why the kernel is paused in the debugger, once it is (a run's wait answers with it). */
  debugPause: () => Promise<DebugPause>;
  /** Settles once the debugger saw the kernel resume (a second at most): an interrupt resumes a paused kernel itself. */
  debugResumed: () => Promise<void>;
};

/** What the runs share: the retained full values and whether the daemon itself is ending the kernel. */
type RunState = {
  readonly retained: Retained;
  /** The kernel's exports messages, which a server run waits for before it ends. */
  readonly exports: ExportsClock;
  /** Set while a restart or a close ends the kernel: the running run's KernelDead is then an interruption. */
  ending: boolean;
  /** Kernel restarts so far: a bridge call that saw one begin was cut by it (KernelRestarted, 05-bridge §7, §8). */
  restarts: number;
  /** Runs started since the kernel started: the last execution count given (Execution.count). */
  executions: number;
  /** The outputs.retainMaxBytes the kernel last launched with, at which it cuts a full form. */
  kernelBudget: number;
};

export type SessionContext = {
  /** The notebook's ref and file, both changed when its file moves (moves.ts, 07 §5). */
  ref: string;
  path: string;
  /** The kernel's log file (07-file-format §7), what kernel.log reads; it follows a move. */
  logPath: string;
  /** Which file `path` names (device and inode) as last opened or written; how a moved file is found (07 §5). */
  identity: FileIdentity | undefined;
  /** The ref the session opened under: the stable prefix of the query engines' held keys, whatever moves follow. */
  readonly holdKey: string;
  /** The workspace folder: the kernel's cwd and where pre-flight looks for packages. */
  readonly root: string;
  /** How long a kernel's snapshot or bindings request and the page's reset may take (startServer's option). */
  readonly requestTimeoutMs: number;
  readonly cells: CellStore;
  header: DocumentHeader;
  readonly emit: Emit;
  readonly hooks: SessionHooks;
  readonly log: Log;
  readonly ids: IdGenerator;
  readonly now: () => Date;
  readonly settings: () => Settings;
  readonly kernel: KernelSupervisor;
  readonly autosave: Autosaver;
  readonly runs: RunState;
};
