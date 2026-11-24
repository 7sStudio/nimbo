// What a session knows of its client realm (03-api §4.5, 05-bridge §3): the attached page (the first attach wins), the
// record of names the page's client cells defined, the server's current exports and those it had before the kernel
// last went, the client runs in flight and those it finished (for their late outputs, 04-kernel §5.3); plus what the
// realm needs from the daemon (redaction, the public env).
import type { CellId, ExecutionId, RealmStatus } from "@jsnb/core";
import type { ExportEntry } from "@jsnb/kernel-node";

import type { ExecutionRecord } from "../session/records.js";

/** The page's socket as the realm uses it; the commands layer's Peer is one. */
export type PageSocket = {
  /** One request of the daemon's own; rejects with the page's error, or when the socket closes or `signal` aborts. */
  readonly request: (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>;
  /** Aborted once the socket closed. */
  readonly closed: AbortSignal;
};

export type Attachment = {
  readonly realmId: string;
  readonly page: PageSocket;
  readonly kind: "tab" | "headless";
  readonly attachedAt: string;
  /** Aborted at detach: the daemon's requests to that page stop waiting. */
  readonly detached: AbortController;
};

export type RealmDeps = {
  /** The daemon's redaction (secrets and the token) for what a page reports (08-code-standards §5). */
  readonly redact: (text: string) => string;
  /** The client's public env, read again per run (04-kernel §8). */
  readonly publicEnv: () => Promise<Readonly<Record<string, string>>>;
};

/** How a client run in flight is stopped, and when it started (`performance.now()`), for its duration. */
type ClientStop = { readonly controller: AbortController; readonly startedAt: number };

export type RealmState = {
  attachment: Attachment | undefined;
  /** Each name the page's client cells defined, with the client cell that defined it last (05-bridge §3). */
  readonly record: Map<string, CellId>;
  /** The server's current exports, from the kernel's `exports` messages (05-bridge §3, step 1). */
  exports: readonly ExportEntry[];
  /** The exports a kernel had when it went (died or restarted) and no kernel made since: a call to one, and a client run
   * using one, is KernelRestarted. */
  former: readonly ExportEntry[];
  /** Each server name a page was sent as a binding since the client realm's last full reset, with the cell that
   * exported it then: the stubs and copies its runs may hold (a page that reconnected keeps them), which a kernel
   * restart turns into KernelRestarted. */
  readonly held: Map<string, CellId>;
  /** The client runs the page is running, by execution, for its reports. */
  readonly running: Map<ExecutionId, ExecutionRecord>;
  /** Each client run in flight: aborted by a kernel.interrupt, the daemon stops waiting for its realm.execute. */
  readonly stops: Map<ExecutionId, ClientStop>;
  /** The client runs the page finished, the last 1 000, for their late outputs, kept across a detach. */
  readonly finished: Set<ExecutionId>;
  /** A reset no page was attached to take (a kernel restart, or Restart all, while the page was away): sent to the
   * next page that attaches, so a page that comes back holds no value of the kernel that went. */
  owed: "bridge" | "all" | undefined;
};

export const createRealmState = (): RealmState => ({
  attachment: undefined,
  record: new Map(),
  exports: [],
  former: [],
  held: new Map(),
  running: new Map(),
  stops: new Map(),
  finished: new Set(),
  owed: undefined,
});

/** The server names a client run is sent as bindings, which the page's runs then hold (a restart lists them). */
export function hold(state: RealmState, names: readonly string[]): void {
  for (const name of names) {
    const entry = state.exports.find((each) => each.name === name);
    if (entry) state.held.set(name, entry.cell);
  }
}

/** The page's record: the names `cell` defines now replace those it defined before (05-bridge §3 step 1). */
export function remember(state: RealmState, cell: CellId, defines: readonly string[]): void {
  for (const [name, owner] of state.record)
    if (owner === cell && !defines.includes(name)) state.record.delete(name);
  for (const name of defines) state.record.set(name, cell);
}

/** How many finished client runs a page can still report late outputs on, as the kernel's interrupted runs (04 §6). */
const maxFinished = 1000;

/** Notes that the page finished the client run `execution`: its late outputs are taken (reports.ts). */
export function noteFinished(state: RealmState, execution: ExecutionId): void {
  state.finished.add(execution);
  for (const oldest of state.finished) {
    if (state.finished.size <= maxFinished) break;
    state.finished.delete(oldest);
  }
}

/** realm.status: whether a page is attached, of which kind, since when. */
export const realmStatusOf = (state: RealmState): RealmStatus =>
  state.attachment
    ? { attached: true, kind: state.attachment.kind, attachedAt: state.attachment.attachedAt }
    : { attached: false, kind: null, attachedAt: null };
