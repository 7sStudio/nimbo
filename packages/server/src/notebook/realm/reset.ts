// The page's resets (03-api §4.4, §4.5, 05-bridge §8): after a kernel restart, realm.reset { bridge } maps each export
// the kernel had to its defining cell and place, so the page's stubs and snapshots of them fail KernelRestarted until
// their client cell re-runs (client definitions survive); with `all` (and realm.restart), realm.reset {} resets the
// client realm and every client cell is idle again with no outputs, which subscribers see as cell.updated. A client run
// not yet sent to the page then ends `interrupted` before the reset goes out, so none reaches the fresh realm.
import type { CellId } from "@jsnb/core";

import type { SessionContext } from "../session/context.js";
import { stopClientRun } from "./interrupt.js";
import { placeOf, serverExporter } from "./names.js";
import type { RealmState } from "./state.js";

/** Every name a server cell's source exports, with that cell, in notebook order. */
const sourceExports = (context: SessionContext): readonly (readonly [string, CellId])[] =>
  context.cells
    .list()
    .filter((record) => record.type === "server")
    .flatMap((record) => record.analysis.exports.map((name) => [name, record.id] as const));

/**
 * Each server name the page's runs may hold (sent as a binding since its realm was fresh, or an export a kernel had when
 * it went), with the server cell to run again and its place: the one whose source exports it now, else the cell it came
 * from while that is there, and every export of a server cell's source. The page drops a name the map leaves out, so
 * it lists every one it can name a cell for.
 */
function bridgeMap(
  context: SessionContext,
  state: RealmState,
): Record<string, { readonly cell: CellId; readonly index: number }> {
  const names = new Map(state.held);
  for (const { name, cell } of state.former) if (!names.has(name)) names.set(name, cell);
  // a page may hold stubs this session never sent (the notebook closed and opened again under it): every name a
  // server cell's source exports is listed too, so such a stub reads KernelRestarted, not ReferenceError
  for (const [name, cell] of sourceExports(context)) if (!names.has(name)) names.set(name, cell);
  return Object.fromEntries(
    [...names].flatMap(([name, from]) => {
      const exporter = serverExporter(context, name);
      if (exporter) return [[name, exporter]];
      const index = placeOf(context, from);
      return index === undefined ? [] : [[name, { cell: from, index }]];
    }),
  );
}

/** The client runs still taking the kernel's snapshot (realm.execute not sent: `running` is set as it goes) end
 * `interrupted`; the page's own runs are the reset's to drop. */
function endUnsent(context: SessionContext, state: RealmState): void {
  for (const execution of state.running.values())
    if (execution.status !== "running") stopClientRun(context, state, execution);
}

/** Every client cell idle with no outputs, the page's record and what it held forgotten. */
function clearClientCells(context: SessionContext, state: RealmState): void {
  context.hooks.realmEnded("client");
  state.record.clear();
  state.held.clear();
  for (const record of context.cells.list()) {
    if (record.type !== "client" || !record.last) continue;
    context.runs.retained.drop(record.last.id);
    record.last = undefined;
    record.status = "idle";
    context.emit("cell.updated", { cell: context.cells.api(record) });
  }
}

/** Sends realm.reset to the attached page; a page that does not take it is logged, the reset stands on the daemon. */
export async function resetRealm(
  context: SessionContext,
  state: RealmState,
  all: boolean,
): Promise<void> {
  if (all) {
    endUnsent(context, state);
    clearClientCells(context, state);
  }
  const attachment = state.attachment;
  if (!attachment) {
    state.owed = all || state.owed === "all" ? "all" : "bridge";
    return;
  }
  state.owed = undefined;
  const params = all ? {} : { bridge: bridgeMap(context, state) };
  if (attachment.kind === "headless") await context.hooks.pageDebug.release();
  const signal = AbortSignal.any([
    AbortSignal.timeout(context.requestTimeoutMs),
    attachment.detached.signal,
  ]);
  try {
    await attachment.page.request("realm.reset", params, signal);
  } catch (error) {
    context.log.warn({ err: error }, "the page did not take realm.reset");
    if (!attachment.detached.signal.aborted) state.onUnresponsive?.();
  }
}
