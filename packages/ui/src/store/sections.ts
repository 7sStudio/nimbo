// Collapsible sections under markdown headings, as Jupyter and VS Code's notebooks have them: a markdown
// cell whose text has a heading opens a section that runs to the next markdown cell with a heading of the same or a
// higher level. A heading cell's meta.headingCollapsed (Jupyter's heading_collapsed) hides the cells of its section on
// the page; the notebook, its runs and the file's cell order stay as they are.
import type { Cell, CellId } from "@jsnb/core";

const fenceOpen = /^ {0,3}(`{3,}|~{3,})/;
const atx = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const setext = /^ {0,3}(=+|-+)[ \t]*$/;

/** The level of `line` as a heading after `previous` (setext needs a line of text above it); null when it is none. */
function lineLevel(line: string, previous: string): number | null {
  const hashes = atx.exec(line)?.[1];
  if (hashes !== undefined) return hashes.length;
  if (previous.trim() === "" || !setext.test(line)) return null;
  return line.trim().startsWith("=") ? 1 : 2;
}

/** True when `line` closes the code fence `fence` (the same character, at least as many). */
function closes(line: string, fence: string): boolean {
  const close = fenceOpen.exec(line)?.[1];
  return close !== undefined && close.startsWith(fence.charAt(0)) && close.length >= fence.length;
}

export type Heading = { readonly level: number; readonly text: string };

/** A heading's text as plain words: no marks, no closing hashes, a link's label for the link. */
const plain = (text: string): string =>
  text
    .replace(/[ \t]+#+[ \t]*$/u, "")
    .replace(/^#+$/u, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/(\*{1,3}|_{1,3}|`+|~~)(\S(?:.*?\S)?)\1/gu, "$2")
    .trim();

/** Every heading of a markdown cell's text in order, outside code fences: ATX (`## Title`) and setext (`Title` over
 * `===` or `---`). */
export function headingsOf(source: string): readonly Heading[] {
  const headings: Heading[] = [];
  let state: Scan = { fence: null, previous: "" };
  for (const line of source.split("\n")) {
    const previous = state.previous;
    const scanned = scan(state, line);
    state = scanned.state;
    if (scanned.level === null) continue;
    const words = atx.test(line) ? line.replace(atx, "") : previous;
    headings.push({ level: scanned.level, text: plain(words) });
  }
  return headings;
}

/** The highest level (the smallest number) of the headings in a markdown cell's text; null when it has none. */
export function headingLevel(source: string): number | null {
  const levels = headingsOf(source).map((heading) => heading.level);
  return levels.length === 0 ? null : Math.min(...levels);
}

/** Where a scan of a markdown text is: inside the code fence `fence`, and the line before (setext reads it). */
type Scan = { readonly fence: string | null; readonly previous: string };

/** One line of the scan: the heading level it is, if any, and the state after it. */
function scan(state: Scan, line: string): { readonly level: number | null; readonly state: Scan } {
  if (state.fence !== null)
    return {
      level: null,
      state: { fence: closes(line, state.fence) ? null : state.fence, previous: "" },
    };
  const opened = fenceOpen.exec(line)?.[1];
  if (opened !== undefined) return { level: null, state: { fence: opened, previous: "" } };
  const level = lineLevel(line, state.previous);
  return { level, state: { fence: null, previous: level === null ? line : "" } };
}

export type Sections = {
  /** Each heading cell's section: its level, and the cells under it (nested sections included). */
  readonly heads: ReadonlyMap<CellId, { readonly level: number; readonly size: number }>;
  /** Each hidden cell, with the collapsed headings that hide it, outermost first. */
  readonly hiddenBy: ReadonlyMap<CellId, readonly CellId[]>;
};

type Open = {
  readonly id: CellId;
  readonly level: number;
  readonly at: number;
  readonly collapsed: boolean;
};

/** The notebook's sections and the cells they hide, in one pass over the cells in order. */
export function sectionsOf(cells: readonly Cell[]): Sections {
  const heads = new Map<CellId, { level: number; size: number }>();
  const hiddenBy = new Map<CellId, readonly CellId[]>();
  const open: Open[] = [];
  const close = (until: number, level: number) => {
    while ((open.at(-1)?.level ?? 0) >= level && open.length > 0) {
      const head = open.pop();
      if (head !== undefined) heads.set(head.id, { level: head.level, size: until - head.at - 1 });
    }
  };
  cells.forEach((cell, at) => {
    const level = cell.type === "markdown" ? headingLevel(cell.source) : null;
    if (level !== null) close(at, level);
    const hiding = open.filter((each) => each.collapsed).map((each) => each.id);
    if (hiding.length > 0) hiddenBy.set(cell.id, hiding);
    if (level !== null)
      open.push({ id: cell.id, level, at, collapsed: cell.meta.headingCollapsed === true });
  });
  close(cells.length, 0);
  return { heads, hiddenBy };
}

/** The cells the page shows, in order: every cell no collapsed heading hides. */
export const visibleCells = (cells: readonly Cell[], sections: Sections): readonly Cell[] =>
  cells.filter((cell) => !sections.hiddenBy.has(cell.id));

/** The last cell of `cell`'s block: the last cell of its section when it is a collapsed heading (what a move takes
 * along, and what a cell added below it goes after), the cell itself otherwise. */
