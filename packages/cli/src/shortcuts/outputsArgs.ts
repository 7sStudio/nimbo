// The flags of `nimbo outputs` (03-api §8): the four query flags, the query bar's modes (11-query), one at a time;
// --at for Filter's node; --limit, the most results a query gives; --format; --full, alone; --index to pick a value
// output other than the last.
import { InvalidArguments } from "../errors/cli.js";
import type { Format } from "./outputsFormat.js";
import { formats } from "./outputsFormat.js";
import type { ShortcutArgs } from "./shortcut.js";
import { notebookFlagHelp, notebookOption, stringOf } from "./shortcut.js";

export const outputsOptions = {
  ...notebookOption,
  where: { type: "string" },
  query: { type: "string" },
  jq: { type: "string" },
  sql: { type: "string" },
  at: { type: "string" },
  format: { type: "string" },
  full: { type: "boolean" },
  index: { type: "string" },
  limit: { type: "string" },
} as const;

export type AskedQuery = {
  readonly mode: "filter" | "jsonpath" | "jq" | "sql";
  readonly text: string;
  readonly at?: string;
};

const modes = [
  ["where", "filter"],
  ["query", "jsonpath"],
  ["jq", "jq"],
  ["sql", "sql"],
] as const;

const usage = (argument: string, reason: string): InvalidArguments =>
  new InvalidArguments({ argument, command: "outputs" }, reason);

/** The query the flags ask for, or undefined; two query flags, or --at without --where, are usage errors. */
function queryOf(values: ShortcutArgs["values"]): AskedQuery | undefined {
  const given = modes.flatMap(([flag, mode]) => {
    const text = stringOf(values[flag]);
    return text === undefined ? [] : [{ flag, mode, text }];
  });
  if (given.length > 1)
    throw usage(
      `--${given[1]?.flag ?? ""}`,
      `Give one of --where, --query, --jq and --sql, not ${given.map((g) => `--${g.flag}`).join(" and ")}.`,
    );
  const at = stringOf(values.at);
  const [first] = given;
  if (at !== undefined && first?.mode !== "filter")
    throw usage("--at", "--at names the node --where filters; give it with --where.");
  if (first === undefined) return undefined;
  return at === undefined
    ? { mode: first.mode, text: first.text }
    : { mode: first.mode, text: first.text, at };
}

/** What `nimbo outputs` was asked: the cell, the format, the output, a query, --full; `listed` when none of them. */
export type Plan = {
  readonly cell: string;
  readonly format: Format;
  readonly index: number | undefined;
  readonly query: AskedQuery | undefined;
  /** The most results the query gives (cell.outputQuery's limit); undefined for the daemon's default. */
  readonly limit: number | undefined;
  readonly full: boolean;
  readonly listed: boolean;
};

const formatOf = (value: string): Format => {
  const format = formats.find((known) => known === value);
  if (format === undefined) throw usage("--format", `--format is one of ${formats.join(", ")}.`);
  return format;
};

const indexOf = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text))
    throw usage("--index", `--index takes the number of an output; ${text} is not one.`);
  return Number(text);
};

const limitOf = (text: string | undefined, query: AskedQuery | undefined): number | undefined => {
  if (text === undefined) return undefined;
  if (query === undefined)
    throw usage("--limit", "--limit bounds a query's results; give it with a query flag.");
  const limit = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(limit))
    throw usage("--limit", `--limit takes a whole number of results from 1; ${text} is not one.`);
  return limit;
};

/** The plan of the flags; --full streams the value as the daemon serves it, so it takes no query and no format. */
export function planOf(args: ShortcutArgs): Plan {
  const query = queryOf(args.values);
  const given = stringOf(args.values.format);
  const full = args.values.full === true;
  if (full && (query !== undefined || given !== undefined)) {
    throw usage(
      "--full",
      "--full prints the whole value as the daemon streams it; it takes no query flag and no --format.",
    );
  }
  const index = indexOf(stringOf(args.values.index));
  const listed = given === undefined && index === undefined && query === undefined && !full;
  return {
    cell: args.positionals[0] ?? "",
    format: formatOf(given ?? "pretty"),
    index,
    query,
    limit: limitOf(stringOf(args.values.limit), query),
    full,
    listed,
  };
}

export const help = `nimbo outputs <cell> [flags]: the outputs of a cell's last run

With no flag, every output of the run as the page shows it. A query flag runs on the daemon (cell.outputQuery)
against one value output (the last one, or --index); --format prints that value, or the query's answer, as:
  pretty   the tree the page shows (output-view's model), fully open; SQL rows as a table (the default)
  json     plain JSON
  ndjson   one line per item of an array, one line for anything else
  csv      a table, a header row first: SQL rows (their columns), or a non-empty array of records (the union of
           their keys) or of arrays of one length; any other value is an error (exit 2)
A machine format is only ever the whole answer: one past the query's limit or time is an error (exit 4).

Flags:
${notebookFlagHelp}
  --where <chips>         Filter: key op value, comma-separated (status = failed, amount > 1000)
  --at <jsonpath>         with --where: the node whose children are filtered (default $; $.data for a list)
  --query <jsonpath>      JSONPath (RFC 9535): the paths and the nodes they select
  --jq <program>          jq: the program's outputs
  --sql <select>          SQL over table t, the value's rows (DuckDB); a list of plain values is column value
  --limit <n>             with a query: the most results it gives (default 2000; a SQL answer also stops at
                          query.sqlMaxRows, 10000 by default); json, ndjson and csv refuse an answer that stopped
                          short (exit 4), pretty shows the first with a note
  --format <format>       pretty, json, ndjson or csv
  --index <n>             the output to read, when it is not the last value output
  --full                  the whole value as the daemon streams it (past the 256 KB cap), never held in memory
  --json                  print the command's output verbatim (cell.outputs, or cell.outputQuery's answer)
`;
