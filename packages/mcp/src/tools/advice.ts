// What a ResultTooLarge message tells the agent to call instead, per family of tools, with the real
// notebook, cell and output named and every CLI word shell-quoted: a notebook (get, open, create, reload) cell by cell;
// a cell by its own size, cell_outputs when its outputs alone fit, its source by its resource, or the CLI; a run's
// outputs by their bulk (its largest value read in parts with cell_outputValue and cell_outputQuery, its displays,
// streams and errors through `nimbo outputs`); notebook_run cell by cell, each by its own size, with cell_outputs, the
// CLI and notebook_errors when a run failed; a run's outcome (how many cells ended how, the first failures) first; cell_bindings through kernel_scope; a slice with the limit that takes as many of its entries
// as fit, or a deeper path once one entry is too large; jq's one result through a query that slices it, since its limit
// counts results; any other read through the same command on the CLI with the call's own flags. A tool that changes
// something is never told to do it again.
import type { AnyCommand, Execution } from "@jsnb/core";

import { byteSize } from "../errors/size.js";
import { jsnb, shellWord } from "../errors/words.js";
import type { Args, Exchange, Overshoot, Part } from "./adviceParts.js";
import { gitDiffAdvice } from "./gitDiffAdvice.js";
import { sliceAdvice } from "./sliceAdvice.js";
import { call, flagsOf, frameOf, isRecord, largest, partsOf, textOf } from "./adviceParts.js";

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