export function blockEnd(cells: readonly Cell[], sections: Sections, cell: CellId): CellId {
  const head = sections.heads.get(cell);
  const at = cells.findIndex((each) => each.id === cell);
  const collapsed = cells[at]?.meta.headingCollapsed === true;
  if (head === undefined || !collapsed || head.size === 0) return cell;
  return cells[at + head.size]?.id ?? cell;
}

/** The ids of `cell`'s block in order: the cell, and its section's cells when it is a collapsed heading. */
function blockOf(cells: readonly Cell[], sections: Sections, cell: CellId): readonly CellId[] {
  const at = cells.findIndex((each) => each.id === cell);
  const end = cells.findIndex((each) => each.id === blockEnd(cells, sections, cell));
  return at === -1 ? [] : cells.slice(at, end + 1).map((each) => each.id);
}

/** The innermost heading whose section holds `cell`, or `cell` itself when it is a heading: what Left collapses. */
export function headingOf(cells: readonly Cell[], sections: Sections, cell: CellId): CellId | null {
  if (sections.heads.has(cell)) return cell;
  const at = cells.findIndex((each) => each.id === cell);
  for (let i = at - 1; i >= 0; i--) {
    const id = cells[i]?.id;
    const head = id === undefined ? undefined : sections.heads.get(id);
    if (id !== undefined && head !== undefined && i + head.size >= at) return id;
  }
  return null;
}

/** Where a move puts which cells (store/notebookActions.ts): `ids` in order, the first after `after` (null: the top). */
type Plan = { readonly ids: readonly CellId[]; readonly after: CellId | null } | undefined;

/** Where a collapsed section `ids` lands moving down past the shown cell `next`: after `next`'s whole section when it
 * is a heading (never inside it), else after its block. */
function sectionDown(
  order: readonly Cell[],
  sections: Sections,
  ids: readonly CellId[],
  next: CellId,
): Plan {
  const nextHead = sections.heads.get(next);
  const end = order.findIndex((each) => each.id === next) + (nextHead?.size ?? 0);
  const after = nextHead === undefined ? blockEnd(order, sections, next) : order[end]?.id;
  return after === undefined ? undefined : { ids, after };
}

/** Where a collapsed section of `level` lands moving up: before the nearest heading above of its level or higher (the
 * top when there is none). */
function sectionUp(
  order: readonly Cell[],
  sections: Sections,
  ids: readonly CellId[],
  level: number,
): Plan {
  const from = order.findIndex((each) => each.id === ids[0]);
  const above = order
    .slice(0, from)
    .findLastIndex(
      (each) => (sections.heads.get(each.id)?.level ?? Number.POSITIVE_INFINITY) <= level,
    );
  return { ids, after: order[above - 1]?.id ?? null };
}

/** ⌥↑ and ⌥↓ over what the page shows. A collapsed heading moves with its section, past the whole next section (it
 * lands after that section, never inside it) or before the section above it of its level or higher; any other cell moves
 * past the next cell shown (one that lands in a collapsed section opens it, CellList). Nothing at either end. */
export function blockStep(order: readonly Cell[], cell: CellId, step: -1 | 1): Plan {
  const sections = sectionsOf(order);
  const shown = visibleCells(order, sections).map((each) => each.id);
  const at = shown.indexOf(cell);
  if (at === -1) return undefined;
  const ids = blockOf(order, sections, cell);
  const head = ids.length > 1 ? sections.heads.get(cell) : undefined;
  const move = { order, sections, ids, level: head?.level };
  return step === 1 ? stepDown(move, shown[at + 1]) : stepUp(move, shown, at);
}

/** A block on the move: its cells, and its heading's level when it is a collapsed section. */
type Move = {
  readonly order: readonly Cell[];
  readonly sections: Sections;
  readonly ids: readonly CellId[];
  readonly level: number | undefined;
};

/** ⌥↓ past the shown cell `next` (none: nothing). */
function stepDown({ order, sections, ids, level }: Move, next: CellId | undefined): Plan {
  if (next === undefined) return undefined;
  if (level === undefined) return { ids, after: blockEnd(order, sections, next) };
  return sectionDown(order, sections, ids, next);
}

/** ⌥↑ from the shown cell at `at` (the first: nothing). */
function stepUp({ order, sections, ids, level }: Move, shown: readonly CellId[], at: number): Plan {
  if (at === 0) return undefined;
  if (level !== undefined) return sectionUp(order, sections, ids, level);
  const before = shown[at - 2];
  return { ids, after: before === undefined ? null : blockEnd(order, sections, before) };
}

/** A drag that drops `cell`'s block after the shown cell `target`'s block (null: at the top); nothing when it would
 * land on itself. */
export function dropAfter(order: readonly Cell[], cell: CellId, target: CellId | null): Plan {
  const sections = sectionsOf(order);
  const ids = blockOf(order, sections, cell);
  if (target !== null && ids.includes(target)) return undefined;
  const after = target === null ? null : blockEnd(order, sections, target);
  const at = order.findIndex((each) => each.id === cell);
  const already = (order[at - 1]?.id ?? null) === after;
  return ids.length === 0 || already ? undefined : { ids, after };
}
