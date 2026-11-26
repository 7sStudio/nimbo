// The failures of `nimbo outputs`: a format the value cannot take, no value to read, a cell that never ran,
// a value cut at the output limit the daemon does not hold whole, a query's answer past its limit or its time. A
// machine format (json, ndjson, csv) is never written from part of an answer; pretty shows the part with a note.
import { JsnbError } from "@jsnb/core";

import type { Cause } from "./cli.js";

/** `--format csv` of a value, or of a query's answer (`query`, its mode), that is no table (exit 2). */
export class NotTabular extends JsnbError {
  declare readonly data: {
    readonly cell: string;
    readonly format: string;
    readonly query?: string;
  };
  constructor(
    data: { readonly cell: string; readonly format: string; readonly query?: string },
    options: Cause = {},
  ) {
    const what =
      data.query === undefined
        ? `The value of ${data.cell}`
        : `The answer of the ${data.query} query on ${data.cell}`;
    super({
      name: "NotTabular",
      message: `${what} is not a table, so it has no ${data.format}: a table is a non-empty array of records (its columns the union of their keys) or of arrays of one length. Use --format json, ndjson or pretty.`,
      data,
      ...options,
    });
  }
}

/** The output `nimbo outputs` was pointed at: `index` as asked, or null when the run has no value output at all. */
export type MissingOutput = { readonly cell: string; readonly index: number | null };

const noValueMessage = ({ cell, index }: MissingOutput): string =>
  index === null
    ? `${cell}'s last run has no value output. List its outputs with nimbo outputs ${cell}.`
    : `Output ${String(index)} of ${cell}'s last run is not a value. List its outputs with nimbo outputs ${cell}.`;

/** `nimbo outputs` asked for a value the cell's last run does not hold (exit 4). */
export class NoValueOutput extends JsnbError {
  declare readonly data: MissingOutput;
  constructor(data: MissingOutput, options: Cause = {}) {
    super({ name: "NoValueOutput", message: noValueMessage(data), data, ...options });
  }
}

/** `nimbo outputs` with a query, a format or --full on a cell that never ran (exit 4). */
export class CellNotRun extends JsnbError {
  declare readonly data: { readonly cell: string };
  constructor(data: { readonly cell: string }, options: Cause = {}) {
    super({
      name: "CellNotRun",
      message: `${data.cell} has not run yet, so it has no outputs. Run it with nimbo run ${data.cell}.`,
      data,
      ...options,
    });
  }
}

/** What to do about a cut value the daemon does not hold whole, by the daemon's reason (its words). */
function cutAdvice(reason: string, cell: string): string {
  const again = `restart the kernel with nimbo kernel restart, then run the cell again with nimbo run ${cell}`;
  if (reason.includes("outputs.retainFullValue is off")) {
    return `Turn retention on with nimbo config set outputs.retainFullValue true, ${again}.`;
  }
  if (reason.includes("outputs.retainMaxBytes")) {
    // Cut by its kernel at the budget it started with: a new budget needs a restart; sized here, a new run is enough.
    const then = reason.includes("restart the kernel")
      ? again
      : `then run the cell again with nimbo run ${cell}`;
    return `Raise the budget with nimbo config set outputs.retainMaxBytes <bytes>, ${then}.`;
  }
  if (reason.includes("sent no full form")) {
    return `Its kernel started with retention off: ${again} (a value too deep to walk has no whole form at all).`;
  }
  if (reason.includes("no longer retained")) {
    return `Later values took its place within outputs.retainMaxBytes: run the cell again with nimbo run ${cell} and export it before the others, or raise outputs.retainMaxBytes.`;
  }
  return "";
}

/** The value output a cut refusal names, and what was asked of it: a format, or (`query`) a query of that mode. */
export type CutData = {
  readonly cell: string;
  readonly index: number;
  readonly format: string;
  readonly query?: string;
};

/**
 * A machine format of a value cut at the output limit whose whole value the daemon does not hold, or a query of it
 * (exit 4): the daemon's reason, and what to do about it.
 */
export class ValueCut extends JsnbError {
  declare readonly data: CutData;
  constructor(data: CutData, reason: string, options: Cause = {}) {
    const advice = cutAdvice(reason, data.cell);
    const asked =
      data.query === undefined
        ? `it has no exact ${data.format}`
        : `no ${data.query} query runs on it`;
    super({
      name: "ValueCut",
      message: `Output ${String(data.index)} of ${data.cell} was cut at the output limit and the daemon does not hold it whole, so ${asked}: ${reason}. ${advice === "" ? "" : `${advice} `}nimbo outputs ${data.cell} --format pretty shows the part that was kept.`,
      data,
      ...options,
    });
  }
}
