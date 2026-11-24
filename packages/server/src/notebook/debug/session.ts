// One notebook's debugger (03-api §4.9): its breakpoints, js-debug attached to the kernel on the first debug command
// (and again after each restart, before the next run), and the commands over them, every string they answer through
// the daemon's redaction. It follows the notebook's events: a cell's edit moves its breakpoints, a deletion removes
// them, a move of the file sends them under the new paths, a run's end reads the errors its conditions kept.
import type {
  Breakpoint,
  CellId,
  DebugFrame,
  DebugPause,
  DebugScope,
  DebugState,
  DebugVariable,
  EventEnvelope,
} from "@jsnb/core";
import { InvalidParams, isJsnbError, NotAvailable } from "@jsnb/core";

import type { Adapter } from "../../kernel/debug/adapter.js";
import { dap } from "../../kernel/debug/protocol.js";
import type { SessionContext } from "../session/context.js";
import type { BreakpointOptions } from "./breakpoints.js";
import { Breakpoints, codeLineFrom } from "./breakpoints.js";
import { keptErrors } from "./conditions.js";
import type { Evaluated } from "./inspect.js";
import { childrenOf, evaluateIn, framesOf, scopesOf } from "./inspect.js";
import { JsDebugLink } from "./link.js";
import type { Redact } from "./redaction.js";
import { cleanEvaluated, cleanFrame, cleanPause, cleanScope, cleanVariable } from "./redaction.js";
import { forgetSources } from "./sends.js";

export type DebugDeps = {
  readonly adapter: Adapter;
  /** Hears every event of the daemon (the bus's listen); returns the stop. */
  readonly listen: (listener: (event: EventEnvelope) => void) => () => void;
  /** The daemon's redaction: every string the debugger answers or emits goes through it. */
  readonly redact: Redact;
};

export type Control = "pause" | "resume" | "stepOver" | "stepInto" | "stepOut";

export type Removal = {
  readonly breakpointId?: string | undefined;
  readonly cell?: CellId | undefined;
  readonly line?: number | undefined;
  readonly all?: boolean | undefined;
};

/** How long a run waits for js-debug to attach before it goes on without it. */
const attachWaitMs = 10_000;
/** How long a run's answer waits for the debugger to say where it paused. */
const pauseWaitMs = 1_000;
const pausePollMs = 25;
/** How long setBreakpoint waits for the bind in code the kernel already has. */
const bindWaitMs = 1_500;

const stepRequests = {
  resume: "continue",
  stepOver: "next",
  stepInto: "stepIn",
  stepOut: "stepOut",
} as const;

const notFrame = (frameId: string): InvalidParams =>
  new InvalidParams({
    issues: [{ path: ["frameId"], message: `no frame ${frameId} on the paused stack` }],
  });

/** Whether `each` is one `which` names. */
const named = (which: Removal, each: { breakpointId: string; cell: CellId; line: number }) =>
  which.all === true ||
  (which.breakpointId === undefined
    ? which.cell === each.cell && (which.line === undefined || which.line === each.line)
    : which.breakpointId === each.breakpointId);

const ended = new Set(["ok", "error", "interrupted"]);

export class DebugSession {
  readonly #context: SessionContext;
  readonly #redact: Redact;
  readonly #breakpoints = new Breakpoints();
  readonly #link: JsDebugLink;
  readonly #stopListening: () => void;
  /** Set once a debug command used the debugger: it attaches again after a restart. */
  #wanted = false;
  #closed = false;

