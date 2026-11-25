// An agent's edit waiting for review (03-api §5 `EditInfo.review`) in the words the page says it with: who
// made it, over which client and when, which lines it changed; the card, the outline, the Agent view and a folded
// cell's name column all read it from here.
import type { CellMeta, EditInfo, EditReview, LineRange } from "@jsnb/core";

/** A cell's last edit when it is an agent's that no one reviewed yet, with its review. */
export type PendingEdit = EditInfo & { readonly review: EditReview };

/** The agent edit of `meta` waiting for review, or null. */
export const pendingEdit = (meta: CellMeta): PendingEdit | null => {
  const edit = meta.lastEdit;
  return edit?.review === undefined ? null : { ...edit, review: edit.review };
};

const clients: Readonly<Record<EditInfo["client"], string>> = {
  ui: "the page",
  cli: "the CLI",
  mcp: "MCP",
  file: "the file",
};

/** "claude-code", "An agent" when the connection gave no name, "The file on disk" for an edit made there. */
export const whoOf = (edit: EditInfo): string =>
  edit.by === "external" ? "The file on disk" : (edit.agent ?? "An agent");

/** "over MCP", "over the CLI"; "" for an edit on disk, which says where already. */
export const overOf = (edit: EditInfo): string =>
  edit.by === "external" ? "" : `over ${clients[edit.client]}`;

const pad = (n: number) => String(n).padStart(2, "0");

/** "today at 14:02", "yesterday at 09:15", "on 12 Nov at 14:02" by the page's clock; "" for a time it cannot read. */
export function whenOf(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const date = at.toLocaleDateString([], { day: "numeric", month: "short" });
  return `on ${date} at ${time}`;
}

const rangeWords = ({ from, to }: LineRange) =>
  from === to ? String(from) : `${String(from)} to ${String(to)}`;

/** "line 4", "lines 2 to 3", "lines 2 to 3 and 7", "lines 1, 4 and 6 to 8"; "no line" for none. */
export function linesOf(ranges: readonly LineRange[]): string {
  if (ranges.length === 0) return "no line";
  const one = ranges.length === 1 && ranges[0]?.from === ranges[0]?.to;
  const words = ranges.map(rangeWords);
  const last = words.pop() ?? "";
  return `${one ? "line" : "lines"} ${words.length === 0 ? last : `${words.join(", ")} and ${last}`}`;
}

/** The lines the edit marks in the gutter, each line number once. */
export function markedLines(ranges: readonly LineRange[]): readonly number[] {
  return ranges.flatMap(({ from, to }) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i),
  );
}

/** "lines 2 to 3 changed by claude-code": a folded cell's name column and the outline's tooltip start. */
export const changedBy = (edit: PendingEdit): string =>
  edit.by === "external"
    ? `${linesOf(edit.review.lines)} changed in the file on disk`
    : `${linesOf(edit.review.lines)} changed by ${edit.agent ?? "an agent"}`;
