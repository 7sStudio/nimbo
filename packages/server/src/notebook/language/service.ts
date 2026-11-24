// The daemon's language service: snapshots of a notebook's code cells sent to the
// worker with each request, the transform's refusals merged into the diagnostics, rename applied through the session.
import type { BridgeExport, CellDiagnostics, CellId, CellPosition, Diagnostic } from "@jsnb/core";
import { InvalidParams, LanguageUnavailable, RenameRefused } from "@jsnb/core";
import type { Hover, RenameResult } from "@jsnb/language";

import type { Editor } from "../session/provenance.js";
import { analysisOf } from "../session/analysis.js";
import type { Session } from "../session/session.js";
import { analysisDiagnostics } from "./analysisDiagnostics.js";
import { bridgeOf } from "./bridge.js";
import type { QueryName, Snapshot } from "./protocol.js";
import type { LanguageWorker } from "./spawn.js";

export type LanguageDeps = {
  readonly session: (notebook: string) => Promise<Session>;
  readonly worker: LanguageWorker;
  /** `.env` names, and the public ones a client cell sees. */
  readonly envNames: () => Promise<{
    readonly server: readonly string[];
    readonly client: readonly string[];
  }>;
  readonly intellisense: () => boolean;
};

/** A socket's open documents by cell, laid over the session's sources. */
type Overlay = ReadonlyMap<CellId, string>;

export type LanguageCalls = {
  readonly diagnostics: (notebook: string, cell?: CellId) => Promise<readonly CellDiagnostics[]>;
  readonly query: (
    notebook: string,
    request: { readonly query: QueryName; readonly cell: CellId; readonly position: CellPosition },
    overlay?: Overlay,
  ) => Promise<unknown>;
  readonly rename: (
    request: {
      readonly notebook: string;
      readonly cell?: CellId | undefined;
      readonly position?: CellPosition | undefined;
      /** The name to rename instead of a position: its first place the language service accepts. */
      readonly name?: string | undefined;
      readonly newName: string;
    },
    editor: Editor,
  ) => Promise<readonly CellId[]>;
  /** notebook.bridge: the server cells' exports with TypeScript's signatures and their client callers. */
  readonly bridge: (notebook: string) => Promise<readonly BridgeExport[]>;
  readonly close: (notebook: string) => Promise<void>;
  /** Builds every project again on its next request (after an install). */
  readonly reset: () => Promise<void>;
};

const isRefused = (result: RenameResult): result is { readonly refused: string } =>
  "refused" in result;

function isRenameResult(value: unknown): value is RenameResult {
  return typeof value === "object" && value !== null && ("edits" in value || "refused" in value);
}

function isDiagnosticsList(value: unknown): value is readonly CellDiagnostics[] {
  return Array.isArray(value);
}

/** The notebook's code cells as the session holds them, a socket's open documents laid over them. */
async function snapshotOf(
  deps: LanguageDeps,
  notebook: string,
  overlay?: Overlay,
): Promise<Snapshot> {
  const session = await deps.session(notebook);
  const cells = session
    .state()
    .cells.filter((cell) => cell.type !== "markdown")
    .map((cell) => ({
      id: cell.id,
      type: cell.type === "client" ? ("client" as const) : ("server" as const),
      source: overlay?.get(cell.id) ?? cell.source,
    }));
  return { notebook, cells, env: await deps.envNames() };
}

/** TypeScript's diagnostics from the worker, each cell's transform refusal first. */
async function diagnosticsOf(
  deps: LanguageDeps,
  notebook: string,
  cell: CellId | undefined,
): Promise<readonly CellDiagnostics[]> {
  const taken = await snapshotOf(deps, notebook);
  const task = { op: "diagnostics", snapshot: taken, ...(cell ? { cell } : {}) } as const;
  const value = await deps.worker.request(task);
  const refusals = new Map<CellId, Diagnostic[]>(
    taken.cells.map((each) => [each.id, analysisDiagnostics(each.type, each.source)]),
  );
  return (isDiagnosticsList(value) ? value : []).map((entry) => ({
    cell: entry.cell,
    diagnostics: [...(refusals.get(entry.cell) ?? []), ...entry.diagnostics],
  }));
}

/** The most places of a name a rename by `name` tries in one cell (a comment or a string may hold it first). */
const triedPlaces = 20;

/** The 0-based positions where `name` stands as a whole word in `source`, in order. */
function placesOf(source: string, name: string): CellPosition[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const word = new RegExp(`(?<![\\p{ID_Continue}$])${escaped}(?![\\p{ID_Continue}$])`, "gu");
  const places: CellPosition[] = [];
  source.split("\n").forEach((text, line) => {
    for (const match of text.matchAll(word)) places.push({ line, character: match.index });
  });
  return places.slice(0, triedPlaces);
}

/**
 * The cells a rename by `name` looks in: `cell` when given, else the cells that declare the name at top level (the
 * transform's analysis), else every cell that holds it.
 */
