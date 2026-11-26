// parse: text of a .jsnb file in, a NotebookDocument with warnings out.
import type { z } from "zod";

import { DuplicateCellId, InvalidNotebook, NewerVersion } from "../errors/format.js";
import type { JsnbError } from "../errors/jsnbError.js";
import { cellMetaKeys } from "../model/cell.js";
import type { IdGenerator } from "../model/ids.js";
import { fromLines } from "./lines.js";
import type { RawNotebook } from "./migrate.js";
import { migrate } from "./migrate.js";
import type { DocumentCell, FileCell, NotebookDocument } from "./schema.js";
import { currentVersion, knownKeys, NotebookFile, SavedRun } from "./schema.js";

export type ParseOptions = {
  readonly ids: IdGenerator;
  readonly path?: string;
  /** The app version named in a NewerVersion message. */
  readonly appVersion?: string;
};

export type Parsed = {
  readonly doc: NotebookDocument;
  readonly warnings: readonly string[];
  readonly migrated: boolean;
  readonly assignedIds: boolean;
};

export type ParseResult =
  { readonly ok: true; readonly value: Parsed } | { readonly ok: false; readonly error: JsnbError };

const failed = (error: JsnbError): ParseResult => ({ ok: false, error });

/** Strict JSON only, validated, migrated, ids assigned, unknown keys kept and reported once. */
export function parse(text: string, options: ParseOptions): ParseResult {
  const path = options.path;
  const json = readJson(text);
  if (!json.ok)
    return failed(
      new InvalidNotebook({ ...(path === undefined ? {} : { path }), issues: [json.issue] }),
    );
  const version = rawVersion(json.value);
  if (version !== undefined && version > currentVersion) {
    const supported = currentVersion;
    const appVersion = options.appVersion ?? "unknown";
    return failed(new NewerVersion({ path: path ?? "notebook", version, supported, appVersion }));
  }
  const { raw, migrated } = migrate(json.value);
  const checked = NotebookFile.safeParse(raw);
  if (!checked.success) {
    const issues = checked.error.issues.map(describeIssue);
    return failed(new InvalidNotebook({ ...(path === undefined ? {} : { path }), issues }));
  }
  const duplicate = findDuplicate(checked.data.cells);
  if (duplicate) return failed(new DuplicateCellId(duplicate));
  return { ok: true, value: { ...toDocument(checked.data, options.ids), migrated } };
}

type JsonRead =
  | { readonly ok: true; readonly value: RawNotebook }
  | { readonly ok: false; readonly issue: { readonly path: string; readonly message: string } };

function readJson(text: string): JsonRead {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, issue: { path: "", message: `not valid JSON (${message})` } };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issue: { path: "", message: "expected an object" } };
  }
  return { ok: true, value: Object.fromEntries(Object.entries(value)) };
}

const rawVersion = (raw: RawNotebook): number | undefined =>
  typeof raw.version === "number" && Number.isInteger(raw.version) ? raw.version : undefined;

/** `cells[3].source[0]: expected string`, from a Zod issue; a union issue is the most specific branch's. */
function describeIssue(issue: z.core.$ZodIssue): { path: string; message: string } {
  const leaf = leafIssue(issue, []);
  const path = leaf.path
    .map((segment, index) => {
      if (typeof segment === "number") return `[${String(segment)}]`;
      return index === 0 ? String(segment) : `.${String(segment)}`;
    })
    .join("");
  const message = leaf.expected === undefined ? leaf.message : `expected ${leaf.expected}`;
  return { path, message };
}

type Leaf = {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly expected?: string;
  readonly message: string;
};

/** The deepest issue under a union, with the path prefixed; any other issue as it is. */
function leafIssue(issue: z.core.$ZodIssue, prefix: readonly PropertyKey[]): Leaf {
  const path = [...prefix, ...issue.path];
  if (issue.code !== "invalid_union") {
    const expected = issue.code === "invalid_type" ? issue.expected : undefined;
    return expected === undefined
      ? { path, code: issue.code, message: issue.message }
      : { path, code: issue.code, expected, message: issue.message };
  }
  const branches = issue.errors.flatMap((branch) =>
    branch[0] ? [leafIssue(branch[0], path)] : [],
  );
  const deepest = branches.reduce<Leaf | undefined>(
    (best, leaf) => (best && best.path.length >= leaf.path.length ? best : leaf),
    undefined,
  );
  return deepest ?? { path, code: issue.code, message: issue.message };
}

function findDuplicate(
  cells: readonly FileCell[],
): { id: string; positions: number[] } | undefined {
  const positions = new Map<string, number[]>();
  for (const [index, cell] of cells.entries()) {
    if (cell.id === undefined) continue;
    positions.set(cell.id, [...(positions.get(cell.id) ?? []), index]);
  }
  for (const [id, at] of positions) if (at.length > 1) return { id, positions: at };
  return undefined;
}

type Built = {
  readonly doc: NotebookDocument;
  readonly warnings: string[];
  readonly assignedIds: boolean;
};

function toDocument(file: NotebookFile, ids: IdGenerator): Built {
  const warnings: string[] = [];
  const used = new Set(file.cells.flatMap((cell) => (cell.id === undefined ? [] : [cell.id])));
  let assignedIds = false;
  const cells = file.cells.map((cell, index): DocumentCell => {
    const where = `cells[${String(index)}]`;
    const id = cell.id ?? freshId(ids, used);
    if (cell.id === undefined) assignedIds = true;
    const meta = cell.meta ?? {};
    warnings.push(
      ...unknownKeys(cell, knownKeys.cell, where),
      ...unknownKeys(meta, cellMetaKeys, `${where}.meta`),
    );
    const extra = pick(cell, knownKeys.cell);
    const source = typeof cell.source === "string" ? cell.source : fromLines(cell.source);
    return { id, type: cell.type, source, meta, extra };
  });
  warnings.unshift(...unknownKeys(file, knownKeys.file, ""));
  const extra = pick(file, knownKeys.file);
  const outputs = file.outputs === undefined ? undefined : savedRuns(file.outputs, used, warnings);
  const base = {
    version: file.version,
    cells,
    extra,
    ...(outputs === undefined ? {} : { outputs }),
  };
  const doc = file.jsnb === undefined ? base : { ...base, jsnb: file.jsnb };
  return { doc, warnings, assignedIds };
}

/** The saved runs of cells the file has; a run of no cell or one the schema refuses is dropped with a warning. */
function savedRuns(
  raw: Readonly<Record<string, unknown>>,
  cells: ReadonlySet<string>,
  warnings: string[],
): Record<string, SavedRun> {
  const runs: Record<string, SavedRun> = {};
  for (const [id, value] of Object.entries(raw)) {
    const checked = SavedRun.safeParse(value);
    if (!cells.has(id)) warnings.push(`outputs.${id} names no cell: dropped`);
    else if (!checked.success) warnings.push(`outputs.${id} is not a saved run: dropped`);
    else runs[id] = checked.data;
  }
  return runs;
}

function freshId(ids: IdGenerator, used: Set<string>): string {
  let id = ids.cell();
  while (used.has(id)) id = ids.cell();
  used.add(id);
  return id;
}

const unknownKeys = (value: object, known: readonly string[], where: string): string[] =>
  Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => `unknown key ${where === "" ? key : `${where}.${key}`} kept`);

const pick = (value: object, exclude: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !exclude.includes(key)));
