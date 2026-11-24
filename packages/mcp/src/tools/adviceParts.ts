// The pieces ResultTooLarge's advice is made of (advice.ts): a call as the agent sends it, a call's arguments as the
// CLI's generated flags (03-api §8), the parts of a run's outputs by size (each value output, and per cell its other
// outputs and error), the frame an output makes as a tool's result, and how many of a slice's entries fit the cap.
import type { Execution } from "@jsnb/core";

import { byteSize } from "../errors/size.js";
import { outputResult } from "./results.js";

export type Args = Readonly<Record<string, unknown>>;

/** A call's arguments (as its schema read them) and the output it would have answered with. */
export type Exchange = { readonly input: Args; readonly output: Args };

/** How far past the cap the result went, in bytes. */
export type Overshoot = { readonly bytes: number; readonly cap: number };

/** A call as the agent sends it: the tool's name and its arguments as JSON. */
export const call = (tool: string, args: Args): string => `${tool} ${JSON.stringify(args)}`;

export const isRecord = (value: unknown): value is Args =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const textOf = (value: unknown): string | undefined =>
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

/** A call's arguments as the CLI's generated flags (03-api §8). */
export const flagsOf = (input: Args): string[] =>
  Object.entries(input).flatMap(([key, value]) => flagOf(key, value));

/** One part of a run's outputs: a value output (`index`), or one cell's displays, streams and error together. */
export type Part = { readonly cell: string; readonly index?: number; readonly bytes: number };

/** The parts of `executions`' outputs, with their sizes. */
export function partsOf(executions: readonly Execution[]): {
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
export const largest = (parts: readonly Part[]): Part | undefined =>
  parts.reduce<Part | undefined>(
    (top, part) => (part.bytes > (top?.bytes ?? -1) ? part : top),
    undefined,
  );

/** The frame `output` makes as a tool's result: structuredContent and its text copy, as the cap measures it. */
export const frameOf = (output: Args): number => byteSize(JSON.stringify(outputResult(output)));

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
export function fittingEntries(output: Args, cap: number): number | undefined {
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
