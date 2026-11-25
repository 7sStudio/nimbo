// A session's client realm (02-architecture §2, 03-api §4.5, 05-bridge): the attached page, the client runs it runs,
// its reports, the bridge calls into the kernel and the resets; what the runs need of it (RealmPart) and what the
// realm commands call. The kernel's exports reach it through the session's hooks.
import type {
  BindingValue,
  CellId,
  RealmReport,
  RealmSnapshotAnswer,
  RealmStatus,
} from "@jsnb/core";
import { InvalidParams, undefinedMarker } from "@jsnb/core";
import type { ExportEntry } from "@jsnb/kernel-node";

import type { SessionContext } from "../session/context.js";
import { exportsArrived } from "../session/runs/exportsClock.js";
import type { RealmPart } from "../session/runApi.js";
import { attach, detach } from "./attach.js";
import type { CallAnswer } from "./bridgeCall.js";
import { bridgeCall } from "./bridgeCall.js";
import type { EventChannel } from "./events.js";
import { createEventChannel } from "./events.js";
import type { HeadlessRealm } from "./headless.js";
import { createHeadlessRealm } from "./headless.js";
import type { SnapshotRequest } from "./snapshot.js";
import { snapshotCell } from "./snapshot.js";
import { runClientCell } from "./clientRun.js";
import { interruptClientRun } from "./interrupt.js";
import { applyReport } from "./reports.js";
import { resetRealm } from "./reset.js";
import type { Shot } from "../../kernel/headless/page.js";
import type { PageSocket, RealmDeps, RealmState } from "./state.js";
import { createRealmState, realmStatusOf } from "./state.js";

export type SessionRealm = RealmPart & {
  readonly status: () => RealmStatus;
  /** The notebook moved: a headless page attached under its old name closes. */
  readonly moved: () => void;
  /** realm.headless was turned off: the headless page closes. */
  readonly headlessOff: () => void;
  readonly attach: (
    page: PageSocket,
    kind: "tab" | "headless",
    options?: { readonly takeover?: boolean; readonly key?: string | undefined },
  ) => string;
  readonly detach: (realmId: string) => boolean;
  readonly owns: (realmId: string) => boolean;
  readonly report: (report: RealmReport) => void;
  readonly bridgeCall: (fn: string, args: readonly unknown[]) => Promise<CallAnswer>;
  /** bridge.events: each event name's counts. */
  readonly events: EventChannel["stats"];
  /** cell.snapshot: the client cell's container as the page holding the realm renders it (the headless page started
   * first when needed); with `image`, its PNG from the headless page. */
  readonly snapshot: (request: SnapshotRequest) => Promise<RealmSnapshotAnswer & { image?: Shot }>;
  /** The notebook closes: the page is detached. */
  readonly close: () => void;
};

/** What the daemon knows of a name a client cell defined: it lives in the page (the page reports only names). */
const inThePage = "(defined in the page)";

/** The page's names as bindings, from the record and the defining cells' analyses. */
function bindingsOf(context: SessionContext, state: RealmState, cell?: CellId): BindingValue[] {
  return [...state.record].flatMap(([name, definedBy]) => {
    if (cell !== undefined && definedBy !== cell) return [];
    const kind = context.cells.get(definedBy)?.analysis.kinds[name] ?? "let";
    const binding = { name, kind, preview: inThePage, definedBy, exported: false };
    return [{ ...binding, json: undefinedMarker, repr: inThePage, truncated: false }];
  });
}

/** `entries` without the names `names` lists. */
const without = (entries: readonly ExportEntry[], names: readonly ExportEntry[]): ExportEntry[] =>
  entries.filter((entry) => !names.some((each) => each.name === entry.name));

/** Keeps the kernel's exports, and those a kernel had when it went until a kernel makes them again. */
function hookExports(context: SessionContext, state: RealmState): void {
  context.hooks.exports = (names) => {
    state.exports = names;
    // a name the kernel made again is no longer one a restart lost: losing it now is its cell's run (ExportNotRun)
    state.former = without(state.former, names);
    exportsArrived(context.runs.exports);
  };
  context.hooks.kernelEnded = () => {
    state.former = [...without(state.former, state.exports), ...state.exports];
    state.exports = [];
    exportsArrived(context.runs.exports);
    context.hooks.realmEnded("server");
  };
}

/** Attaches the page; a reset it missed while away goes out once the attach is answered (realm.reset is the daemon's
 * request). Only the session's own headless page attaches as `headless`, its socket counted as use. */
