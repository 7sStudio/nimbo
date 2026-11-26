// The failures of a query's answer that is not whole: one past its limit, SQL's cap
// (`query.sqlMaxRows`) or the size budget (`outputs.maxValueBytes`, which cuts what came and marks each cut entry with
// core's truncated marker), and one past `query.timeoutMs`. A machine format is never written from part of an answer
// (QueryTruncated, QueryTimedOut, exit 4); pretty shows what came with the note that says what gives the rest.
import { JsnbError } from "@jsnb/core";

import type { Cause } from "./cli.js";

/** A query's answer that is not whole: the results that came whole, of how many, under which limit and caps. */
export type TruncatedData = {
  readonly cell: string;
  readonly format: string;
  /** The results that came whole. */
  readonly shown: number;
  readonly total: number;
  readonly limit: number;
  /** query.sqlMaxRows, which bounds every SQL answer whatever its limit; for SQL only. */
  readonly sqlMaxRows?: number | undefined;
  /** outputs.maxValueBytes cut part of what came (an entry holds the truncated marker). */
  readonly sizeCut: boolean;
};

type Needed = { readonly cap: boolean; readonly size: boolean; readonly limit: boolean };

/** What gives every result: a higher query.sqlMaxRows, a higher outputs.maxValueBytes, a higher --limit. */
function needed(data: TruncatedData): Needed {
  const limit = data.limit < data.total;
  const cap = data.sqlMaxRows !== undefined && data.sqlMaxRows < data.total;
  // A cut that neither the limit nor SQL's cap explains is the size budget's.
  return { cap, size: data.sizeCut || (!limit && !cap), limit };
}

/** Why the answer is not whole: SQL's cap when it came before the limit, else the limit; and the size budget. */
function causesOf(data: TruncatedData, need: Needed): string {
  const capped =
    data.sqlMaxRows !== undefined && data.shown === data.sqlMaxRows && data.shown < data.limit;
  const stop = capped
    ? `query.sqlMaxRows, ${String(data.sqlMaxRows)}`
    : need.limit
      ? "the query's limit"
      : undefined;
  return [stop, need.size ? "outputs.maxValueBytes" : undefined]
    .filter((cause) => cause !== undefined)
    .join("; ");
}

const total = (data: TruncatedData): string => String(data.total);

/** The settings that give the rest, with the command that raises each. */
const settingsOf = (data: TruncatedData, need: Needed): readonly (readonly [string, string])[] => [
  ...(need.cap ? [["SQL's cap", `nimbo config set query.sqlMaxRows ${total(data)}`] as const] : []),
  ...(need.size
    ? [["the size budget", "nimbo config set outputs.maxValueBytes <bytes>"] as const]
    : []),
];

/**
 * An answer to tell as the part that came, not as a count: no result came whole (one answer, or the first result, past
 * the budget), or every result came and it was still cut for its size.
 */
const asPart = (data: TruncatedData): boolean =>
  (data.sizeCut && data.shown === 0) || (!data.sizeCut && data.shown >= data.total);

const results = (count: number): string => `${String(count)} result${count === 1 ? "" : "s"}`;

/** The note pretty prints under an answer that is not whole: what came, and what gives the rest. */
export function truncatedAdvice(data: TruncatedData): string {
  const need = needed(data);
  if (asPart(data)) {
    const limit = need.limit ? `, then --limit ${total(data)},` : "";
    // No entry came whole: the value itself, which the daemon holds whole, has its own forms too.
    const value =
      data.sizeCut && data.shown === 0
        ? ` The value itself, whole: nimbo outputs ${data.cell} --format json, or --full.`
        : "";
    return `Showing the part of the answer that fits outputs.maxValueBytes; nimbo config set outputs.maxValueBytes <bytes>${limit} shows it whole.${value}`;
  }
  const steps = [
    ...settingsOf(data, need).map(([, command]) => command),
    ...(need.limit ? [`--limit ${total(data)}`] : []),
  ];
  const last = steps.at(-1) ?? "";
  const remedy =
    steps.length > 1 ? `${steps.slice(0, -1).join(", ")}, then ${last}, shows` : `${last} shows`;
  const whole = data.sizeCut ? " whole" : "";
  return `Showing ${String(data.shown)} of ${results(data.total)}${whole} (${causesOf(data, need)}); ${remedy} them all.`;
}

function truncatedMessage(data: TruncatedData): string {
  const need = needed(data);
  const withLimit = need.limit ? ` with --limit ${total(data)}` : "";
  if (asPart(data))
    return `The query's answer on ${data.cell} is larger than outputs.maxValueBytes and was cut, so its ${data.format} would be part of the answer. Raise it with nimbo config set outputs.maxValueBytes <bytes> and ask again${withLimit}, or use --format pretty to see the part that came.`;
  const raise = settingsOf(data, need).map(([what, command]) => `${what} with ${command}`);
  const ask =
    raise.length > 0
      ? `Raise ${raise.join(" and ")} and ask again${withLimit}`
      : `Ask again${withLimit}`;
  const causes = causesOf(data, need).replace(/^the query's limit/, "its limit");
  const came = data.sizeCut
    ? `the first ${String(data.shown)} came whole`
    : `stopped at ${String(data.shown)}`;
  return `The query on ${data.cell} has ${results(data.total)} and ${came} (${causes}), so its ${data.format} would be part of the answer. ${ask}, or use --format pretty to see the first ${String(data.shown)}.`;
}

/** A machine format of a query's answer that is not whole: never written from part of the answer (exit 4). */
export class QueryTruncated extends JsnbError {
  declare readonly data: TruncatedData;
  constructor(data: TruncatedData, options: Cause = {}) {
    super({ name: "QueryTruncated", message: truncatedMessage(data), data, ...options });
  }
}

/** What a query that ran past query.timeoutMs says, and what to do. */
export const timeoutAdvice =
  "The query ran past query.timeoutMs and was stopped; nothing to show. Give it longer with nimbo config set query.timeoutMs <ms>, then ask again.";

/** A machine format of a query that ran past query.timeoutMs: it has no answer to write (exit 4). */
export class QueryTimedOut extends JsnbError {
  declare readonly data: { readonly cell: string; readonly format: string };
  constructor(data: { readonly cell: string; readonly format: string }, options: Cause = {}) {
    super({
      name: "QueryTimedOut",
      message: `The query on ${data.cell} ran past query.timeoutMs and was stopped, so it has no ${data.format}. Give it longer with nimbo config set query.timeoutMs <ms>, then ask again.`,
      data,
      ...options,
    });
  }
}
