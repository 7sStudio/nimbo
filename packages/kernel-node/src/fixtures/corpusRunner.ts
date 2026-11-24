// Runs a 04-kernel §12 corpus case through a real kernel: every cell compiled up front (the transform is not test
// time), each run checked for its value or its error (name, message, line of the cell's own frame), then the export
// table against the cells that exported each name.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { KernelEvent } from "@jsnb/core";
import { decode } from "@jsnb/core";
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { compileCell } from "@jsnb/test-tools/kernel";
import { expect } from "vitest";

import type { CorpusCase, CorpusCell } from "./corpus.js";
import type { KernelWorld } from "./kernelWorld.js";

/** A compiled cell, or the transform's rejection of it. */
type Compiled = { readonly cell: CompiledCell } | { readonly rejected: unknown };

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

/** The id of cell `index`: a keyed cell takes the id of the first cell with its key. */
function cellIdOf(testCase: CorpusCase, index: number): string {
  const key = testCase.cells[index]?.key;
  const first = key === undefined ? index : testCase.cells.findIndex((cell) => cell.key === key);
  return `c_${pad(testCase.id, 2)}${pad(first, 4)}`;
}

function compileOne(testCase: CorpusCase, index: number, cell: CorpusCell): Compiled {
  try {
    const ids = { cell: cellIdOf(testCase, index), execution: "x_00000000" };
    return { cell: compileCell(cell.source, ids) };
  } catch (rejected) {
    // The transform refuses the cell (export default): the case expects that, the daemon never sends it.
    return { rejected };
  }
}

/** Every cell of every case, compiled; call it in beforeAll. */
export function compileCases(
  cases: readonly CorpusCase[],
): ReadonlyMap<number, readonly Compiled[]> {
  return new Map(
    cases.map((testCase) => [
      testCase.id,
      testCase.cells.map((cell, index) => compileOne(testCase, index, cell)),
    ]),
  );
}

let runs = 0;
/** A fresh execution of a compiled cell. */
const executionOf = (cell: CompiledCell): CompiledCell => {
  runs += 1;
  return { ...cell, execution: `x_${pad(runs, 8)}` };
};

type Expected = NonNullable<CorpusCell["error"]>;

function checkError(expected: Expected, terminal: KernelEvent | undefined, cellId: string): void {
  expect(terminal).toMatchObject({ kind: "status", status: "error" });
  const error = terminal?.kind === "status" ? terminal.error : undefined;
  expect(error).toMatchObject({ name: expected.name });
  if (expected.message !== undefined) expect(error?.message).toBe(expected.message);
  if (expected.line === undefined) return;
  expect(error?.frames.find((frame) => frame.cell === cellId)?.line).toBe(expected.line);
}

function checkRun(cell: CorpusCell, events: readonly KernelEvent[], cellId: string): void {
  const terminal = events.at(-1);
  if (cell.error) {
    checkError(cell.error, terminal, cellId);
    return;
  }
  expect(terminal, cell.source).toMatchObject({ kind: "status", status: "ok" });
  if (!Object.hasOwn(cell, "value")) return;
  const shown = events.flatMap((event) =>
    event.kind === "output" && event.output.kind === "value" ? [decode(event.output.json)] : [],
  );
  expect(shown, cell.source).toEqual(cell.value === undefined ? [] : [cell.value]);
}

/** Runs `testCase` in `world`, cell after cell, and checks every run and the final export table. */
export async function runCase(
  world: KernelWorld,
  testCase: CorpusCase,
  compiled: readonly Compiled[],
): Promise<void> {
  let executed = 0;
  for (const [index, cell] of testCase.cells.entries()) {
    const entry = compiled[index];
    if (!entry || "rejected" in entry) {
      expect(entry && "rejected" in entry ? entry.rejected : undefined).toMatchObject({
        name: cell.rejects,
      });
      continue;
    }
    checkRun(cell, await world.run(executionOf(entry.cell)), entry.cell.cell);
    executed += 1;
  }
  if (!testCase.exports) return;
  await world.until((seen) => seen.exports.length >= executed);
  const expected = Object.entries(testCase.exports).map(([name, index]) => ({
    name,
    cell: cellIdOf(testCase, index),
  }));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  expect([...world.kernel.exports()].sort(byName)).toEqual(expected.sort(byName));
}

/** Writes a case's files into the workspace. */
export async function writeFiles(world: KernelWorld, testCase: CorpusCase): Promise<void> {
  for (const [path, text] of Object.entries(testCase.files ?? {})) {
    await mkdir(dirname(world.ws.path(path)), { recursive: true });
    await writeFile(world.ws.path(path), text);
  }
}
