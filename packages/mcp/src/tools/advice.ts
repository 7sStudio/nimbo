// What a ResultTooLarge message tells the agent to call instead, per family of tools, with the real
// notebook, cell and output named and every CLI word shell-quoted: a notebook (get, open, create, reload) cell by cell;
// a cell by its own size, cell_outputs when its outputs alone fit, its source by its resource, or the CLI; a run's
// outputs by their bulk (its largest value read in parts with cell_outputValue and cell_outputQuery, its displays,
// streams and errors through `nimbo outputs`); notebook_run cell by cell, each by its own size, with cell_outputs, the
// CLI and notebook_errors when a run failed; a run's outcome (how many cells ended how, the first failures) first; cell_bindings through kernel_scope; a slice with the limit that takes as many of its entries
// as fit, or a deeper path once one entry is too large; jq's one result through a query that slices it, since its limit
// counts results; git_diff one changed cell at a time; any other read through the same command on the CLI with the call's own flags. A tool that changes
// something is never told to do it again.
import type { AnyCommand, Execution } from "@jsnb/core";

import { byteSize } from "../errors/size.js";
import { jsnb, shellWord } from "../errors/words.js";
import { outputResult } from "./results.js";

type Args = Readonly<Record<string, unknown>>;

/** A call's arguments (as its schema read them) and the output it would have answered with. */
export type Exchange = { readonly input: Args; readonly output: Args };

/** How far past the cap the result went, in bytes. */
type Overshoot = { readonly bytes: number; readonly cap: number };

/** A call as the agent sends it: the tool's name and its arguments as JSON. */
const call = (tool: string, args: Args): string => `${tool} ${JSON.stringify(args)}`;

const isRecord = (value: unknown): value is Args =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const kebab = (key: string): string =>
  key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** One argument as its flags: a boolean as --x or --no-x, an array of scalars repeated, any other object as JSON. */
