// A notebook's js-debug session on its kernel: attached once whoever asks, the paused state from its stopped and
// continued events, the breakpoints sent per cell and taken back from its answers and events (by id within a cell's
// source), and its end: the kernel's, a new attach's, or js-debug's own death, after which a kernel left paused is
// resumed through the daemon's own inspector session and the page told. The daemon's long-lived handle on it.
import { fileURLToPath } from "node:url";

import type { Breakpoint, CellId, DebugPause } from "@jsnb/core";
import { cellUrl, NotAvailable, NotPaused } from "@jsnb/core";
import { sourceOf } from "@jsnb/transform";

import type { Adapter } from "../../kernel/debug/adapter.js";
import type { Attached } from "../../kernel/debug/attach.js";
import { attachJsDebug, detachJsDebug } from "../../kernel/debug/attach.js";
import type { DapConnection, DapEvent } from "../../kernel/debug/dap.js";
import type { StackFrame } from "../../kernel/debug/protocol.js";
import { BreakpointEvent, dap, StoppedEvent } from "../../kernel/debug/protocol.js";
import type { SessionContext } from "../session/context.js";
import type { Breakpoints } from "./breakpoints.js";
import { framesOf, pauseOf } from "./inspect.js";
import type { Redact } from "./redaction.js";
import { cleanBreakpoint, cleanPause } from "./redaction.js";
import { sendBreakpoints } from "./sends.js";

export type Paused = {
  readonly threadId: number;
  readonly pause: DebugPause;
  readonly frames: readonly StackFrame[];
};

const unavailable = (reason: string): NotAvailable =>
  new NotAvailable({ feature: "The debugger", reason });

const lostNotice = (resumed: boolean): string =>
  resumed ? "js-debug exited; the kernel was resumed." : "js-debug exited.";

export class JsDebugLink {
  readonly #context: SessionContext;
  readonly #adapter: Adapter;
  readonly #redact: Redact;
  readonly #breakpoints: Breakpoints;
  /** The code each cell with breakpoints had when its breakpoints were last placed. */
  readonly sources = new Map<CellId, string>();
  /** What js-debug holds per source path: a list it already has is not sent again. */
  readonly held = new Map<string, string>();
  /** The refs of the Notebook scopes shown since the last pause, whose plumbing names are left out. */
  readonly notebookRefs = new Set<number>();
  /** Sends per cell in order: a later list never lands before an earlier one. */
  readonly #sends = new Map<CellId, Promise<void>>();
  #attached: Attached | undefined;
  #attaching: Promise<Attached> | undefined;
  #paused: Paused | undefined;
  #closed = false;
  /** Counts stops and resumes, so an answer about an older one is dropped. */
  #stops = 0;
  /** A step sent and not stopped yet; once its run ended, the stop it still owes is not the user's. */
  #stepping = false;
  #staleStep = false;

  constructor(
    context: SessionContext,
    deps: { readonly adapter: Adapter; readonly redact: Redact; readonly breakpoints: Breakpoints },
  ) {
    this.#context = context;
    this.#adapter = deps.adapter;
    this.#redact = deps.redact;
    this.#breakpoints = deps.breakpoints;
  }

  get attached(): Attached | undefined {
    return this.#attached;
  }

  get paused(): Paused | undefined {
    return this.#paused;
  }

  /** The paused stop and js-debug's child session; NotPaused for `command` otherwise. */
  pausedOn(command: string): { readonly paused: Paused; readonly child: DapConnection } {
    const paused = this.#paused;
    const child = this.#attached?.child;
    if (!paused || !child) throw new NotPaused({ command });
    return { paused, child };
  }

