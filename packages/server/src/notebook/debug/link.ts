// A notebook's js-debug session on one realm, the kernel or the headless page (target.ts says where it attaches):
// attached once whoever asks, the paused state from its stopped and continued events, the breakpoints of that realm's
// cells sent per cell and taken back from its answers and events (by id within a cell's source), and its end: the
// target's, a new attach's, a release, or js-debug's own death, after which a kernel left paused is resumed through the
// daemon's own inspector session and the page told. The daemon's long-lived handle on it.
import { fileURLToPath } from "node:url";

import type { CellId, DebugPause, DebugRealm } from "@jsnb/core";
import { cellUrl, NotAvailable, NotPaused } from "@jsnb/core";
import { sourceOf } from "@jsnb/transform";

import type { Adapter } from "../../kernel/debug/adapter.js";
import type { Attached } from "../../kernel/debug/attach.js";
import { attachJsDebug, detachJsDebug } from "../../kernel/debug/attach.js";
import type { DapConnection, DapEvent } from "../../kernel/debug/dap.js";
import type { StackFrame } from "../../kernel/debug/protocol.js";
import { BreakpointEvent, dap, StoppedEvent } from "../../kernel/debug/protocol.js";
import type { SessionContext } from "../session/context.js";
import type { BreakpointRecord, Breakpoints } from "./breakpoints.js";
import type { Dialect } from "./conditions.js";
import { framesOf, pauseOf } from "./inspect.js";
import type { Redact } from "./redaction.js";
import { cleanPause } from "./redaction.js";
import { sendBreakpoints } from "./sends.js";
import type { DebugTarget, Opened } from "./target.js";

export type Paused = {
  readonly threadId: number;
  readonly pause: DebugPause;
  readonly frames: readonly StackFrame[];
  /** The session's count of pauses when this one began: the latest pause is the one the commands act on. */
  readonly order: number;
};

type Link = Attached & { readonly opened: Opened };

export type LinkDeps = {
  readonly adapter: Adapter;
  readonly redact: Redact;
  readonly breakpoints: Breakpoints;
  /** The code each cell with breakpoints had when its breakpoints were last placed (both realms' links share it). */
  readonly sources: Map<CellId, string>;
  readonly target: DebugTarget;
  /** The breakpoints changed: the session emits their list. */
  readonly changed: () => void;
  /** The next number of the session's pauses, both realms counted. */
  readonly nextPause: () => number;
  /** Hears each time this realm pauses or stops being paused. */
  readonly onPaused?: (paused: boolean) => void;
};

const lostNotice = (realm: DebugRealm, resumed: boolean): string =>
  realm === "client"
    ? "js-debug exited; the page was resumed."
    : resumed
      ? "js-debug exited; the kernel was resumed."
      : "js-debug exited.";

export class JsDebugLink {
  readonly #context: SessionContext;
  readonly #deps: LinkDeps;
  readonly #target: DebugTarget;
  readonly sources: Map<CellId, string>;
  /** What js-debug holds per source path: a list it already has is not sent again. */
  readonly held = new Map<string, string>();
  /** The refs of the Notebook scopes shown since the last pause, whose plumbing names are left out. */
  readonly notebookRefs = new Set<number>();
  /** Sends per cell in order: a later list never lands before an earlier one. */
  readonly #sends = new Map<CellId, Promise<void>>();
  #attached: Link | undefined;
  #attaching: Promise<Link> | undefined;
  #paused: Paused | undefined;
  #closed = false;
  /** Counts stops and resumes, so an answer about an older one is dropped. */
  #stops = 0;
  /** A step sent and not stopped yet; once its run ended, the stop it still owes is not the user's. */
  #stepping = false;
  #staleStep = false;

  constructor(context: SessionContext, deps: LinkDeps) {
    this.#context = context;
    this.#deps = deps;
    this.#target = deps.target;
    this.sources = deps.sources;
  }

  get realm(): DebugRealm {
    return this.#target.realm;
  }

  get dialect(): Dialect {
    return this.#target.dialect;
  }

