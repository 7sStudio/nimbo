// Edit provenance of 03-api §5: `meta.lastEdit` stamped from the connection's declaration on every
// cell.add and cell.update that changes the code; the ui is the user, every other client (cli, mcp, file, an undeclared
// one) an agent. An agent's edit waits for review: its stamp keeps the code from before the first edit no one reviewed,
// until the user edits the cell (whoever edits a cell has it in front of them), marks it reviewed, or the code is back.
import type { CellType, EditInfo, FileEditInfo } from "@jsnb/core";
import { changedLines } from "@jsnb/core";

/** Who made a change: the connection's declaration (03-api §7.1). */
export type Editor = { readonly client: EditInfo["client"]; readonly agent?: string };

/** A cell's code: what an edit changes and a revert puts back. */
type Code = { readonly source: string; readonly type: CellType };

/** A stamp with no review: the same in the file and in the API. */
type Stamp = Omit<FileEditInfo, "review">;

/** The EditInfo of a change by `editor` at `at`, without a review. */
function editInfo(editor: Editor, at: string): Stamp {
  return {
    by: editor.client === "ui" ? "user" : "agent",
    client: editor.client,
    ...(editor.agent === undefined ? {} : { agent: editor.agent }),
    at,
  };
}

/** A change of a cell's code. */
export type Change = { readonly before: Code; readonly after: Code };

/**
 * The stamp of `change` by `editor` at `at`, `last` the cell's stamp until then. The user's edit is reviewed by its
 * author: no review. An agent's keeps the code before the first edit no one reviewed (the one `last` holds, else the
 * code before this change), unless the code is back to it.
 */
export function stamped(
  last: FileEditInfo | undefined,
  editor: Editor,
  at: string,
  { before, after }: Change,
): FileEditInfo {
  const info = editInfo(editor, at);
  if (info.by === "user") return info;
  const base = last?.review ?? { previousSource: before.source, previousType: before.type };
  if (base.previousSource === after.source && base.previousType === after.type) return info;
  return {
    ...info,
    review: { previousSource: base.previousSource, previousType: base.previousType },
  };
}

/** `edit` without its review: the agent's edit marked reviewed, who made it and when kept. */
export function reviewed(edit: FileEditInfo): Stamp {
  return {
    by: edit.by,
    client: edit.client,
    ...(edit.agent === undefined ? {} : { agent: edit.agent }),
    at: edit.at,
  };
}

/** The API form of a stamp on a cell whose source is `source`: a review gains the lines of `source` that differ from
 * the code before it. */
export function apiEdit(edit: FileEditInfo, source: string): EditInfo {
  if (edit.review === undefined) return reviewed(edit);
  const { previousSource, previousType } = edit.review;
  return {
    ...reviewed(edit),
    review: { previousSource, previousType, lines: changedLines(previousSource, source) },
  };
}