  pathOf(cell: CellId): string {
    return fileURLToPath(sourceOf(cellUrl(this.#context.ref, cell)));
  }

  cellOf(path: string): CellId | undefined {
    const id = /([^/\\]+)\.ts$/u.exec(path)?.[1];
    const record =
      id === undefined ? undefined : this.#context.cells.list().find((each) => each.id === id);
    return record && this.pathOf(record.id) === path ? record.id : undefined;
  }

  list(): Breakpoint[] {
    return this.#breakpoints.list().map(cleanBreakpoint(this.#redact));
  }

  emitBreakpoints(): void {
    this.#context.emit("debug.breakpoints", { breakpoints: this.list() });
  }

  /** A warning whose error text goes through the redaction: an evaluation's error can hold a secret's value. */
  warn(error: unknown, message: string): void {
    this.#context.log.warn({ error: this.#redact(String(error)) }, message);
  }

  /** A step or continue sent: the pause ends unless the kernel stopped again before its answer. */
  async step(
    request: (child: DapConnection, threadId: number) => Promise<unknown>,
    command: string,
  ) {
    const { paused, child } = this.pausedOn(command);
    this.#stops += 1;
    const sent = this.#stops;
    this.#stepping = command !== "debug.resume";
    await request(child, paused.threadId);
    if (this.#stops === sent) this.#resumed();
  }

  /** js-debug attached to the current kernel, attaching once whoever asks. */
  ensure(): Promise<Attached> {
    const url = this.#context.kernel.status().inspectorUrl;
    const attached = this.#attached;
    if (attached?.url === url && !attached.child.closed()) return Promise.resolve(attached);
    this.#attaching ??= this.#attachNow().finally(() => {
      this.#attaching = undefined;
    });
    return this.#attaching;
  }

  /** Sends `cell`'s breakpoints when js-debug is attached (after the sends before it); a failure is logged. */
  sendCell(cell: CellId): Promise<void> {
    const child = this.#attached?.child;
    if (!child) return Promise.resolve();
    const next = (this.#sends.get(cell) ?? Promise.resolve())
      .then(() => this.#send(child, cell))
      .catch((error: unknown) => {
        this.warn(error, "the debugger could not set a cell's breakpoints");
      });
    this.#sends.set(cell, next);
    return next;
  }

  async close(): Promise<void> {
    this.#closed = true;
    const own = this.#attached;
    this.#attached = undefined;
    this.#paused = undefined;
    if (own) await detachJsDebug(own);
  }

  #resumed(): void {
    if (!this.#paused) return;
    this.#paused = undefined;
    this.notebookRefs.clear();
    this.#context.emit("debug.resumed", { state: this.#attached ? "running" : "off" });
  }

  #send(child: DapConnection, cell: CellId): Promise<void> {
    const record = this.#context.cells.get(cell);
    if (record) this.sources.set(cell, record.source);
    const breakpoints = record?.type === "server" ? this.#breakpoints.ofCell(cell) : [];
    const sent = { path: this.pathOf(cell), cell, breakpoints };
    return sendBreakpoints(child, this.#breakpoints, sent, this.held);
  }

  async #attachNow(): Promise<Attached> {
    const kernel = await this.#context.kernel.running();
    const url = kernel.inspectorUrl();
    if (url === undefined) throw unavailable("the kernel has no inspector.");
    if (this.#attached?.url === url && !this.#attached.child.closed()) return this.#attached;
    if (this.#attached) this.#detached(this.#attached.child, "replaced");
    this.held.clear();
    const made = await attachJsDebug(this.#adapter, {
      url,
      cwd: this.#context.root,
      onEvent: (child, event) => {
        this.#childEvent(child, event);
      },
      configure: async (child) => {
        for (const cell of this.#breakpoints.cells()) await this.#send(child, cell);
        await dap.setExceptionBreakpoints(child, { filters: [] });
      },
    });
    if (this.#closed) {
      await detachJsDebug(made);
      throw unavailable("the notebook closed.");
    }
    this.#attached = made;
    made.child.onClose(() => {
      this.#detached(made.child, "lost");
    });
    this.#context.log.info({}, "the debugger attached to the kernel");
    this.#context.emit("debug.resumed", { state: "running" });
    this.emitBreakpoints();
    return made;
  }

  #childEvent(child: DapConnection, event: DapEvent): void {
    if (event.event === "stopped") {
      const body = StoppedEvent.safeParse(event.body);
      if (body.success) void this.#stopped(child, body.data);
    } else if (event.event === "continued") {
      this.#stops += 1;
      this.#resumed();
    } else if (event.event === "breakpoint") {
      const body = BreakpointEvent.safeParse(event.body);
      if (body.success) this.#bound(body.data);
    } else if (event.event === "terminated") this.#detached(child, "ended");
  }

  /** A run ended: a step it left armed (an exception took the frame away) would stop the next run on its first line. */
  runEnded(): void {
    if (this.#stepping && !this.#paused) this.#staleStep = true;
    this.#stepping = false;
  }

  async #stopped(child: DapConnection, body: StoppedEvent): Promise<void> {
    if (this.#staleStep && body.reason === "step") {
      this.#staleStep = false;
      await dap.continue(child, { threadId: body.threadId ?? 0 }).catch(() => undefined);
      return;
    }
    this.#staleStep = false;
    this.#stepping = false;
    this.#stops += 1;
    const stop = this.#stops;
    const threadId = body.threadId ?? 0;
    const frames = await dap.stackTrace(child, { threadId, startFrame: 0, levels: 100 }).then(
      (trace) => trace.stackFrames,
      (error: unknown) => {
        this.warn(error, "the debugger could not read the paused stack");
        return [];
      },
    );
    if (stop !== this.#stops) return; // resumed, or paused again, meanwhile
    const pause = pauseOf(body, framesOf(frames, (path) => this.cellOf(path))[0]);
    this.#paused = { threadId, pause, frames };
    this.notebookRefs.clear();
    this.#context.emit("debug.paused", cleanPause(this.#redact, pause));
  }

  /** js-debug's news of a breakpoint, known by its id within its source's path (its ids repeat across sources, and
   * within one source too). */
  #bound({ breakpoint }: BreakpointEvent): void {
    const path = breakpoint.source?.path;
    const cell = path === undefined ? undefined : this.cellOf(path);
    const record =
      cell === undefined || breakpoint.id === undefined
        ? undefined
        : this.#breakpoints.byDapId(cell, breakpoint.id, breakpoint.line);
    if (!record) return;
    record.verified = breakpoint.verified;
    const line = breakpoint.verified ? breakpoint.line : undefined;
    if (line !== undefined && this.#breakpoints.bound(record, line))
      void this.sendCell(record.cell);
    this.emitBreakpoints();
  }

  /** js-debug left: the kernel ended (or a restart), a new attach replaced it, or it was lost (it died). Nothing is
   * bound or paused any more; a kernel it left paused is resumed through the daemon's own session, and the page told. */
  #detached(child: DapConnection, why: "ended" | "replaced" | "lost"): void {
    const was = this.#attached;
    if (was?.child !== child) return;
    this.#attached = undefined;
    this.held.clear();
    this.#stops += 1;
    was.parent.close();
    was.child.close();
    this.#breakpoints.unverifyAll();
    const kernel = this.#context.kernel.live();
    const resumed = why === "lost" && kernel?.paused() === true;
    if (resumed) kernel.resume();
    this.#paused = undefined;
    this.notebookRefs.clear();
    if (this.#closed) return;
    const notice = why === "lost" ? { notice: lostNotice(resumed) } : {};
    this.#context.emit("debug.resumed", { state: "off", ...notice });
    this.emitBreakpoints();
  }
}
