// The Explorer's outline in headings mode, as VS Code's notebook outline and JupyterLab's table of contents: every
// markdown heading, nested by level, and only the other cells that say something the headings do not.
import type { Cell, CellId } from "@jsnb/core";

import { pendingEdit } from "../cells/agentEdit.js";
import { headingsOf } from "../store/sections.js";

type Outlined = Pick<Cell, "id" | "type" | "source" | "meta" | "status" | "stale">;

export type OutlineRow = {
  readonly key: string;
  readonly cell: CellId;
  readonly heading: boolean;
  /** How deep it sits: 0 at the top, one more under each open heading of a higher level. */
  readonly depth: number;
  readonly text: string;
};

/** A cell other than a heading is listed only when it has a title, runs, failed its last run, is stale or has an
 * agent edit no one reviewed. */
const notable = (cell: Outlined): boolean =>
  (cell.meta.title?.trim() ?? "") !== "" ||
  cell.status === "running" ||
  cell.status === "error" ||
  cell.stale ||
  pendingEdit(cell.meta) !== null;

/** The rows of the outline. A markdown cell lists each of its headings, as VS Code does; a notable cell sits under
 * the last heading above it. `names` names the notable cells. */
export function outlineOf(
  cells: readonly Outlined[],
  names: ReadonlyMap<CellId, string>,
): readonly OutlineRow[] {
  const rows: OutlineRow[] = [];
  const levels: number[] = [];
  for (const cell of cells) {
    const headings = cell.type === "markdown" ? headingsOf(cell.source) : [];
    headings.forEach((heading, at) => {
      while ((levels.at(-1) ?? 0) >= heading.level) levels.pop();
      rows.push({
        key: `${cell.id}#${String(at)}`,
        cell: cell.id,
        heading: true,
        depth: levels.length,
        text: heading.text || (names.get(cell.id) ?? ""),
      });
      levels.push(heading.level);
    });
    if (headings.length === 0 && notable(cell))
      rows.push({
        key: cell.id,
        cell: cell.id,
        heading: false,
        depth: levels.length,
        text: names.get(cell.id) ?? "",
      });
  }
  return rows;
}
