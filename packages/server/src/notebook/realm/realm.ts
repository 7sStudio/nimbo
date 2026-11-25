// A session's client realm (02-architecture §2, 03-api §4.5, 05-bridge): the attached page, the client runs it runs,
// its reports, the bridge calls into the kernel and the resets; what the runs need of it (RealmPart) and what the
// realm commands call. The kernel's exports reach it through the session's hooks.
import type { BindingValue, CellId, RealmReport, RealmStatus } from "@jsnb/core";
import { undefinedMarker } from "@jsnb/core";
import type { ExportEntry } from "@jsnb/kernel-node";

import type { SessionContext } from "../session/context.js";
import { exportsArrived } from "../session/runs/exportsClock.js";
import type { RealmPart } from "../session/runApi.js";
import { attach, detach } from "./attach.js";
import type { CallAnswer } from "./bridgeCall.js";
import { bridgeCall } from "./bridgeCall.js";
import { runClientCell } from "./clientRun.js";
import { interruptClientRun } from "./interrupt.js";
import { applyReport } from "./reports.js";
import { resetRealm } from "./reset.js";
import type { PageSocket, RealmDeps, RealmState } from "./state.js";
import { createRealmState, realmStatusOf } from "./state.js";

export type SessionRealm = RealmPart & {
  readonly status: () => RealmStatus;
  readonly attach: (page: PageSocket, kind: "tab" | "headless", takeover?: boolean) => string;
  readonly detach: (realmId: string) => boolean;
  readonly owns: (realmId: string) => boolean;
  readonly report: (report: RealmReport) => void;
  readonly bridgeCall: (fn: string, args: readonly unknown[]) => Promise<CallAnswer>;
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

export function createRealm(context: SessionContext, deps: RealmDeps): SessionRealm {
  const state = createRealmState();
  hookExports(context, state);
  return {
    attached: () => state.attachment !== undefined,
    run: (execution) => runClientCell(context, state, deps, execution),
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
    attach: (page, kind, takeover) => {
      const realmId = attach(context, state, page, { kind, takeover });
      // a reset the page missed while away goes out once the attach is answered (realm.reset is the daemon's request)
      const owed = state.owed;
      if (owed !== undefined)
        setImmediate(() => {
          if (state.attachment?.realmId === realmId)
            void resetRealm(context, state, owed === "all");
        });
      return realmId;
    },
    detach: (realmId) => detach(context, state, realmId),
    owns: (realmId) => state.attachment?.realmId === realmId,
    report: (report) => {
      applyReport(context, state, deps, report);
    },
    bridgeCall: (fn, args) => bridgeCall(context, state, fn, args),
    close: () => {
      if (state.attachment) detach(context, state, state.attachment.realmId);
    },
  };
}