function attachOwing(
  context: SessionContext,
  state: RealmState,
  headless: HeadlessRealm,
  {
    page,
    kind,
    takeover,
    key,
  }: {
    page: PageSocket;
    kind: "tab" | "headless";
    takeover?: boolean | undefined;
    key?: string | undefined;
  },
): string {
  if (kind === "headless" && !headless.expects(key)) {
    const message =
      "only the daemon's own headless page attaches as headless, with the key it was given; a tab attaches as tab";
    throw new InvalidParams({ issues: [{ path: ["kind"], message }] });
  }
  const socket = kind === "headless" ? headless.wrap(page) : page;
  const realmId = attach(context, state, socket, { kind, takeover });
  if (kind === "headless") headless.attached(realmId);
  const owed = state.owed;
  if (owed !== undefined)
    setImmediate(() => {
      if (state.attachment?.realmId === realmId) void resetRealm(context, state, owed === "all");
    });
  return realmId;
}

/** The kernel's push events to the page, and a deleted client cell's cleanups in the page. */
function hookEvents(context: SessionContext, state: RealmState): EventChannel {
  const events = createEventChannel(context, state);
  context.hooks.events = events.take;
  context.hooks.pageAttached = () => state.attachment !== undefined;
  context.hooks.disposeClient = (cell) => {
    state.attachment?.page.request("realm.dispose", { cell }).catch((error: unknown) => {
      context.log.debug({ err: error, cell }, "the page did not take realm.dispose");
    });
  };
  return events;
}

/** The session's headless realm, closed with the page it attached. */
function headlessOf(context: SessionContext, state: RealmState, deps: RealmDeps): HeadlessRealm {
  const headless = createHeadlessRealm(context, state, deps.headless, (realmId, why) => {
    detach(context, state, realmId, { why });
  });
  state.onDetach = (attachment) => {
    headless.detached(attachment.realmId);
  };
  state.onUnresponsive = () => {
    if (state.attachment?.kind === "headless") headless.unresponsive();
  };
  return headless;
}

/** What the page and the realm commands call: attach and detach, reports, bridge calls, snapshots, the close. */
function pageSide(
  context: SessionContext,
  state: RealmState,
  deps: RealmDeps,
  headless: HeadlessRealm,
) {
  const fromHeadless = (): void => {
    if (state.attachment?.kind === "headless") headless.touch();
  };
  return {
    attach: (
      page: PageSocket,
      kind: "tab" | "headless",
      options: { readonly takeover?: boolean; readonly key?: string | undefined } = {},
    ) => attachOwing(context, state, headless, { page, kind, ...options }),
    moved: headless.moved,
    headlessOff: headless.turnedOff,
    detach: (realmId: string) => detach(context, state, realmId),
    owns: (realmId: string) => state.attachment?.realmId === realmId,
    report: (report: RealmReport) => {
      fromHeadless();
      applyReport(context, state, deps, report);
    },
    bridgeCall: (fn: string, args: readonly unknown[]) => {
      fromHeadless();
      return bridgeCall(context, state, fn, args);
    },
    snapshot: async (request: SnapshotRequest) => {
      await headless.ensure();
      return snapshotCell(context, state, deps, { request, headless: headless.page() });
    },
    close: () => {
      headless.close();
      if (state.attachment) detach(context, state, state.attachment.realmId);
    },
  };
}

export function createRealm(context: SessionContext, deps: RealmDeps): SessionRealm {
  const state = createRealmState();
  hookExports(context, state);
  const events = hookEvents(context, state);
  const headless = headlessOf(context, state, deps);
  return {
    attached: () => state.attachment !== undefined,
    available: headless.available,
    ensure: headless.ensure,
    run: (execution) => runClientCell(context, state, deps, { execution, ensure: headless.ensure }),
    bindings: (cell) => bindingsOf(context, state, cell),
    scope: () =>
      bindingsOf(context, state).map(({ name, kind, preview, definedBy, exported }) => ({
        name,
        kind,
        preview,
        definedBy,
        exported,
      })),
    reset: (all) => resetRealm(context, state, all),
    runs: (execution) => state.running.has(execution),
    interrupt: (execution) => interruptClientRun(context, state, deps, execution),
    status: () => realmStatusOf(state),
    events: events.stats,
    ...pageSide(context, state, deps, headless),
  };
}
