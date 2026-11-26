// One notebook's debugger (03-api §4.9): its breakpoints, and js-debug on each realm: on the kernel from the first debug
// command (and again after each restart, before the next run), on the headless page holding the client realm before a
// client run that may stop (breakpoints of client cells, a debug command used, a `debugger` in the cell). Each realm
// pauses on its own; the commands act on the latest pause, or the realm they name. Every string they answer goes
// through the daemon's redaction. It follows the notebook's events: a cell's edit moves its breakpoints, a deletion
// removes them, a move of the file sends them under the new paths, a run's end reads the errors its conditions kept,
// the realm's attach and detach end the page's session and say why a client cell's breakpoint cannot bind.
import type {
  Breakpoint,
  CellId,
  DebugFrame,
  DebugPause,
  DebugRealm,
  DebugScope,
  DebugState,
  DebugStatus,
  DebugVariable,
  EventEnvelope,
} from "@jsnb/core";
import { InvalidParams, isJsnbError, NotAvailable } from "@jsnb/core";

import type { Adapter } from "../../kernel/debug/adapter.js";
import type { GuardedPage } from "../../kernel/headless/page.js";
import type { PauseClock } from "../../kernel/pauses.js";
import { createPauseClock } from "../../kernel/pauses.js";
import { dap } from "../../kernel/debug/protocol.js";
import type { SessionContext } from "../session/context.js";
import type { BreakpointOptions, BreakpointRecord, Where } from "./breakpoints.js";
import { Breakpoints, codeLineFrom } from "./breakpoints.js";
import { keptErrors } from "./conditions.js";
import type { Evaluated } from "./inspect.js";
import { childrenOf, evaluateIn, framesOf, scopesOf } from "./inspect.js";
import { JsDebugLink } from "./link.js";
import type { Redact } from "./redaction.js";
import {
  cleanBreakpoint,
  cleanEvaluated,
  cleanFrame,
  cleanPause,
  cleanScope,
  cleanVariable,
} from "./redaction.js";
import { forgetSources } from "./sends.js";
import { kernelTarget, pageTarget } from "./target.js";

/** What the debugger knows of the client realm: the headless page holding it, which kind of page holds it, and
 * whether a headless page can. */
export type DebugRealmView = {
  readonly page: () => GuardedPage | undefined;
  readonly kind: () => "tab" | "headless" | undefined;
  readonly headlessOn: () => boolean;
};

