// Where a debugger attached to the page finds the cells' names: a paused frame that does not close over
// the cell's scope, a breakpoint's condition and an evaluation with nothing paused read them through these getters on
// `globalThis`, which no code can redefine or delete; the latest realm and run of the page are the ones they answer.
import { pageRecordKey, pageScopeKey } from "@jsnb/core";

let record: Record<string, unknown> | undefined;
let view: Record<string, unknown> | undefined;

function define(key: string, get: () => unknown): void {
  const symbol = Symbol.for(key);
  if (Object.hasOwn(globalThis, symbol)) return;
  Object.defineProperty(globalThis, symbol, { get, configurable: false, enumerable: false });
}

/** The realm's record of the names cells defined, the Notebook scope a debugger shows. */
export function exposeRecord(own: Record<string, unknown>): void {
  record = own;
  view = undefined;
  define(pageRecordKey, () => record);
  define(pageScopeKey, () => view ?? record);
}

/** The scope the latest run reads its names through (the record, its bridge stubs, its builtins, `window`). */
export function exposeView(own: Record<string, unknown>): void {
  view = own;
}
