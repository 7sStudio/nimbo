// The session's cells to and from the .jsnb document (07-file-format §2): parsed with core's `parse` (ids assigned,
// unknown keys kept, migrations run), and written back with the app's version as `jsnb`, through core's serialize.
import type { IdGenerator, NotebookDocument, Settings } from "@jsnb/core";
import { currentVersion, parse, SavedRun, serialize } from "@jsnb/core";

import { serverVersion } from "../../files/version.js";
import { analysisOf } from "./analysis.js";
import type { DocumentHeader } from "./context.js";
import type { CellRecord, ExecutionRecord } from "./records.js";
import { terminalStatuses } from "./records.js";

export type LoadedDocument = {
  readonly header: DocumentHeader;
  readonly records: readonly CellRecord[];
  readonly warnings: readonly string[];
  /** Ids were assigned or the format migrated: the state differs from the file until the next save. */
  readonly dirty: boolean;
};

/** Parses a notebook's text; throws core's InvalidNotebook, NewerVersion or DuplicateCellId. */
export function loadDocument(text: string, path: string, ids: IdGenerator): LoadedDocument {
  const parsed = parse(text, { ids, path, appVersion: serverVersion });
  if (!parsed.ok) throw parsed.error;
  const { doc, warnings, migrated, assignedIds } = parsed.value;
  const records = doc.cells.map((cell): CellRecord => {
    const saved = doc.outputs?.[cell.id];
    return {
      id: cell.id,
      type: cell.type,
      source: cell.source,
      meta: cell.meta,
      extra: cell.extra,
      analysis: analysisOf(cell.type, cell.source),
      status: "idle",
      last: saved === undefined ? undefined : restoredRun(saved, cell.id, ids),
    };
  });
  return {
    header: { version: doc.version, extra: doc.extra, outputs: doc.outputs !== undefined },
    records,
    warnings,
    dirty: migrated || assignedIds,
  };
}

/** A saved run as the cell's last: a fresh execution id, nothing defined in this kernel. */
function restoredRun(saved: SavedRun, cell: string, ids: IdGenerator): ExecutionRecord {
  return {
    id: ids.execution(),
    cell,
    status: saved.status,
    startedAt: saved.startedAt,
    ...(saved.endedAt === undefined ? {} : { endedAt: saved.endedAt }),
    ...(saved.durationMs === undefined ? {} : { durationMs: saved.durationMs }),
    outputs: [...saved.outputs],
    ...(saved.error === undefined ? {} : { error: saved.error }),
    defines: [],
    restored: true,
  };
}

/** The empty notebook notebook.create writes. */
export const emptyHeader = (): DocumentHeader => ({
  version: currentVersion,
  extra: {},
  outputs: false,
});

/** outputs.save (07-file-format §2): `always`, `never`, or `auto`, which keeps outputs in a file that had them. */
export function savesOutputs(settings: Settings, header: DocumentHeader): boolean {
  const policy = settings["outputs.save"];
  return policy === "always" || (policy === "auto" && header.outputs);
}

/** Every string of a value through `redact`, keys included (what the file keeps is redacted as a page's view is). */
export function redactDeep(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [redact(key), redactDeep(item, redact)]),
  );
}

/** The run a cell's file entry saves: its last finished one (a run under way leaves the one before it). */
function savedRunOf(record: CellRecord, redact: (text: string) => string): SavedRun | undefined {
  const run =
    record.last && terminalStatuses.has(record.last.status) ? record.last : record.previous;
  if (run === undefined || record.type === "markdown") return undefined;
  const status = run.status === "ok" || run.status === "error" ? run.status : "interrupted";
  const saved = {
    status,
    startedAt: run.startedAt,
    ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    ...(run.durationMs === undefined ? {} : { durationMs: run.durationMs }),
    outputs: run.outputs,
    ...(run.error === undefined ? {} : { error: run.error }),
  };
  return SavedRun.parse(redactDeep(saved, redact));
}

export type OutputsForm = {
  /** Whether the file keeps outputs (savesOutputs). */
  readonly save: boolean;
  readonly redact: (text: string) => string;
};

/** The notebook file form of the session's state. */
function documentOf(
  header: DocumentHeader,
  records: readonly CellRecord[],
  outputs: OutputsForm | undefined,
): NotebookDocument {
  const runs =
    outputs?.save === true
      ? Object.fromEntries(
          records.flatMap((record) => {
            const saved = savedRunOf(record, outputs.redact);
            return saved === undefined ? [] : [[record.id, saved] as const];
          }),
        )
      : undefined;
  return {
    version: header.version,
    jsnb: serverVersion,
    cells: records.map(({ id, type, source, meta, extra }) => ({ id, type, source, meta, extra })),
    ...(runs === undefined ? {} : { outputs: runs }),
    extra: header.extra,
  };
}

/** The file text of the session's state; with `outputs`, the cells' last runs as the policy says. */
export const textOf = (
  header: DocumentHeader,
  records: readonly CellRecord[],
  outputs?: OutputsForm,
): string => serialize(documentOf(header, records, outputs));