function flagOf(key: string, value: unknown): string[] {
  const flag = `--${kebab(key)}`;
  if (typeof value === "boolean") return [value ? flag : `--no-${kebab(key)}`];
  if (typeof value === "string" || typeof value === "number") return [flag, String(value)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.flatMap((item: string) => [flag, item]);
  return value === undefined ? [] : [flag, JSON.stringify(value)];
}

/** A call's arguments as the CLI's generated flags. */
const flagsOf = (input: Args): string[] =>
  Object.entries(input).flatMap(([key, value]) => flagOf(key, value));

/** One part of a run's outputs: a value output (`index`), or one cell's displays, streams and error together. */
type Part = { readonly cell: string; readonly index?: number; readonly bytes: number };

/** The parts of `executions`' outputs, with their sizes. */
function partsOf(executions: readonly Execution[]): {
  readonly values: readonly Part[];
  readonly others: readonly Part[];
} {
  const values: Part[] = [];
  const others: Part[] = [];
  for (const execution of executions) {
    let rest = execution.error === undefined ? 0 : byteSize(JSON.stringify(execution.error));
    execution.outputs.forEach((output, index) => {
      const bytes = byteSize(JSON.stringify(output));
      if (output.kind === "value") values.push({ cell: execution.cell, index, bytes });
      else rest += bytes;
    });
    if (rest > 0) others.push({ cell: execution.cell, bytes: rest });
  }
  return { values, others };
}

/** The largest of `parts`, or undefined for none. */
const largest = (parts: readonly Part[]): Part | undefined =>
  parts.reduce<Part | undefined>(
    (top, part) => (part.bytes > (top?.bytes ?? -1) ? part : top),
    undefined,
  );

/** The frame `output` makes as a tool's result: structuredContent and its text copy, as the cap measures it. */
const frameOf = (output: Args): number => byteSize(JSON.stringify(outputResult(output)));

/** A slice's entries (cell_outputValue's children, cell_outputQuery's rows, paths or values) and the output of `n`. */
type Entries = { readonly count: number; readonly first: (n: number) => Args };

function entriesOf(output: Args): Entries | undefined {
  const { json, result } = output;
  if (Array.isArray(json))
    return { count: json.length, first: (n) => ({ ...output, json: json.slice(0, n) }) };
  if (isRecord(json)) {
    const pairs = Object.entries(json);
    return {
      count: pairs.length,
      first: (n) => ({ ...output, json: Object.fromEntries(pairs.slice(0, n)) }),
    };
  }
  if (!isRecord(result)) return undefined;
  // JSONPath answers paths and values side by side: every list among them is cut at the same count.
  const lists = ["rows", "paths", "value"].flatMap((name) => {
    const list = result[name];
    return Array.isArray(list) ? [[name, list] as const] : [];
  });
  if (lists.length === 0) return undefined;
  const count = Math.max(...lists.map(([, list]) => list.length));
  const cut = (n: number): Args =>
    Object.fromEntries(lists.map(([name, list]) => [name, list.slice(0, n)]));
  return { count, first: (n) => ({ ...output, result: { ...result, ...cut(n) } }) };
}

/**
 * How many of a slice's first entries fit `cap` as one result (the same call with that limit answers them, whatever
 * their sizes), with a twentieth spare for the envelope; 0 when not even one does, undefined for a slice of no entries
 * (one scalar).
 */
function fittingEntries(output: Args, cap: number): number | undefined {
  const entries = entriesOf(output);
  if (entries === undefined) return undefined;
  const room = cap * 0.95;
  let [low, high] = [0, entries.count];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frameOf(entries.first(middle)) <= room) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** A notebook's path as a cell resource carries it, each segment percent-encoded as the resources' own URIs are. */
const cellUriOf = (path: string): string =>
  `nimbo://cell/${path.split("/").map(encodeURIComponent).join("/")}/`;

/** The notebook a call names: `notebook`, else the `path` of notebook_open and notebook_create. */
const notebookOf = ({ input }: Exchange): string =>
  textOf(input.notebook) ?? textOf(input.path) ?? "<notebook>";

/** The executions an output carries: cell_add's, cell_run's and cell_outputs' one, notebook_run's list, and the
 * dependents cell_run started (autoRun). */
function executionsOf(output: Args): readonly Execution[] {
  const found: unknown[] = Array.isArray(output.executions)
    ? output.executions
    : isRecord(output.execution)
      ? [output.execution]
      : [];
  const auto: unknown = isRecord(output.autoRun) ? output.autoRun.executions : undefined;
  const started: unknown[] = Array.isArray(auto) ? auto : [];
  return [...found, ...started].filter((execution): execution is Execution => isRecord(execution));
}

/** A value output read in parts. */
const valuePiece = (notebook: string, { cell, index }: Part): string => {
  const at = { notebook, cell, index };
  return `Read cell ${cell}'s value in parts with ${call("cell_outputValue", { ...at, path: "$", limit: 100 })}, or query it with ${call("cell_outputQuery", { ...at, mode: "jsonpath", query: "$[0:10]", limit: 10 })}; outside MCP, ${jsnb("outputs", cell, "--full", "-n", notebook)} gives the whole value.`;
};

/** One cell's displays, streams and error, through the CLI. */
const restPiece = (notebook: string, { cell }: Part, failed: boolean): string => {
  const errors = failed ? ` (${jsnb("errors", "-n", notebook)} lists the failures)` : "";
  return `Cell ${cell}'s other outputs (displays, streams, events, errors) are too large to send; outside MCP, ${jsnb("outputs", cell, "-n", notebook)} prints them${errors}.`;
};

/** The largest value output and the largest cell's other outputs, each named when it is at least a quarter of the bulk. */
function outputsPiece(notebook: string, executions: readonly Execution[]): string | undefined {
  const { values, others } = partsOf(executions);
  const total = [...values, ...others].reduce((sum, part) => sum + part.bytes, 0);
  const value = largest(values);
  const rest = largest(others);
  const failed = executions.some((execution) => execution.error !== undefined);
  const pieces = [
    value !== undefined && value.bytes * 4 >= total ? valuePiece(notebook, value) : undefined,
    rest !== undefined && rest.bytes * 4 >= total ? restPiece(notebook, rest, failed) : undefined,
  ].filter((piece) => piece !== undefined);
  return pieces.length === 0 ? undefined : pieces.join(" ");
}

/** A cell's source when it is the bulk of the result: its resource while its text fits the cap (as the resource read measures it), else the CLI. */
function sourcePiece(
  notebook: string,
  id: string,
  source: string,
  cap: number,
): string | undefined {
  const bytes = byteSize(JSON.stringify(source));
  if (bytes <= cap / 2) return undefined;
  return bytes <= cap
    ? `Read cell ${id}'s source alone as the resource ${cellUriOf(notebook)}${encodeURIComponent(id)}.`
    : `Cell ${id}'s source alone is too large for one result; outside MCP, ${jsnb("cat", id, "-n", notebook)} prints it.`;
}

/** The cell a call or its answer names. */
const cellIdOf = (exchange: Exchange, executions: readonly Execution[]): string => {
  const cell = isRecord(exchange.output.cell) ? exchange.output.cell : {};
  return textOf(cell.id) ?? textOf(exchange.input.cell) ?? executions[0]?.cell ?? "<cell>";
};

/** A cell's outputs: cell_outputs when they alone fit (an answer that carried the cell too), else their bulk. */
function outputsRoute(exchange: Exchange, id: string, cap: number): string | undefined {
  const notebook = notebookOf(exchange);
  const executions = executionsOf(exchange.output);
  const [execution] = executions;
  const alone =
    execution !== undefined &&
    isRecord(exchange.output.cell) &&
    frameOf({ execution }) <= cap * 0.95;
  return alone
    ? `Read its outputs alone with ${call("cell_outputs", { notebook, cell: id })}.`
    : outputsPiece(notebook, executions);
}

/** cell_add, cell_get, cell_update, cell_move, cell_run, cell_outputs: the source by itself, then the outputs. */
function cellAdvice(exchange: Exchange, cap: number): string {
  const notebook = notebookOf(exchange);
  const id = cellIdOf(exchange, executionsOf(exchange.output));
  const source = isRecord(exchange.output.cell) ? textOf(exchange.output.cell.source) : undefined;
  // a run's outcome first (cell_add with run, cell_run); a read (cell_outputs) states none
  const ran = exchange.input.run === true || "wait" in exchange.input;
  const pieces = [
    ran ? outcomeOf(executionsOf(exchange.output)) : undefined,
    sourcePiece(notebook, id, source ?? "", cap),
    outputsRoute(exchange, id, cap),
  ].filter((piece) => piece !== undefined);
  if (pieces.length > 0) return pieces.join(" ");
  return `Outside MCP, ${jsnb("cat", id, "-n", notebook)} prints cell ${id}'s source and ${jsnb("outputs", id, "-n", notebook)} its outputs.`;
}

/** notebook_get, notebook_open, notebook_create, notebook_reload: the cells one at a time. */
function notebookAdvice(exchange: Exchange): string {
  const notebook = notebookOf(exchange);
  return `Read its cells one at a time: the resource ${cellUriOf(notebook)}<id> for each id, which resources/list or ${call("notebook_graph", { notebook })} names (a cell too large even alone prints outside MCP with nimbo cat <id> -n ${shellWord(notebook)}).`;
}

/**
 * How the runs ended, which the agent needs whatever it reads next: `Ran 9 cells: 8 ok, 1 error (c_a1b2c3 TypeError:
 * …).`, the first three failures named with their error's first line.
 */
function outcomeOf(executions: readonly Execution[]): string | undefined {
  if (executions.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const execution of executions)
    counts.set(execution.status, (counts.get(execution.status) ?? 0) + 1);
  const tally = [...counts].map(([status, count]) => `${String(count)} ${status}`).join(", ");
  const failed = executions.filter((execution) => execution.error !== undefined).slice(0, 3);
  const named = failed
    .map(
      ({ cell, error }) =>
        `${cell} ${error?.name ?? "Error"}: ${(error?.message ?? "").split("\n")[0] ?? ""}`,
    )
    .join("; ");
  const cells = executions.length === 1 ? "1 cell" : `${String(executions.length)} cells`;
  return `Ran ${cells}: ${tally}${named === "" ? "" : ` (${named})`}.`;
}

/** A list of cells as the message names them: the first twelve, then an ellipsis. */
const listed = (cells: readonly string[]): string =>
  cells.length > 12 ? `${cells.slice(0, 12).join(", ")}, …` : cells.join(", ");

/** A cell too large even alone: the bulk of its outputs through the CLI (or its value in parts). */
const aloneTooLarge = (notebook: string, execution: Execution): string =>
  outputsPiece(notebook, [execution]) ??
  `Cell ${execution.cell}'s outputs are too large even alone; outside MCP, ${jsnb("outputs", execution.cell, "-n", notebook)} prints them.`;

/**
 * notebook_run: each executed cell routed by its own size, measured as cell_outputs would answer it: the cells that fit
 * through cell_outputs (the first named exactly), each that does not through its own bulk (the first three), and the
 * failures through notebook_errors.
 */
function runAdvice(exchange: Exchange, cap: number): string {
  const notebook = notebookOf(exchange);
  const executions = executionsOf(exchange.output);
  const fits = executions.filter((execution) => frameOf({ execution }) <= cap * 0.95);
  const big = executions.filter((execution) => !fits.includes(execution));
  const outcome = outcomeOf(executions);
  const pieces: string[] = outcome === undefined ? [] : [outcome];
  const [first] = fits;
  if (first !== undefined)
    pieces.push(
      `Read the outputs of cells ${listed(fits.map((execution) => execution.cell))} one cell at a time with ${call("cell_outputs", { notebook, cell: first.cell })}.`,
    );
  pieces.push(...big.slice(0, 3).map((execution) => aloneTooLarge(notebook, execution)));
  if (big.length > 3)
    pieces.push(`Likewise for cells ${listed(big.slice(3).map((execution) => execution.cell))}.`);
  if (executions.some((execution) => execution.error !== undefined))
    pieces.push(`The failures are in ${call("notebook_errors", { notebook })}.`);
  return pieces.join(" ");
}

/** Any other tool: a read through the same command on the CLI, its own flags; a change, nothing to do again. */
function cliAdvice(command: AnyCommand, { input }: Exchange): string {
  if (command.tags.mutating || command.tags.destructive)
    return "Ask for less next time with narrower arguments; the result of this one is not sent.";
  const [domain = "", verb = ""] = command.name.split(".");
  const words = verb.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return `Ask for less with narrower arguments; outside MCP, ${jsnb(domain, words, ...flagsOf(input), "--json")} gives the whole answer.`;
}

/**
 * cell_outputValue and cell_outputQuery: the limit that takes as many of the slice's first entries as fit the cap,
 * counted from the entries it came back with, whatever their sizes (one step); or, when not even one fits, a deeper
 * path, a narrower query, or the CLI.
 */
function sliceAdvice(command: AnyCommand, exchange: Exchange, overshoot: Overshoot): string {
  const { input, output } = exchange;
  const tool = command.name === "cell.outputValue" ? "cell_outputValue" : "cell_outputQuery";
  const whole = `outside MCP, ${jsnb("outputs", String(input.cell), "--full", "-n", String(input.notebook))} gives the whole value`;
  if (output.mode === "jq" && Number(output.total) <= 1)
    return jqAdvice(exchange, overshoot, whole);
  const fitting = fittingEntries(output, overshoot.cap);
  if (fitting === undefined || fitting < 1) return tooLargeAlone(tool, input, fitting, whole);
  const narrow = tool === "cell_outputValue" ? "or a deeper path" : "or a query that narrows them";
  return `Ask for fewer entries (a smaller limit) ${narrow}: ${call(tool, { ...input, limit: fitting })}; ${whole}.`;
}

/** A slice of which not even one entry fits: a narrower query, a deeper path, or (one scalar) the CLI. */
function tooLargeAlone(
  tool: string,
  input: Args,
  fitting: number | undefined,
  whole: string,
): string {
  if (tool === "cell_outputQuery")
    return `One result is too large even alone: narrow the query to a part of it; ${whole}.`;
  const path = textOf(input.path) ?? "$";
  return fitting === undefined
    ? `The value at ${path} is one scalar too large for one result; ${whole}.`
    : `One entry is too large for one result even alone: read inside it with a deeper path (one of its keys or indexes below ${path}); ${whole}.`;
}

/**
 * jq's one result too large: its limit counts jq's results, not the entries inside one, so a smaller limit answers the
 * same; an array result is sliced in the query itself, as many entries as fit, and anything else narrowed by a path.
 */
function jqAdvice({ input, output }: Exchange, { cap }: Overshoot, whole: string): string {
  const query = textOf(input.query) ?? ".";
  const fitting = fittingEntries(output, cap);
  if (fitting !== undefined && fitting >= 1)
    return `Its one result is an array too large to send: slice it in the query, ${call("cell_outputQuery", { ...input, query: `(${query}\n) | .[0:${String(fitting)}]` })}; ${whole}.`;
  return `Its one result is too large to send: narrow the query to a part of it (a path into the result); ${whole}.`;
}

/** The ids of a notebook diff's changed cells, in the new order. */
function changedCells(output: Exchange["output"]): readonly string[] {
  const notebook = output.notebook;
  if (!isRecord(notebook) || !Array.isArray(notebook.rows)) return [];
  return notebook.rows.flatMap((row: unknown) => {
    if (!isRecord(row) || row.status === "unchanged") return [];
    const side = isRecord(row.after) ? row.after : isRecord(row.before) ? row.before : undefined;
    const id = textOf(side?.id);
    return id === undefined ? [] : [id];
  });
}

function gitDiffAdvice({ input, output }: Exchange): string {
  const path = textOf(input.path) ?? "<path>";
  const base = textOf(input.base);
  const against = {
    ...(input.staged === true ? { staged: true } : {}),
    ...(base === undefined ? {} : { base }),
  };
  const cells = changedCells(output);
  const [first] = cells;
  const whole = `outside MCP, ${jsnb("diff", path, ...(input.staged === true ? ["--staged"] : []), ...(base === undefined ? [] : ["--base", base]))} prints the whole diff.`;
  if (first === undefined) return `Ask for less with narrower arguments; ${whole}`;
  const shown =
    cells.length > 20
      ? `${cells.slice(0, 20).join(", ")} and ${String(cells.length - 20)} more`
      : cells.join(", ");
  return `Read the diff one changed cell at a time with ${call("git_diff", { path, ...against, cell: first })}; the changed cells are ${shown}. Or, ${whole}`;
}

type Advice = (command: AnyCommand, exchange: Exchange, overshoot: Overshoot) => string;

const notebookFamily: Advice = (_command, exchange) => notebookAdvice(exchange);
const cellFamily: Advice = (_command, exchange, { cap }) => cellAdvice(exchange, cap);
const bindingsFamily: Advice = (_command, exchange) => {
  const notebook = notebookOf(exchange);
  return `Preview each binding with ${call("kernel_scope", { notebook, realm: "server" })} (realm "client" for a client cell); to read one whole, run a cell whose value is its name, ${call("cell_add", { notebook, type: "server", source: "<name>", run: true })}, and read that cell's value with cell_outputValue.`;
};

/** The advice of each tool whose result can be large; every other tool's is the CLI's. */
const families: Readonly<Record<string, Advice>> = {
  "cell.outputValue": sliceAdvice,
  "cell.outputQuery": sliceAdvice,
  "notebook.get": notebookFamily,
  "notebook.open": notebookFamily,
  "notebook.create": notebookFamily,
  "notebook.reload": notebookFamily,
  "notebook.run": (_command, exchange, { cap }) => runAdvice(exchange, cap),
  "cell.bindings": bindingsFamily,
  "cell.add": cellFamily,
  "cell.get": cellFamily,
  "cell.update": cellFamily,
  "cell.move": cellFamily,
  "cell.run": cellFamily,
  "cell.outputs": cellFamily,
  "git.diff": (_command, exchange) => gitDiffAdvice(exchange),
};

/** The exact call that reads in parts what `command` would have answered. */
export const adviceFor: Advice = (command, exchange, overshoot) =>
  (families[command.name] ?? cliAdvice)(command, exchange, overshoot);
