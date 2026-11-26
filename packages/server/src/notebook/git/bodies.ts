// The body of a diff of two texts in git.diff's form: a notebook cell by cell when both sides parse, else
// line hunks, the full texts when asked; and notebook.compareDisk's, the file on disk against the session.
import type { z } from "zod";

import type { DiffCellSide, gitDiff, NotebookDiff, NotebookDocument } from "@jsnb/core";
import { CellNotFound, diffNotebooks, parse, randomIds, textDiff } from "@jsnb/core";

type DiffInput = z.output<typeof gitDiff.input>;
type DiffOutput = z.input<typeof gitDiff.output>;

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

/** Both sides' full text, when the input asks for it. */
export const fullOf = (input: Pick<DiffInput, "content">, a: string | null, b: string | null) =>
  input.content
    ? { ...(a === null ? {} : { before: a }), ...(b === null ? {} : { after: b }) }
    : {};

/** A text file's diff, or a notebook's when both its sides parse. */
export function bodyOf(
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
