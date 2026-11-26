// What every part of an open notebook's session shares: its ref and file, its cells, the document's own fields, the
// events it emits (on its own stream), the kernel, the autosave, the clock and ids, the settings and the log.
import type {
  CellId,
  DebugPause,
  EventType,
  Graph,
  IdGenerator,
  NotebookState,
  Settings,
} from "@jsnb/core";
import type { EventBatch, ExportEntry, LateOutput } from "@jsnb/kernel-node";

import type { EventInput } from "../../events/bus.js";
import type { Log } from "../../events/log.js";
import type { FileIdentity } from "../../files/atomicWrite.js";
import type { PauseClock } from "../../kernel/pauses.js";
import type { KernelSupervisor } from "../../kernel/supervisor.js";
import type { Autosaver } from "./autosave.js";
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
  /** Awaited before a client cell's code goes to the headless page: the debugger attaches to it first when it may stop. */
  beforeClientRun: (cell: CellId) => Promise<void>;
  /** A client cell's breakpoint lines, compiled as `debugger;` statements (for a tab's DevTools). */
  debuggerLines: (cell: CellId) => readonly number[];
  /** Where and why a realm is paused in the debugger, once one is (a run's wait answers with it). */
  debugPause: () => Promise<DebugPause>;
  /** The headless page as the debugger holds it. */
  pageDebug: PageDebug;
  /** Settles once the debugger saw the kernel resume (a second at most): an interrupt resumes a paused kernel itself. */
  debugResumed: () => Promise<void>;
  /** A cell's code or type changed (an edit, a revert, a reload): it leaves an auto-run cascade (04-kernel §4.1). */
  edited: (cell: CellId, before: Graph) => void;
  /** Settles once the run of `cell` under way, if any, ended (at once otherwise, after a microtask). */
  runEnded: (cell: CellId) => Promise<void>;
  /** A cell is about to be deleted: waiting in a cascade, it leaves it, and what depends on it is held back. */
  deleting: (cell: CellId) => void;
  /** The kernel ended (died, restarted, closed) or the page's realm was reset: what ran there is gone. */
  realmEnded: (realm: "server" | "client") => void;
  /** NotebookState.autoRun: the cascade under way. */
  autoRunState: () => NonNullable<NotebookState["autoRun"]>;
};

/** The debugger's hold on the headless page (debug/session.ts). */
type PageDebug = {
  /** The page's time paused in the debugger. */
  readonly clock: PauseClock;
  readonly paused: () => boolean;
  /** Paused, or js-debug holds it for client cells' breakpoints: its idle close waits. */
  readonly held: () => boolean;
  /** A request the page must answer is about to go to it: a paused page ends what it paused in and resumes; the cell
   * it was paused in, when it was. */
  readonly release: () => Promise<CellId | undefined>;
  /** The page is about to close: js-debug leaves it. */
  readonly closing: () => void;
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
  /** The session took unsaved text from a recovery copy written at this time (recovery.ts, 07 §7). */
  recovered?: string | undefined;
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
