// One notebook's kernel: a NodeKernel created and started on open, stopped on
// close, killed and replaced by a restart (a run asking for the kernel meanwhile gets the new one), replaced by the next
// run after it died on its own, never by a read; its kernel.status (starting, idle, busy, paused, dead with the exit)
// emitted on every change. Each kernel takes its options from the supervisor's and the settings of the moment
// (`kernel.nodePath`, the output limits), and its callbacks are passed on only while it is the supervisor's current
// kernel, so a replaced kernel's late messages reach nobody. The daemon's long-lived handle on the notebook's Kernel,
// hence a class.
import type { CellId, KernelState, KernelStatus, Route } from "@jsnb/core";
import { KernelDead } from "@jsnb/core";
import type {
  EventBatch,
  Exit,
  ExportEntry,
  KernelEntry,
  KernelLimits,
  LateOutput,
  NodeKernel,
} from "@jsnb/kernel-node";
import { createNodeKernel } from "@jsnb/kernel-node";

import type { Log } from "../events/log.js";
import type { PauseClock } from "./pauses.js";
import { createPauseClock } from "./pauses.js";

type KernelFacts = {
  state: KernelState;
  pid: number | null;
  startedAt: string | null;
  inspectorUrl: string | null;
  executing: CellId | null;
  paused: boolean;
  exit: Exit | undefined;
};

/** The facts of a kernel being started. */
const startingFacts = (): KernelFacts => ({
  state: "starting",
  pid: null,
  startedAt: null,
  inspectorUrl: null,
  executing: null,
  paused: false,
  exit: undefined,
});

function stateOf(facts: KernelFacts): KernelState {
  if (facts.state === "dead" || facts.state === "starting") return facts.state;
  if (facts.paused) return "paused";
  return facts.executing === null ? "idle" : "busy";
}

/** The status `kernel.status` and its event carry. */
function statusOf(facts: KernelFacts): KernelStatus {
  const state = stateOf(facts);
  return {
    state,
    pid: facts.pid,
    startedAt: facts.startedAt,
    executing: facts.executing,
    inspectorUrl: facts.inspectorUrl,
    ...(state === "dead" ? facts.exit : {}),
  };
}

/** The exit a failed start reports, when it is the kernel's death. */
const exitOf = (error: unknown): Exit | undefined =>
  error instanceof KernelDead ? error.data : undefined;

type KernelSink = {
  readonly status: (status: KernelStatus) => void;
  readonly output: (late: LateOutput) => void;
  readonly exports: (names: readonly ExportEntry[]) => void;
  readonly routes: (routes: readonly Route[]) => void;
  readonly events: (batch: EventBatch) => void;
  /** The kernel is gone (it died, or a restart killed it): its exports and routes with it. */
  readonly ended: () => void;
  readonly log: (line: string) => void;
};

type SupervisorOptions = {
  readonly workspace: string;
  readonly notebook: string;
  readonly port: () => number;
  readonly entry: KernelEntry | undefined;
  /** `kernel.nodePath` and the output limits, read at each kernel's creation. */
  readonly config: () => { readonly nodePath: string | null; readonly limits: KernelLimits };
  readonly now: () => Date;
  readonly sink: KernelSink;
  readonly log: Log;
  /** Whether a page holds the client realm, read when a kernel is ready. */
  readonly pageListening?: () => boolean;
};

/** What the supervisor hears from the kernel it launches. */
type LaunchHooks = {
  /** Whether this kernel is still the supervisor's current one. */
  readonly current: () => boolean;
  readonly paused: (paused: boolean) => void;
  readonly exit: (exit: Exit) => void;
};

/** A new kernel, not started. */
function launchKernel(options: SupervisorOptions, hooks: LaunchHooks): NodeKernel {
  const { nodePath, limits } = options.config();
  const { sink } = options;
  const whileCurrent =
    <T>(pass: (value: T) => void) =>
    (value: T): void => {
      if (hooks.current()) pass(value);
    };
  return createNodeKernel({
    workspace: options.workspace,
    notebook: options.notebook,
    nodePath,
    limits,
    port: options.port(),
    ...(options.entry === undefined ? {} : { entry: options.entry }),
    onOutput: whileCurrent(sink.output),
    onExports: whileCurrent(sink.exports),
    onRoutes: whileCurrent(sink.routes),
    onEvents: whileCurrent(sink.events),
    ...(options.pageListening === undefined ? {} : { pageListening: options.pageListening }),
    onPause: whileCurrent(hooks.paused),
    onExit: hooks.exit,
    onLog: sink.log,
  });
}

type Instance = { readonly kernel: NodeKernel; readonly started: Promise<NodeKernel> };

export class KernelSupervisor {
  readonly #options: SupervisorOptions;
  #facts: KernelFacts = startingFacts();
  #current: Instance | undefined;
  #ready = false;
  #emitted = "";
  /** Settles once a restart's new kernel started (or failed to). */
  #restarting: Promise<void> | undefined;
  /** The restart under way, which a second restart joins. */
  #underWay: Promise<void> | undefined;
  #stopped = false;
  readonly #pauses = createPauseClock();

  constructor(options: SupervisorOptions) {
    this.#options = options;
  }

  /** The time the kernel spends paused in the debugger, which the daemon's waits do not count. */
  get pauses(): PauseClock {
    return this.#pauses;
  }

