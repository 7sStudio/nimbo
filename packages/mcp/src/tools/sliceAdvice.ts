// The result-cap advice for a slice too large (advice.ts's families): cell_outputValue and
// cell_outputQuery with the limit that takes as many of the slice's first entries as fit, counted on the entries in
// hand whatever their sizes; jq's one result sliced in the query itself, since jq's limit counts results; a deeper
// path or a narrower query once not even one entry fits; and always `nimbo outputs --full` for the whole value.
import type { AnyCommand } from "@jsnb/core";

import { jsnb } from "../errors/words.js";
import type { Args, Exchange, Overshoot } from "./adviceParts.js";
import { call, fittingEntries, textOf } from "./adviceParts.js";

/**
 * cell_outputValue and cell_outputQuery: the limit that takes as many of the slice's first entries as fit the cap,
 * counted from the entries it came back with, whatever their sizes (one step); or, when not even one fits, a deeper
 * path, a narrower query, or the CLI.
 */
export function sliceAdvice(command: AnyCommand, exchange: Exchange, overshoot: Overshoot): string {
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
