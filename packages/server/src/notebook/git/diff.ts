// git.diff (03-api §4.13): the two sides of one file, which `staged` and `base` pick, then a
// notebook diff through core's diffNotebooks when both sides parse, else a text diff; binary and oversized sides are
// named, not diffed. An agent's answer leaves the cells' full sources out: the hunks say what changed.
import type { z } from "zod";

import type { DiffCellSide, gitDiff, NotebookDiff, NotebookDocument } from "@jsnb/core";
import { CellNotFound, diffNotebooks, InvalidParams, parse, randomIds, textDiff } from "@jsnb/core";

import type { Side } from "./content.js";
import { blob, isBinary, textOfSide } from "./content.js";
import type { GitContext } from "./context.js";
import { required, workingSide } from "./context.js";
import { checkPath, checkRevision } from "./paths.js";
import type { RepoLocation } from "./status.js";
import { statusOf } from "./status.js";

type DiffInput = z.output<typeof gitDiff.input>;
type DiffOutput = z.input<typeof gitDiff.output>;
type Sides = {
  /** A staged rename's old path, relative to the workspace. */
  readonly renamedFrom?: string;
  readonly from: string;
  readonly before: Side;
  readonly to: string;
  readonly after: Side;
};

/** The two sides the input compares: base against the working tree, HEAD against the index, a conflict's HEAD
 * against the working tree, else the index against the working tree. A staged rename's old side is its old path. */
async function sidesOf(
  context: GitContext,
  found: RepoLocation,
  input: DiffInput,
  path: string,
): Promise<Sides> {
  const at = `${found.prefix}${path}`;
  const repo = await statusOf(found, context.options);
  const show = (spec: string) => blob(found.top, spec);
  const working = () => workingSide(context, path);
  if (input.base !== undefined) {
    const oid = await checkRevision(context.root, input.base);
    return {
      from: input.base,
      before: await show(`${oid}:${at}`),
      to: "worktree",
      after: await working(),
    };
  }
  if (input.staged) {
    const renamed = repo.staged.find((change) => change.path === path)?.from;
    const old =
      renamed === undefined || renamed.startsWith("../") ? at : `${found.prefix}${renamed}`;
    return {
      ...(renamed === undefined || renamed.startsWith("../") ? {} : { renamedFrom: renamed }),
      from: "HEAD",
      before: await show(`HEAD:${old}`),
      to: "index",
      after: await show(`:0:${at}`),
    };
  }
  if (repo.conflicts.some((change) => change.path === path))
    return {
      from: "HEAD",
      before: await show(`HEAD:${at}`),
      to: "worktree",
      after: await working(),
    };
  return { from: "index", before: await show(`:0:${at}`), to: "worktree", after: await working() };
}

const strip = (side: DiffCellSide | undefined): DiffCellSide | undefined =>
  side === undefined
    ? undefined
    : { id: side.id, index: side.index, type: side.type, meta: side.meta };

/** A notebook diff for a reader that did not ask for the content (an agent): the changed rows only, without the sides'
 * full sources; `stats` still counts the unchanged cells. */
function withoutSources(diff: NotebookDiff): NotebookDiff {
  return {
    ...diff,
    rows: diff.rows.flatMap((row) => {
      if (row.status === "unchanged" && row.moved === undefined) return [];
      const before = strip(row.before);
      const after = strip(row.after);
      return [{ ...row, ...(before ? { before } : {}), ...(after ? { after } : {}) }];
    }),
  };
}

/** A side's notebook: null for no side, undefined when it does not parse. */
function documentOf(text: string | null, path: string): NotebookDocument | null | undefined {
  if (text === null) return null;
  const parsed = parse(text, { ids: randomIds(), path });
  return parsed.ok ? parsed.value.doc : undefined;
}

/** The rows about `cell` only; CellNotFound when the diff has none. */
function narrowed(diff: NotebookDiff, cell: string): NotebookDiff {
  const rows = diff.rows.filter((row) => row.before?.id === cell || row.after?.id === cell);
  if (rows.length === 0) throw new CellNotFound({ cell });
  return { ...diff, rows };
}

/** What the two sides are not diffed for: one too large, or one binary. */
function undiffable(sides: Sides): "tooLarge" | "binary" | undefined {
  if (sides.before.kind === "tooLarge" || sides.after.kind === "tooLarge") return "tooLarge";
  return isBinary(sides.before) || isBinary(sides.after) ? "binary" : undefined;
}

/** Both sides' full text, when the input asks for it. */
const fullOf = (input: Pick<DiffInput, "content">, a: string | null, b: string | null) =>
  input.content
    ? { ...(a === null ? {} : { before: a }), ...(b === null ? {} : { after: b }) }
    : {};

/** A text file's diff, or a notebook's when both its sides parse. */
function bodyOf(
  input: Pick<DiffInput, "content" | "cell">,
  path: string,
  a: string | null,
  b: string | null,
) {
  if (!path.endsWith(".jsnb")) return { kind: "text" as const, text: textDiff(a, b) };
  const left = documentOf(a, path);
  const right = documentOf(b, path);
  if (left === undefined || right === undefined)
    return { kind: "text" as const, reason: "notebookUnreadable" as const, text: textDiff(a, b) };
  const whole = diffNotebooks(left, right);
  const notebook = input.cell === undefined ? whole : narrowed(whole, input.cell);
  return {
    kind: "notebook" as const,
    notebook: input.content ? notebook : withoutSources(notebook),
  };
}

/** A path git has never seen (not in HEAD, the index or the working tree) is a mistyped one, not an empty diff. */
async function mustBeKnown(found: RepoLocation, path: string): Promise<void> {
  const head = await blob(found.top, `HEAD:${found.prefix}${path}`);
  if (head.kind === "none")
    throw new InvalidParams({
      issues: [
        { path: ["path"], message: `${path}: no such file in HEAD, the index or the working tree` },
      ],
    });
}

export async function diffFile(context: GitContext, input: DiffInput): Promise<DiffOutput> {
  const found = await required(context);
  const path = await checkPath(context.root, input.path);
  const sides = await sidesOf(context, found, input, path);
  if (sides.before.kind === "none" && sides.after.kind === "none") await mustBeKnown(found, path);
  const label = (side: Side, name: string) => (side.kind === "none" ? "none" : name);
  const head = {
    path,
    ...(sides.renamedFrom === undefined ? {} : { renamedFrom: sides.renamedFrom }),
    from: label(sides.before, sides.from),
    to: label(sides.after, sides.to),
  };
  const skipped = undiffable(sides);
  if (skipped !== undefined) return { ...head, kind: skipped };
  const a = textOfSide(sides.before);
  const b = textOfSide(sides.after);
  return { ...head, ...bodyOf(input, path, a, b), ...fullOf(input, a, b) };
}

/** notebook.compareDisk: an open notebook's file (`disk`, null when gone) against its session's text, in git.diff's
 * form, `from` "disk" and `to` "session". */
export function diffDisk(
  input: { readonly path: string; readonly content: boolean },
  disk: string | null,
  session: string,
): DiffOutput {
  const head = { path: input.path, from: disk === null ? "none" : "disk", to: "session" };
  return { ...head, ...bodyOf(input, input.path, disk, session), ...fullOf(input, disk, session) };
}