  get attached(): Link | undefined {
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

  /** Whether `cell` runs in this link's realm now. */
  owns(cell: CellId): boolean {
    return this.#context.cells.get(cell)?.type === this.realm;
  }

  /** A warning whose error text goes through the redaction: an evaluation's error can hold a secret's value. */
  warn(error: unknown, message: string): void {
    this.#context.log.warn({ error: this.#deps.redact(String(error)), realm: this.realm }, message);
  }

  /** A step or continue sent: the pause ends unless the realm stopped again before its answer. */
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

  /** js-debug attached to the realm's current target, attaching once whoever asks. */
  ensure(): Promise<Link> {
    const id = this.#target.current();
    const attached = this.#attached;
    if (attached !== undefined && attached.opened.id === id && !attached.child.closed())
      return Promise.resolve(attached);
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

  /** js-debug leaves the realm's target now (the headless page is about to close): nothing is paused or bound here. */
  release(): void {
    const own = this.#attached;
    if (!own) return;
    own.opened.close?.();
    this.#detached(own.child, "ended");
    void detachJsDebug(own);
  }

  async close(): Promise<void> {
    this.#closed = true;
    const own = this.#attached;
    this.#attached = undefined;
    this.#setPaused(undefined);
    if (own) {
      await detachJsDebug(own);
      own.opened.close?.();
    }
  }

  /** A run ended: a step it left armed (an exception took the frame away) would stop the next run on its first line. */
  runEnded(): void {
    if (this.#stepping && !this.#paused) this.#staleStep = true;
    this.#stepping = false;
  }

  #setPaused(paused: Paused | undefined): void {
    const was = this.#paused !== undefined;
    this.#paused = paused;
    if (was !== (paused !== undefined)) this.#deps.onPaused?.(paused !== undefined);
  }

  #resumed(): void {
    if (!this.#paused) return;
    this.#setPaused(undefined);
    this.notebookRefs.clear();
    const state = this.#attached ? "running" : "off";
    this.#context.emit("debug.resumed", { realm: this.realm, state });
  }

  #send(child: DapConnection, cell: CellId): Promise<void> {
    const record = this.#context.cells.get(cell);
    if (record) this.sources.set(cell, record.source);
    const owns = record?.type === this.realm;
    const breakpoints: readonly BreakpointRecord[] = owns
      ? this.#deps.breakpoints.ofCell(cell)
      : [];
    const sent = { path: this.pathOf(cell), cell, owns, breakpoints, dialect: this.dialect };
    return sendBreakpoints(child, this.#deps.breakpoints, sent, this.held);
  }

  async #attachNow(): Promise<Link> {
    const opened = await this.#target.open();
    const current = this.#attached;
    if (current?.opened.id === opened.id && !current.child.closed()) {
      opened.close?.();
      return current;
    }
    if (current) this.#detached(current.child, "replaced");
    this.held.clear();
    let made: Attached;
    try {
      made = await attachJsDebug(this.#deps.adapter, {
        url: opened.url,
        cwd: this.#context.root,
        name: this.#target.name,
        skipFiles: opened.skipFiles,
        onEvent: (child, event) => {
          this.#childEvent(child, event);
        },
        configure: async (child) => {
          for (const cell of this.#deps.breakpoints.cells()) await this.#send(child, cell);
          await dap.setExceptionBreakpoints(child, { filters: [] });
        },
      });
    } catch (error) {
      opened.close?.();
      throw error;
    }
    if (this.#closed || opened.gone?.aborted === true) {
      await detachJsDebug(made);
      opened.close?.();
      throw new NotAvailable({
        feature: "The debugger",
        reason: this.#closed ? "the notebook closed." : `${this.#target.name} went as it attached.`,
      });
    }
    const link: Link = { ...made, opened };
    this.#attached = link;
    made.child.onClose(() => {
      this.#detached(made.child, "lost");
    });
    opened.gone?.addEventListener("abort", () => {
      this.#detached(made.child, "ended");
      void detachJsDebug(made);
    });
    this.#context.log.info({ realm: this.realm }, `the debugger attached to ${this.#target.name}`);
    this.#context.emit("debug.resumed", { realm: this.realm, state: "running" });
    this.#deps.changed();
    return link;
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
    const top = framesOf(frames, (path) => this.cellOf(path))[0];
    const pause = pauseOf(this.realm, body, top);
    this.#setPaused({ threadId, pause, frames, order: this.#deps.nextPause() });
    this.notebookRefs.clear();
    this.#context.emit("debug.paused", cleanPause(this.#deps.redact, pause));
  }

  /** js-debug's news of a breakpoint, known by its id within its source's path (its ids repeat across sources, and
   * within one source too). */
  #bound({ breakpoint }: BreakpointEvent): void {
    const path = breakpoint.source?.path;
    const cell = path === undefined ? undefined : this.cellOf(path);
    if (cell === undefined || !this.owns(cell)) return;
    const store = this.#deps.breakpoints;
    const record =
      breakpoint.id === undefined ? undefined : store.byDapId(cell, breakpoint.id, breakpoint.line);
    if (!record) return;
    record.verified = breakpoint.verified;
    const line = breakpoint.verified ? breakpoint.line : undefined;
    if (line !== undefined && store.bound(record, line)) void this.sendCell(record.cell);
    this.#deps.changed();
  }

  /** js-debug left: the target ended (the kernel's end or restart, the page's close), a new attach replaced it, or it
   * was lost (it died). Nothing of this realm is bound or paused any more; a kernel it left paused is resumed through
   * the daemon's own session (a page resumes once its relay's session goes), and the page told. */
  #detached(child: DapConnection, why: "ended" | "replaced" | "lost"): void {
    const was = this.#attached;
    if (was?.child !== child) return;
    this.#attached = undefined;
    this.held.clear();
    this.#stops += 1;
    was.parent.close();
    was.child.close();
    was.opened.close?.();
    this.#deps.breakpoints.unverify((record) => this.owns(record.cell));
    const resumed = why === "lost" && this.#target.resumeLost();
    this.#setPaused(undefined);
    this.notebookRefs.clear();
    if (this.#closed) return;
    const notice = why === "lost" ? { notice: lostNotice(this.realm, resumed) } : {};
    this.#context.emit("debug.resumed", { realm: this.realm, state: "off", ...notice });
    this.#deps.changed();
  }
}