  constructor(context: SessionContext, deps: DebugDeps) {
    this.#context = context;
    this.#redact = deps.redact;
    this.#link = new JsDebugLink(context, {
      adapter: deps.adapter,
      redact: deps.redact,
      breakpoints: this.#breakpoints,
    });
    this.#stopListening = deps.listen((event) => {
      if (!this.#closed && event.notebook === context.ref) this.#heard(event);
    });
  }

  state(): DebugState {
    const { paused, attached } = this.#link;
    const state = paused ? "paused" : attached ? "running" : "off";
    const pause = paused ? cleanPause(this.#redact, paused.pause) : null;
    return { state, paused: pause, breakpoints: this.#link.list() };
  }

  async setBreakpoint(cell: CellId, line: number, options: BreakpointOptions): Promise<Breakpoint> {
    const record = this.#context.cells.require(cell);
    // a blank or comment line has nothing to stop on: the breakpoint goes on the next line with code, as V8 would
    const at = codeLineFrom(record.source, line);
    const created = !this.#breakpoints.ofCell(cell).some((each) => each.line === at);
    const bp = this.#breakpoints.set(cell, at, options);
    this.#link.sources.set(cell, record.source);
    if (record.type === "server") {
      const refused = await this.#ensure().then(
        () => undefined,
        // a kernel that is dead or starting: the breakpoint binds once one runs; no js-debug at all refuses it
        (error: unknown) =>
          error instanceof NotAvailable && !this.#link.attached ? error : undefined,
      );
      if (refused) {
        if (created) this.#breakpoints.remove([bp]);
        throw refused;
      }
      await this.#link.sendCell(cell);
      if (record.last !== undefined) await this.#bound(bp);
    }
    this.#link.emitBreakpoints();
    const now = this.#link.list().find((each) => each.breakpointId === bp.breakpointId);
    return now ?? { breakpointId: bp.breakpointId, cell, line: bp.line, verified: false };
  }

  async removeBreakpoints(which: Removal): Promise<number> {
    const gone = this.#breakpoints.all().filter((each) => named(which, each));
    if (gone.length === 0) return 0;
    this.#breakpoints.remove(gone);
    const cells = [...new Set(gone.map((each) => each.cell))];
    await Promise.all(cells.map((cell) => this.#link.sendCell(cell)));
    this.#link.emitBreakpoints();
    return gone.length;
  }

  async control(verb: Control): Promise<void> {
    if (verb !== "pause") {
      const request = dap[stepRequests[verb]];
      await this.#link.step((child, threadId) => request(child, { threadId }), `debug.${verb}`);
      return;
    }
    const { child } = await this.#ensure();
    if (this.#link.paused) return;
    const { threads } = await dap.threads(child, {});
    await dap.pause(child, { threadId: threads[0]?.id ?? 0 });
  }

  stack(): DebugFrame[] {
    return this.#frames("debug.stack").map(cleanFrame(this.#redact));
  }

  /** The scopes of frame `frameId`, the innermost by default. */
  async scopes(frameId?: string): Promise<DebugScope[]> {
    const { child } = this.#link.pausedOn("debug.scope");
    const id = frameId === undefined ? this.#innermost("debug.scope") : this.#frameOf(frameId);
    const scopes = await scopesOf(child, id, this.#link.notebookRefs);
    return scopes.map(cleanScope(this.#redact));
  }

  async variables(ref: number): Promise<DebugVariable[]> {
    const { child } = this.#link.pausedOn("debug.variables");
    const variables = await childrenOf(child, ref, this.#link.notebookRefs);
    return variables.map(cleanVariable(this.#redact));
  }

  async evaluate(expression: string, frameId?: string): Promise<Evaluated> {
    const { child } = await this.#ensure();
    let id: number | undefined;
    if (frameId !== undefined) id = this.#frameOf(frameId);
    else if (this.#link.paused && this.#frames("debug.evaluate").length > 0)
      id = this.#innermost("debug.evaluate");
    return cleanEvaluated(this.#redact, await evaluateIn(child, expression, id));
  }

  /** Before a server cell runs: js-debug attached first when the notebook debugs, so its breakpoints are bound. */
  async beforeRun(): Promise<void> {
    if (!this.#wanted && this.#breakpoints.size() === 0) return;
    const timer = new Promise<void>((resolve) => setTimeout(resolve, attachWaitMs).unref());
    const attached = this.#ensure().then(
      () => undefined,
      (error: unknown) => {
        if (!isJsnbError(error)) this.#link.warn(error, "the debugger did not attach");
      },
    );
    await Promise.race([attached, timer]);
  }

  /** Where and why the kernel is paused: the debugger's stop once it read the stack (a second at most), else what the
   * kernel's inspector said (a `debugger;` statement with no debugger attached). */
  async pauseDetails(): Promise<DebugPause> {
    for (let waited = 0; waited < pauseWaitMs; waited += pausePollMs) {
      const paused = this.#link.paused;
      if (paused) return cleanPause(this.#redact, paused.pause);
      await new Promise((resolve) => setTimeout(resolve, pausePollMs));
    }
    return { reason: "pause", description: "Paused" };
  }

  /** Settles once the debugger is no longer paused, a second at most. */
  async resumed(): Promise<void> {
    for (let waited = 0; this.#link.paused && waited < pauseWaitMs; waited += pausePollMs)
      await new Promise((resolve) => setTimeout(resolve, pausePollMs));
  }

  /** A client cell's breakpoint lines, which become `debugger;` statements for the browser's DevTools. */
  clientLines(cell: CellId): number[] {
    return this.#breakpoints
      .ofCell(cell)
      .filter((each) => each.logMessage === undefined)
      .map((each) => each.line);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#stopListening();
    await this.#link.close();
  }

  /** Waits a little for js-debug to bind `bp` in a cell whose code the kernel has: a run sent right after the answer
   * then stops there. */
  async #bound(bp: { readonly verified: boolean }): Promise<void> {
    for (let waited = 0; !bp.verified && waited < bindWaitMs; waited += pausePollMs)
      await new Promise((resolve) => setTimeout(resolve, pausePollMs));
  }

  #ensure() {
    this.#wanted = true;
    return this.#link.ensure();
  }

  #frames(command: string): DebugFrame[] {
    const { paused } = this.#link.pausedOn(command);
    return framesOf(paused.frames, (path) => this.#link.cellOf(path));
  }

  #innermost(command: string): number {
    const top = this.#frames(command)[0];
    if (top === undefined) throw notFrame("of user code");
    return Number(top.frameId);
  }

  #frameOf(frameId: string): number {
    const id = Number(frameId);
    const { paused } = this.#link.pausedOn("debug.scope");
    if (!paused.frames.some((frame) => frame.id === id)) throw notFrame(frameId);
    return id;
  }

  #heard(event: EventEnvelope): void {
    if (event.type === "kernel.status")
      this.#kernelStatus(event.data.state, event.data.inspectorUrl);
    else if (event.type === "cell.updated")
      this.#edited(event.data.cell.id, event.data.cell.source);
    else if (event.type === "cell.deleted") this.#deleted(event.data.cell);
    else if (event.type === "notebook.moved") this.#moved();
    else if (event.type === "cell.status" && ended.has(event.data.status)) {
      this.#link.runEnded();
      void this.#collectErrors();
    }
  }

  /** A new kernel idle: js-debug attaches to it when the notebook debugs. */
  #kernelStatus(state: string, inspectorUrl: string | null): void {
    if (!this.#wanted || state !== "idle" || inspectorUrl === null) return;
    if (this.#link.attached?.url === inspectorUrl) return;
    this.#ensure().catch((error: unknown) => {
      this.#link.warn(error, "the debugger could not attach to the new kernel");
    });
  }

  #edited(cell: CellId, source: string): void {
    const before = this.#link.sources.get(cell);
    if (before === undefined) return;
    this.#breakpoints.edited(cell, before, source);
    this.#link.sources.set(cell, source);
    this.#link.emitBreakpoints();
    void this.#link.sendCell(cell).then(() => {
      this.#link.emitBreakpoints();
    });
  }

  #deleted(cell: CellId): void {
    const gone = this.#breakpoints.ofCell(cell);
    if (gone.length === 0) return;
    this.#breakpoints.remove(gone);
    this.#link.sources.delete(cell);
    void this.#link.sendCell(cell);
    this.#link.emitBreakpoints();
  }

  /** The notebook's file moved: its cells' paths are the new ref's (the ref changes right after the event), so js-debug
   * gets every list under the new paths and none under the old. */
  #moved(): void {
    const cells = this.#breakpoints.cells();
    const old = cells.map((cell) => this.#link.pathOf(cell));
    const child = this.#link.attached?.child;
    queueMicrotask(() => {
      if (child === undefined || child.closed()) return;
      forgetSources(child, this.#link.held, old);
      for (const cell of cells) void this.#link.sendCell(cell);
    });
  }

  /** The first error each condition or logpoint kept in the kernel since the last read, as its breakpoint's message. */
  async #collectErrors(): Promise<void> {
    const child = this.#link.attached?.child;
    const checked = this.#breakpoints.all().some((each) => each.condition ?? each.logMessage);
    if (!child || !checked || this.#link.paused) return;
    try {
      const kept = Object.entries(await keptErrors(child));
      for (const [id, message] of kept) {
        const record = this.#breakpoints.byId(id);
        if (record) record.message = message;
      }
      if (kept.length > 0) this.#link.emitBreakpoints();
    } catch (error) {
      this.#link.warn(error, "the debugger could not read its conditions' errors");
    }
  }
}
