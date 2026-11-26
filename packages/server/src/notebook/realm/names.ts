// The server side of a client cell's names: which server cell defines or exports a name and its
// 1-based place in the notebook (as the catalogue's messages count cells), the names to snapshot for a client run, and
// those it cannot bind: NotExported for a name a server cell defines without exporting, or that only the kernel still
// holds (its cell deleted or its export removed), KernelRestarted for an export the kernel lost in a restart that its
// cell has not made again. The page ends the run with the first of those it does not resolve itself (realm.execute's
// `unbound`: its built-ins and the names a client cell defined); a server cell's import (`crypto`) is never one.
import type { CellAnalysis, CellId, ErrorInfo } from "@jsnb/core";
import {
  DefinedInClient,
  ExportNotRun,
  KernelRestarted,
  NotExported,
  toErrorInfo,
} from "@jsnb/core";

import type { SessionContext } from "../session/context.js";
import { runError } from "../session/runs/errors.js";
import type { RealmState } from "./state.js";

/** A cell's 1-based place in the notebook, or undefined when it is gone. */
export function placeOf(context: SessionContext, cell: CellId): number | undefined {
  const index = context.cells.order().indexOf(cell);
  return index < 0 ? undefined : index + 1;
}

type Placed = { readonly cell: CellId; readonly index: number };

/** The first cell of `type`, in notebook order, whose current source `has` the name, with its place. */
function firstOf(
  context: SessionContext,
  type: "server" | "client",
  has: (analysis: CellAnalysis) => boolean,
): Placed | undefined {
  const cells = context.cells.list();
  const at = cells.findIndex((record) => record.type === type && has(record.analysis));
  const record = cells[at];
  return record ? { cell: record.id, index: at + 1 } : undefined;
}

const firstServer = (context: SessionContext, has: (analysis: CellAnalysis) => boolean) =>
  firstOf(context, "server", has);

/** The server cell that defines `name` (the first in notebook order), with its place, whether it exports it and
 * whether it binds it by `import`. */
export function serverDefiner(
  context: SessionContext,
  name: string,
): (Placed & { readonly exported: boolean; readonly imported: boolean }) | undefined {
  const found = firstServer(context, (analysis) => analysis.defines.includes(name));
  if (!found) return undefined;
  const { analysis } = context.cells.require(found.cell);
  return {
    ...found,
    exported: analysis.exports.includes(name),
    imported: analysis.kinds[name] === "import",
  };
}

/** The server cell whose current source exports `name` (the first in notebook order), with its place. */
export const serverExporter = (context: SessionContext, name: string): Placed | undefined =>
  firstServer(context, (analysis) => analysis.exports.includes(name));

/**
 * A name a server cell's source exports and the kernel does not hold: KernelRestarted when the kernel lost it in a
 * restart and has not made it since, else ExportNotRun (its cell has not run since the kernel started, ran before the
 * `export` was written, or its run ended before reaching it). Resolution and a held stub's call answer the same.
 */
export const missingExport = (
  state: RealmState,
  name: string,
  exporter: Placed,
): ExportNotRun | KernelRestarted =>
  state.former.some((entry) => entry.name === name)
    ? new KernelRestarted({ name, ...exporter })
    : new ExportNotRun({ name, ...exporter });

/** What a free name of a client cell is: a current export to snapshot, a failure, or none of the server's. */
type NameOutcome =
  | { readonly kind: "export" }
  | { readonly kind: "page" }
  | { readonly kind: "error"; readonly error: NotExported | KernelRestarted | ExportNotRun };

/**
 * A name binds when the kernel holds it as an export and a server cell's current source
 * still exports it. Without that source a definer that does not export it, or the kernel's lingering export, is
 * NotExported; an export the kernel lost in a restart is KernelRestarted until its cell runs again, and one its cell has
 * not made since the kernel started is ExportNotRun. A name a server cell only imports (`import crypto from
 * "node:crypto"`: a library of the server's, which the page has its own of or none) is the page's to resolve, as any
 * other free name.
 */
function outcomeOf(
  context: SessionContext,
  state: RealmState,
  live: ReadonlySet<string>,
  name: string,
): NameOutcome {
  const exporter = serverExporter(context, name);
  if (exporter) {
    if (live.has(name)) return { kind: "export" };
    return { kind: "error", error: missingExport(state, name, exporter) };
  }
  const definer = serverDefiner(context, name);
  if (definer?.imported === true) return { kind: "page" };
  if (definer) {
    const { cell, index } = definer;
    return { kind: "error", error: new NotExported({ name, cell, index }) };
  }
  if (live.has(name)) return { kind: "error", error: new NotExported({ name }) };
  return { kind: "page" };
}

export type Resolution = {
  /** The names to snapshot: current server exports the page's own cells do not define (a client definition wins). */
  readonly names: readonly string[];
  /** The names the daemon cannot bind, with the error the run ends with unless the page resolves them, in use order. */
  readonly unbound: Readonly<Record<string, ErrorInfo>>;
};

/** The client cell `cell`'s free names, as `analysis` lists them, sorted into the two. */
export function resolveNames(
  context: SessionContext,
  state: RealmState,
  cell: CellId,
  analysis: CellAnalysis,
): Resolution {
  const live = new Set(state.exports.map((entry) => entry.name));
  const names: string[] = [];
  const unbound: [string, ErrorInfo][] = [];
  for (const name of analysis.uses) {
    if (state.record.has(name) || analysis.defines.includes(name)) continue;
    const outcome = outcomeOf(context, state, live, name);
    if (outcome.kind === "error") unbound.push([name, runError(outcome.error, cell)]);
    if (outcome.kind === "export") names.push(name);
  }
  return { names, unbound: Object.fromEntries(unbound) };
}

/** The name in the kernel's "x is not defined" (a free name no layer of the scope has). */
const unboundName = (error: ErrorInfo): string | undefined =>
  error.name === "ReferenceError" ? /^(\S+) is not defined$/u.exec(error.message)?.[1] : undefined;

/**
 * A server run of `cell` that ended on a name the kernel does not have, read by `cell` itself, which no server cell's
 * source defines and a client cell does, ends DefinedInClient naming that client cell,
 * the mirror of NotExported, at the place of the read (its frames are kept, so Jump goes there). The kernel's own
 * ReferenceError decides, so a `typeof` guard, a name the kernel still holds, a global a package made or a name inside
 * a function never called never fails; the cell's statements before the read have run. A read in a package or in
 * another cell's function stays the ReferenceError, whose Jump goes to it: switching this cell would not help. Any
 * other error is answered as it is.
 */
export function clientNameError(
  context: SessionContext,
  cell: CellId,
  error: ErrorInfo,
): ErrorInfo {
  const name = unboundName(error);
  if (name === undefined || error.frames[0]?.cell !== cell) return error;
  if (serverDefiner(context, name) !== undefined) return error;
  const client = firstOf(context, "client", (analysis) => analysis.defines.includes(name));
  if (client === undefined) return error;
  const info = toErrorInfo(new DefinedInClient({ name, ...client }), error.frames);
  const stack = error.raw.split("\n").slice(1);
  return { ...info, raw: [`${info.name}: ${info.message}`, ...stack].join("\n") };
}
