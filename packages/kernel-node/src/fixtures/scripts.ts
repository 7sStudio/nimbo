// Functions compiled under a script name of the test's choosing, as the kernel compiles a cell's code under
// jsnb:///<notebook>/<cell>.ts and Node a module's under its file URL: the interrupt hook's tests read their frames.
import { runInThisContext } from "node:vm";

/** The URL of the one cell these tests compile. */
const cellUrl = "jsnb:///test.jsnb/c_aaaaaa.ts";

/** `source`, a function expression, compiled under `filename` and called with `args`. */
export function callScript(filename: string, source: string, args: readonly unknown[]): unknown {
  const script: unknown = runInThisContext(source, { filename });
  if (typeof script !== "function") throw new Error(`not a function: ${source}`);
  return Reflect.apply(script, undefined, args);
}

/** `check` called from a function compiled under `filename`. */
export const asScript = (filename: string, check: () => unknown): unknown =>
  callScript(filename, "(function script(check) { return check() })", [check]);

/** `check` called from the cell's code. */
export const asCell = (check: () => unknown): unknown => asScript(cellUrl, check);

/** The kernel's lookup of a cell by its script name, knowing the one cell these tests compile. */
export const cellOf = (url: string): string | undefined =>
  url === cellUrl ? "c_aaaaaa" : undefined;