  status(): KernelStatus {
    return statusOf(this.#facts);
  }

  /** The started kernel; a dead one is replaced first. Rejects with the start's error, KernelDead once stopped. */
  ready(): Promise<NodeKernel> {
    if (this.#stopped) return Promise.reject(new KernelDead());
    if (this.#restarting) return this.#restarting.then(() => this.ready());
    try {
      const instance =
        this.#current && this.#facts.state !== "dead" ? this.#current : this.#launch();
      return instance.started;
    } catch (error) {
      // createNodeKernel refused its options (InvalidParams): the kernel is as dead as one that failed to start.
      this.#died(this.#current, undefined);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * The kernel to read from (cell.bindings, kernel.scope, bridge.call): the one started or starting, never a new one; a
   * dead kernel is KernelDead with its exit code or signal (only a run, a restart or an open starts one).
   */
  running(): Promise<NodeKernel> {
    if (this.#stopped) return Promise.reject(new KernelDead());
    if (this.#restarting) return this.#restarting.then(() => this.running());
    if (this.#current === undefined || this.#facts.state === "dead")
      return Promise.reject(new KernelDead(this.#facts.exit));
    return this.#current.started;
  }

  /** The kernel when it is started and alive. */
  live(): NodeKernel | undefined {
    return this.#ready && this.#facts.state !== "dead" ? this.#current?.kernel : undefined;
  }

  /** The cell whose run the kernel executes now (busy), or null (idle). */
  executing(cell: CellId | null): void {
    this.#facts.executing = cell;
    this.#emit();
  }

  /**
   * SIGKILL, then a fresh kernel; its routes are gone with it. Rejects with the new kernel's start error. One restart at
   * a time: a restart asked for while one runs joins it and launches nothing more.
   */
  restart(): Promise<void> {
    this.#underWay ??= this.#restartOnce().finally(() => {
      this.#underWay = undefined;
    });
    return this.#underWay;
  }

  async #restartOnce(): Promise<void> {
    this.#options.log.info({}, "restarting the kernel");
    const old = this.#current;
    this.#current = undefined;
    const restarting = (async () => {
      await old?.kernel.kill();
      // A start before its fork goes on after kill() answered: it ends first, logged in #start, so no
      // two starts overlap and a close that follows finds no start of the old kernel still under way.
      await old?.started.catch(() => undefined);
      this.#gone();
      if (!this.#stopped) await this.#launch().started;
    })();
    this.#restarting = restarting.then(
      () => undefined,
      () => undefined, // the restart's caller gets the failure; a waiting run then starts a kernel of its own
    );
    try {
      await restarting;
    } finally {
      this.#restarting = undefined;
    }
  }

  /**
   * Stops the kernel for good (the notebook closes): later runs get KernelDead. A start under way ends first, logged:
   * stopped before it forked, the kernel answers at once while its start still checks Node and writes the loader, and
   * that start would end after the close, the daemon's stop and its log (closing checks).
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#restarting; // a restart under way kills the old kernel and, stopped, launches none
    const current = this.#current;
    this.#current = undefined;
    if (current && this.#facts.state !== "dead") this.#options.log.info({}, "stopping the kernel");
    await current?.kernel.stop();
    await current?.started.catch(() => undefined); // its end is logged in #start
  }

  #emit(): void {
    const status = statusOf(this.#facts);
    const text = JSON.stringify(status);
    if (text === this.#emitted) return;
    this.#emitted = text;
    this.#options.sink.status(status);
  }

  #died(instance: Instance | undefined, exit: Exit | undefined): void {
    if (instance !== this.#current) return;
    this.#ready = false;
    this.#pauses.set(false);
    this.#facts = {
      ...this.#facts,
      state: "dead",
      pid: null,
      paused: false,
      executing: null,
      exit,
    };
    this.#emit();
    this.#gone();
  }

  #gone(): void {
    this.#options.sink.routes([]);
    this.#options.sink.ended();
  }

  #started(instance: Instance, kernel: NodeKernel): void {
    if (instance !== this.#current) return;
    this.#ready = true;
    const startedAt = this.#options.now().toISOString();
    const inspectorUrl = kernel.inspectorUrl() ?? null;
    this.#facts = {
      ...this.#facts,
      state: "idle",
      pid: kernel.pid() ?? null,
      startedAt,
      inspectorUrl,
    };
    this.#options.log.info({ kernelPid: this.#facts.pid }, "the kernel started");
    this.#emit();
  }

  #launch(): Instance {
    const own: { instance?: Instance } = {};
    const kernel = launchKernel(this.#options, {
      current: () => own.instance !== undefined && own.instance === this.#current,
      paused: (paused) => {
        this.#paused(paused);
      },
      exit: (exit) => {
        // A restart or a stop replaces the instance before its kill, so only an end of its own is logged.
        if (own.instance !== undefined && own.instance === this.#current)
          this.#options.log.warn({ ...exit }, "the kernel exited");
        this.#died(own.instance, exit);
      },
    });
    const instance: Instance = { kernel, started: this.#start(kernel, () => own.instance) };
    own.instance = instance;
    this.#current = instance;
    this.#ready = false;
    this.#facts = { ...startingFacts(), executing: null };
    this.#emit();
    return instance;
  }

  #start(kernel: NodeKernel, instance: () => Instance | undefined): Promise<NodeKernel> {
    const started = kernel.start().then(
      () => {
        const own = instance();
        if (own) this.#started(own, kernel);
        return kernel;
      },
      (error: unknown) => {
        const own = instance();
        // A kernel stopped or replaced while it started (a close, a stop, a restart) ending its start is expected.
        if (this.#stopped || own !== this.#current)
          this.#options.log.info({ err: error }, "a kernel was stopped while it started");
        else this.#options.log.error({ err: error }, "the kernel could not start");
        this.#died(own, exitOf(error));
        throw error;
      },
    );
    started.catch(() => undefined); // a start nobody awaits (open's) is not unhandled: it is logged above
    return started;
  }

  #paused(paused: boolean): void {
    this.#pauses.set(paused);
    this.#facts.paused = paused;
    this.#emit();
  }
}