export type DebugDeps = {
  readonly adapter: Adapter;
  /** Hears every event of the daemon (the bus's listen); returns the stop. */
  readonly listen: (listener: (event: EventEnvelope) => void) => () => void;
  /** The daemon's redaction: every string the debugger answers or emits goes through it. */
  readonly redact: Redact;
  readonly realm: DebugRealmView;
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
/** How long setBreakpoint waits for the bind in code the realm already has. */
const bindWaitMs = 1_500;

const stepRequests = {
  resume: "continue",
  stepOver: "next",
  stepInto: "stepIn",
  stepOut: "stepOut",
} as const;

/** Why a client cell's breakpoint cannot bind now. */
const reasons = {
  tab: "A tab holds the client realm: nimbo stops in client cells only in its headless page (the line is a debugger; statement for the tab's DevTools).",
  noHeadless:
    "realm.headless is off: client cells stop only in the daemon's headless page (realm.headless on, no tab holding the notebook).",
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A wait for `work` of `ms` at most; a failure that is none of nimbo's is logged by `warn`. */
async function bounded(work: Promise<unknown>, ms: number, warn: (error: unknown) => void) {
  const timer = new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
  const done = work.then(
    () => undefined,
    (error: unknown) => {
      if (!isJsnbError(error)) warn(error);
    },
  );
  await Promise.race([done, timer]);
}

export class DebugSession {
  readonly #context: SessionContext;
  readonly #redact: Redact;
  readonly #realm: DebugRealmView;
  readonly #breakpoints = new Breakpoints();
  readonly #links: Readonly<Record<DebugRealm, JsDebugLink>>;
  readonly #stopListening: () => void;
  /** The time the headless page spends paused, which a caller's wait for a run does not count. */
  readonly #pagePauses = createPauseClock();
  /** Set once a debug command used the debugger: it attaches again after a restart, and to the next headless page. */
  #wanted = false;
  #closed = false;
  #pauses = 0;

  constructor(context: SessionContext, deps: DebugDeps) {
    this.#context = context;
    this.#redact = deps.redact;
    this.#realm = deps.realm;
    const shared = {
      adapter: deps.adapter,
      sources: new Map<CellId, string>(),
      redact: deps.redact,
      breakpoints: this.#breakpoints,
      changed: () => {
        this.#emitBreakpoints();
      },
      nextPause: () => (this.#pauses += 1),
    };
    this.#links = {
      server: new JsDebugLink(context, { ...shared, target: kernelTarget(context) }),
      client: new JsDebugLink(context, {
        ...shared,
        target: pageTarget(deps.realm.page),
        onPaused: (paused) => {
          this.#pagePauses.set(paused);
        },
      }),
    };
    this.#stopListening = deps.listen((event) => {
      if (!this.#closed && event.notebook === context.ref) this.#heard(event);
    });
  }

  /** The headless page's time paused in the debugger. */
  get pagePauses(): PauseClock {
    return this.#pagePauses;
  }

  state(): DebugState {
    const status = (link: JsDebugLink): DebugStatus =>
      link.paused ? "paused" : link.attached ? "running" : "off";
    const realms = { server: status(this.#links.server), client: status(this.#links.client) };
    const pauses = this.#paused().map((stop) => cleanPause(this.#redact, stop.pause));
    const attached = realms.server !== "off" || realms.client !== "off";
    const state = pauses.length > 0 ? "paused" : attached ? "running" : "off";
    return { state, paused: pauses[0] ?? null, pauses, realms, breakpoints: this.#list() };
  }

  async setBreakpoint(cell: CellId, line: number, options: BreakpointOptions): Promise<Breakpoint> {
    const record = this.#context.cells.require(cell);
    // a blank or comment line has nothing to stop on: the breakpoint goes on the next line with code, as V8 would
    const at = codeLineFrom(record.source, line);
    const created = !this.#breakpoints.ofCell(cell).some((each) => each.line === at);
    const bp = this.#breakpoints.set(cell, at, options);
    const realm: DebugRealm = record.type === "client" ? "client" : "server";
    const link = this.#links[realm];
    link.sources.set(cell, record.source);
    if (record.type === "server") {
      const refused = await this.#ensure("server").then(
        () => undefined,
        // a kernel that is dead or starting: the breakpoint binds once one runs; no js-debug at all refuses it
        (error: unknown) => (error instanceof NotAvailable && !link.attached ? error : undefined),
      );
      if (refused) {
        if (created) this.#breakpoints.remove([bp]);
        throw refused;
      }
    } else if (record.type === "client" && this.#headless()) {
      // the headless page holds the realm: js-debug attaches to it now; with none, it binds as the page starts
      await this.#ensure("client").catch((error: unknown) => {
        if (!isJsnbError(error)) link.warn(error, "the debugger did not attach to the page");
      });
    }
    if (record.type === "server" || record.type === "client") {
      await link.sendCell(cell);
      if (record.last !== undefined && link.attached) await this.#bound(bp);
    }
    this.#emitBreakpoints();
    const now = this.#list().find((each) => each.breakpointId === bp.breakpointId);
    return now ?? { breakpointId: bp.breakpointId, cell, line: bp.line, realm, verified: false };
  }

  async removeBreakpoints(which: Removal): Promise<number> {
    const gone = this.#breakpoints.all().filter((each) => named(which, each));
    if (gone.length === 0) return 0;
    this.#breakpoints.remove(gone);
    const cells = [...new Set(gone.map((each) => each.cell))];
    await Promise.all(cells.map((cell) => this.#sendCell(cell)));
    this.#emitBreakpoints();
    return gone.length;
  }

  async control(verb: Control, realm?: DebugRealm): Promise<void> {
    if (verb !== "pause") {
      const request = dap[stepRequests[verb]];
      const link = this.#pausedLink(`debug.${verb}`, realm);
      await link.step((child, threadId) => request(child, { threadId }), `debug.${verb}`);
      return;
    }
    const target = realm ?? "server";
    const { child } = await this.#ensure(target);
    if (this.#links[target].paused) return;
    const { threads } = await dap.threads(child, {});
    await dap.pause(child, { threadId: threads[0]?.id ?? 0 });
  }

  stack(realm?: DebugRealm): { realm: DebugRealm; frames: DebugFrame[] } {
    const link = this.#pausedLink("debug.stack", realm);
    return {
      realm: link.realm,
      frames: this.#frames(link, "debug.stack").map(cleanFrame(this.#redact)),
    };
  }

  /** The scopes of frame `frameId`, the innermost by default. */
  async scopes(
    frameId?: string,
    realm?: DebugRealm,
  ): Promise<{ realm: DebugRealm; scopes: DebugScope[] }> {
    const link = this.#pausedLink("debug.scope", realm);
    const { child } = link.pausedOn("debug.scope");
    const id =
      frameId === undefined
        ? this.#innermost(link, "debug.scope")
        : this.#frameOf(link, frameId, "debug.scope");
    const context = { notebookRefs: link.notebookRefs, dialect: link.dialect };
    const scopes = await scopesOf(child, id, context);
    return { realm: link.realm, scopes: scopes.map(cleanScope(this.#redact)) };
  }

  async variables(
    ref: number,
    realm?: DebugRealm,
  ): Promise<{ realm: DebugRealm; variables: DebugVariable[] }> {
    const link = this.#pausedLink("debug.variables", realm);
    const { child } = link.pausedOn("debug.variables");
    const variables = await childrenOf(child, ref, link.notebookRefs);
    return { realm: link.realm, variables: variables.map(cleanVariable(this.#redact)) };
  }

  /** In a frame of the paused realm (or the one named), else in the notebook's scope of the realm named, the kernel by
   * default. */
  async evaluate(
    expression: string,
    frameId?: string,
    realm?: DebugRealm,
  ): Promise<Evaluated & { realm: DebugRealm }> {
    const target = realm ?? this.#latest()?.realm ?? "server";
    const link = this.#links[target];
    const { child } = await this.#ensure(target);
    let id: number | undefined;
    if (frameId !== undefined) id = this.#frameOf(link, frameId, "debug.evaluate");
    else if (link.paused && this.#frames(link, "debug.evaluate").length > 0)
      id = this.#innermost(link, "debug.evaluate");
    const answer = await evaluateIn(child, expression, { frameId: id, dialect: link.dialect });
    return { realm: target, ...cleanEvaluated(this.#redact, answer) };
  }

  /** Before a server cell runs: js-debug attached first when the notebook debugs, so its breakpoints are bound. */
  async beforeRun(): Promise<void> {
    if (!this.#wanted && this.#breakpoints.size() === 0) return;
    await bounded(this.#ensure("server"), attachWaitMs, (error) => {
      this.#links.server.warn(error, "the debugger did not attach");
    });
  }

  /** Before a client cell runs in the headless page: js-debug attached to it first when the run may stop there (a
   * client cell's breakpoint, a debug command used, a `debugger` in the cell). */
  async beforeClientRun(cell: CellId): Promise<void> {
    if (!this.#headless()) return;
    const source = this.#context.cells.get(cell)?.source ?? "";
    const clientBreakpoints = this.#breakpoints
      .all()
      .some((each) => this.#links.client.owns(each.cell));
    if (!this.#wanted && !clientBreakpoints && !/\bdebugger\b/u.test(source)) return;
    await bounded(this.#links.client.ensure(), attachWaitMs, (error) => {
      this.#links.client.warn(error, "the debugger did not attach to the page");
    });
  }

  /** Where and why a realm is paused: the debugger's latest stop once it read the stack (a second at most), else what
   * the kernel's inspector said (a `debugger;` statement with no debugger attached). */
  async pauseDetails(): Promise<DebugPause> {
    for (let waited = 0; waited < pauseWaitMs; waited += pausePollMs) {
      const latest = this.#paused()[0];
      if (latest) return cleanPause(this.#redact, latest.pause);
      await wait(pausePollMs);
    }
    return { realm: "server", reason: "pause", description: "Paused" };
  }

  /** Settles once the debugger no longer shows the kernel paused, a second at most. */
  async resumed(): Promise<void> {
    for (let waited = 0; this.#links.server.paused && waited < pauseWaitMs; waited += pausePollMs)
      await wait(pausePollMs);
  }

  /** Whether the headless page is paused in the debugger. */
  pagePaused(): boolean {
    return this.#links.client.paused !== undefined;
  }

  /** Whether js-debug holds the headless page for breakpoints of client cells: its idle close waits. */
  pageDebugged(): boolean {
    const client = this.#links.client;
    return (
      client.paused !== undefined ||
      (client.attached !== undefined &&
        this.#breakpoints.all().some((each) => client.owns(each.cell)))
    );
  }

  /** A request the page must answer (a reset, an interrupt) is about to go to it: a page paused in the debugger ends
   * what it paused in (as an interrupt ends a paused kernel's run) and resumes, so it can answer; the cell it was paused
   * in, whose run then never answers. */
  async releasePage(): Promise<CellId | undefined> {
    const client = this.#links.client;
    const paused = client.paused;
    if (!paused) return undefined;
    this.#realm.page()?.terminate();
    await client
      .step((child, threadId) => dap.continue(child, { threadId }), "debug.resume")
      .catch(() => undefined);
    return paused.pause.cell;
  }

  /** The headless page is about to close: js-debug leaves it first, so a paused page resumes and can close. */
  pageClosing(): void {
    this.#links.client.release();
  }

  /** A client cell's breakpoint lines, which become `debugger;` statements for a tab's DevTools; none in the headless
   * page, where js-debug binds them. */
  clientLines(cell: CellId): number[] {
    if (this.#realm.kind() === "headless") return [];
    return this.#breakpoints
      .ofCell(cell)
      .filter((each) => each.logMessage === undefined)
      .map((each) => each.line);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#stopListening();
    await Promise.all([this.#links.server.close(), this.#links.client.close()]);
  }

  #headless(): boolean {
    return this.#realm.kind() === "headless" && this.#realm.page() !== undefined;
  }

  /** Why a breakpoint's cell cannot bind it now, and its realm. */
  #where(record: BreakpointRecord): Where {
    const type = this.#context.cells.get(record.cell)?.type;
    if (type !== "client") return { realm: "server" };
    if (record.verified) return { realm: "client" };
    const kind = this.#realm.kind();
    if (kind === "tab") return { realm: "client", reason: reasons.tab };
    if (kind === undefined && !this.#realm.headlessOn())
      return { realm: "client", reason: reasons.noHeadless };
    return { realm: "client" };
  }

  #list(): Breakpoint[] {
    return this.#breakpoints
      .list((record) => this.#where(record))
      .map(cleanBreakpoint(this.#redact));
  }

  #emitBreakpoints(): void {
    this.#context.emit("debug.breakpoints", { breakpoints: this.#list() });
  }

  /** The paused links' stops, the latest first. */
  #paused() {
    return [this.#links.server.paused, this.#links.client.paused]
      .filter((each) => each !== undefined)
      .sort((a, b) => b.order - a.order);
  }

  #latest(): JsDebugLink | undefined {
    const top = this.#paused()[0];
    return top === undefined ? undefined : this.#links[top.pause.realm];
  }

  /** The link of `realm`, else of the latest pause; NotPaused for `command` when it is not paused. */
  #pausedLink(command: string, realm?: DebugRealm): JsDebugLink {
    const link = realm === undefined ? this.#latest() : this.#links[realm];
    const own = link ?? this.#links.server;
    own.pausedOn(command);
    return own;
  }

  /** Waits a little for js-debug to bind `bp` in a cell whose code the realm has: a run sent right after the answer
   * then stops there. */
  async #bound(bp: { readonly verified: boolean }): Promise<void> {
    for (let waited = 0; !bp.verified && waited < bindWaitMs; waited += pausePollMs)
      await wait(pausePollMs);
  }

  #ensure(realm: DebugRealm) {
    this.#wanted = true;
    return this.#links[realm].ensure();
  }

  #sendCell(cell: CellId): Promise<void> {
    return Promise.all([this.#links.server.sendCell(cell), this.#links.client.sendCell(cell)]).then(
      () => undefined,
    );
  }

  #frames(link: JsDebugLink, command: string): DebugFrame[] {
    const { paused } = link.pausedOn(command);
    return framesOf(paused.frames, (path) => link.cellOf(path));
  }

  #innermost(link: JsDebugLink, command: string): number {
    const top = this.#frames(link, command)[0];
    if (top === undefined) throw notFrame("of user code");
    return Number(top.frameId);
  }

  #frameOf(link: JsDebugLink, frameId: string, command: string): number {
    const id = Number(frameId);
    const { paused } = link.pausedOn(command);
    if (!paused.frames.some((frame) => frame.id === id)) throw notFrame(frameId);
    return id;
  }

  #heard(event: EventEnvelope): void {
    if (event.type === "kernel.status")
      this.#kernelStatus(event.data.state, event.data.inspectorUrl);
    else if (event.type === "realm.status") this.#realmStatus();
    else if (event.type === "cell.updated")
      this.#edited(event.data.cell.id, event.data.cell.source);
    else if (event.type === "cell.deleted") this.#deleted(event.data.cell);
    else if (event.type === "notebook.moved") this.#moved();
    else if (event.type === "cell.status" && ended.has(event.data.status)) {
      const type = this.#context.cells.get(event.data.cell)?.type;
      const link = this.#links[type === "client" ? "client" : "server"];
      link.runEnded();
      void this.#collectErrors(link);
    }
  }

  /** A new kernel idle: js-debug attaches to it when the notebook debugs. */
  #kernelStatus(state: string, inspectorUrl: string | null): void {
    const server = this.#links.server;
    if (!this.#wanted || state !== "idle" || inspectorUrl === null) return;
    if (server.attached?.opened.id === inspectorUrl) return;
    this.#ensure("server").catch((error: unknown) => {
      server.warn(error, "the debugger could not attach to the new kernel");
    });
  }

  /** A page attached or left: js-debug leaves a headless page that no longer holds the realm, and the client cells'
   * breakpoints say why they cannot bind. */
  #realmStatus(): void {
    const client = this.#links.client;
    if (client.attached && !this.#headless()) client.release();
    this.#emitBreakpoints();
  }

  #edited(cell: CellId, source: string): void {
    const { sources } = this.#links.server;
    const before = sources.get(cell);
    if (before === undefined) return;
    this.#breakpoints.edited(cell, before, source);
    sources.set(cell, source);
    this.#emitBreakpoints();
    void this.#sendCell(cell).then(() => {
      this.#emitBreakpoints();
    });
  }

  #deleted(cell: CellId): void {
    const gone = this.#breakpoints.ofCell(cell);
    if (gone.length === 0) return;
    this.#breakpoints.remove(gone);
    this.#links.server.sources.delete(cell);
    void this.#sendCell(cell);
    this.#emitBreakpoints();
  }

  /** The notebook's file moved: its cells' paths are the new ref's (the ref changes right after the event), so js-debug
   * gets every list under the new paths and none under the old. */
  #moved(): void {
    const cells = this.#breakpoints.cells();
    for (const link of [this.#links.server, this.#links.client]) {
      const old = cells.map((cell) => link.pathOf(cell));
      const child = link.attached?.child;
      queueMicrotask(() => {
        if (child === undefined || child.closed()) return;
        forgetSources(child, link.held, old);
        for (const cell of cells) void link.sendCell(cell);
      });
    }
  }

  /** The first error each condition or logpoint kept in the realm since the last read, as its breakpoint's message. */
  async #collectErrors(link: JsDebugLink): Promise<void> {
    const child = link.attached?.child;
    const checked = this.#breakpoints
      .all()
      .some((each) => link.owns(each.cell) && (each.condition ?? each.logMessage));
    if (!child || !checked || link.paused) return;
    try {
      const kept = Object.entries(await keptErrors(child, link.dialect));
      for (const [id, message] of kept) {
        const record = this.#breakpoints.byId(id);
        if (record) record.message = message;
      }
      if (kept.length > 0) this.#emitBreakpoints();
    } catch (error) {
      link.warn(error, "the debugger could not read its conditions' errors");
    }
  }
}