function cellsFor(taken: Snapshot, name: string, cell: CellId | undefined): Snapshot["cells"] {
  if (cell !== undefined) return taken.cells.filter((each) => each.id === cell);
  const declaring = taken.cells.filter((each) =>
    analysisOf(each.type, each.source).defines.includes(name),
  );
  return declaring.length > 0
    ? declaring
    : taken.cells.filter((each) => placesOf(each.source, name).length > 0);
}

type RenameAt = {
  readonly cell: CellId;
  readonly position: CellPosition;
  readonly newName: string;
};

/** The worker's edits for a rename by `name`: the first place of it (in a cell that declares it) it accepts. */
async function editsByName(
  deps: LanguageDeps,
  taken: Snapshot,
  request: { readonly cell?: CellId | undefined; readonly name: string; readonly newName: string },
): Promise<unknown> {
  let refused: unknown;
  for (const each of cellsFor(taken, request.name, request.cell)) {
    for (const position of placesOf(each.source, request.name)) {
      const at: RenameAt = { cell: each.id, position, newName: request.newName };
      const value = await deps.worker.request({ op: "rename", snapshot: taken, ...at });
      if (isRenameResult(value) && !isRefused(value)) return value;
      refused ??= value;
    }
  }
  if (refused !== undefined) return refused;
  const where = request.cell === undefined ? "any code cell" : `cell ${request.cell}`;
  throw new RenameRefused({ reason: `${request.name} is not a name in ${where}.` });
}

/** The worker's edits for the request: at its position, or at the first place of its name. */
async function renameEdits(
  deps: LanguageDeps,
  taken: Snapshot,
  request: Parameters<LanguageCalls["rename"]>[0],
): Promise<unknown> {
  const { cell, position, name, newName } = request;
  if ((position === undefined) === (name === undefined))
    throw new InvalidParams({
      issues: [
        { path: ["name"], message: "Give the name to rename, or a cell and a position on it." },
      ],
    });
  if (name !== undefined) return editsByName(deps, taken, { cell, name, newName });
  if (cell === undefined || position === undefined)
    throw new InvalidParams({
      issues: [{ path: ["cell"], message: "A position needs its cell." }],
    });
  return deps.worker.request({ op: "rename", snapshot: taken, cell, position, newName });
}

/** The worker's rename applied through the session, in document order, in one turn; refused if a cell changed. */
async function renameOf(
  deps: LanguageDeps,
  request: Parameters<LanguageCalls["rename"]>[0],
  editor: Editor,
): Promise<readonly CellId[]> {
  const session = await deps.session(request.notebook);
  const taken = await snapshotOf(deps, request.notebook);
  const value = await renameEdits(deps, taken, request);
  if (!isRenameResult(value)) throw new RenameRefused({ reason: "This name cannot be renamed." });
  if (isRefused(value)) throw new RenameRefused({ reason: value.refused });
  const current = new Map(session.state().cells.map((cell) => [cell.id, cell.source]));
  if (taken.cells.some((cell) => current.get(cell.id) !== cell.source))
    throw new RenameRefused({ reason: "The notebook changed during the rename. Try again." });
  for (const edit of value.edits) session.update({ cell: edit.cell, source: edit.source }, editor);
  return value.edits.map((edit) => edit.cell);
}

function isHover(value: unknown): value is Hover {
  return typeof value === "object" && value !== null && "signature" in value;
}

/** The hover at the first place of `name` in `cell` that has one (its declaration, as a rule); null with IntelliSense
 * off or when none of its places reads. */
async function hoverOf(
  deps: LanguageDeps,
  taken: Snapshot,
  cell: Snapshot["cells"][number],
  name: string,
): Promise<Hover | null> {
  if (!deps.intellisense()) return null;
  for (const position of placesOf(cell.source, name)) {
    const task = { op: "query", snapshot: taken, query: "hover", cell: cell.id, position } as const;
    const value = await deps.worker.request(task).catch(() => null);
    if (isHover(value)) return value;
  }
  return null;
}

export function createLanguageCalls(deps: LanguageDeps): LanguageCalls {
  return {
    diagnostics: (notebook, cell) => diagnosticsOf(deps, notebook, cell),
    query: async (notebook, request, overlay) => {
      if (!deps.intellisense())
        throw new LanguageUnavailable({ reason: "editor.intellisense is off." });
      const snapshot = await snapshotOf(deps, notebook, overlay);
      return deps.worker.request({ op: "query", snapshot, ...request });
    },
    rename: (request, editor) => renameOf(deps, request, editor),
    bridge: async (notebook) => {
      const graph = (await deps.session(notebook)).graph().cells;
      const taken = await snapshotOf(deps, notebook);
      return bridgeOf(graph, taken.cells, (cell, name) => hoverOf(deps, taken, cell, name));
    },
    close: async (notebook) => {
      if (deps.worker.running()) await deps.worker.request({ op: "close", notebook });
    },
    reset: async () => {
      if (deps.worker.running()) await deps.worker.request({ op: "reset" });
    },
  };
}
