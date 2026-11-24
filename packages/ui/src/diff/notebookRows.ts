// What the notebook diff shows (after GitNotebooks): the changed cells with `context` unchanged
// cells above and below each, the cells between folded into "N unchanged cells" rows that expand; Show Entire Notebook
// shows every cell. A cell whose only change is its meta counts as changed only while Metadata Changes is on, one whose
// only change is its saved run only while Hide Outputs is off.
import type { DiffRow } from "@jsnb/core";
import { lineDiff } from "@jsnb/core";

export type ShownRow =
  | {
      readonly kind: "cell";
      readonly key: string;
      readonly row: DiffRow;
      readonly changed: boolean;
    }
  | { readonly kind: "fold"; readonly key: string; readonly count: number };

export type ShowOptions = {
  readonly entire: boolean;
  readonly context: number;
  readonly metadata: boolean;
  /** Hide Outputs: a change to a cell's saved run alone does not count. */
  readonly hideOutputs: boolean;
  /** The folds opened, by their key. */
  readonly expanded: ReadonlySet<string>;
};

const rowKey = (row: DiffRow): string =>
  `${row.status}:${row.before?.id ?? ""}:${row.after?.id ?? ""}`;

/** Whether `row` shows as a change: added, removed, moved, its source or type changed, its meta with Metadata Changes
 * on, its saved run unless Hide Outputs. */
function isChanged(
  row: DiffRow,
  { metadata, hideOutputs }: Pick<ShowOptions, "metadata" | "hideOutputs">,
): boolean {
  if (row.status === "added" || row.status === "removed" || row.moved !== undefined) return true;
  const { source, type, meta, outputs } = row.changes;
  return (
    source !== undefined ||
    type !== undefined ||
    (metadata && meta !== undefined) ||
    (!hideOutputs && outputs !== undefined)
  );
}

/** The rows to draw, in order, with the folds between them. */
export function shownRows(rows: readonly DiffRow[], options: ShowOptions): readonly ShownRow[] {
  const changed = rows.map((row) => isChanged(row, options));
  const near = (at: number) => {
    for (let k = Math.max(0, at - options.context); k <= at + options.context; k += 1)
      if (changed[k] === true) return true;
    return false;
  };
  const out: ShownRow[] = [];
  let hidden: DiffRow[] = [];
  const flush = () => {
    const first = hidden[0];
    if (first === undefined) return;
    const key = `fold:${rowKey(first)}`;
    if (options.expanded.has(key))
      out.push(
        ...hidden.map((row) => ({ kind: "cell" as const, key: rowKey(row), row, changed: false })),
      );
    else out.push({ kind: "fold", key, count: hidden.length });
    hidden = [];
  };
  rows.forEach((row, at) => {
    if (options.entire || near(at)) {
      flush();
      out.push({ kind: "cell", key: rowKey(row), row, changed: changed[at] === true });
    } else hidden.push(row);
  });
  flush();
  return out;
}

export type Block = { readonly kind: "same" | "removed" | "added"; readonly text: string };

/** A markdown source cut into blocks at blank lines, as the renderer's paragraphs, lists and fences mostly fall. */
const blocksOf = (source: string): readonly string[] =>
  source
    .split(/\n[ \t]*\n/u)
    .map((block) => block.trim())
    .filter((block) => block !== "");

/** The blocks of two markdown sources, kept, removed and added (the line diff run over whole blocks). */
export function blockDiff(before: string, after: string): readonly Block[] {
  const encode = (blocks: readonly string[]) =>
    blocks.map((block) => block.replaceAll("\n", "\u0000")).join("\n");
  const a = blocksOf(before);
  const b = blocksOf(after);
  if (a.length === 0 || b.length === 0)
    return [
      ...a.map((text) => ({ kind: "removed" as const, text })),
      ...b.map((text) => ({ kind: "added" as const, text })),
    ];
  return lineDiff(encode(a), encode(b)).map((line) => ({
    kind: line.kind,
    text: line.text.replaceAll("\u0000", "\n"),
  }));
}

/** The blocks as side by side rows: a kept block on both sides, a run of removed blocks beside the added ones that
 * replaced it, so the two columns stay aligned. */
export function blockRows(blocks: readonly Block[]): readonly { left?: Block; right?: Block }[] {
  const rows: { left?: Block; right?: Block }[] = [];
  let removed: Block[] = [];
  let added: Block[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
      const left = removed[k];
      const right = added[k];
      rows.push({ ...(left ? { left } : {}), ...(right ? { right } : {}) });
    }
    removed = [];
    added = [];
  };
  for (const block of blocks) {
    if (block.kind === "removed") removed.push(block);
    else if (block.kind === "added") added.push(block);
    else {
      flush();
      rows.push({ left: block, right: block });
    }
  }
  flush();
  return rows;
}
