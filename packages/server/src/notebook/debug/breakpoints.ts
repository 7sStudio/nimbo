// A notebook's breakpoints: by cell and line, each with js-debug's id once sent; lines follow the cell's edits; one
// breakpoint per line, as in VS Code; a blank or comment line's goes on the next line with code.
import type { Breakpoint, CellId } from "@jsnb/core";

import { mapLines } from "./lines.js";

export type BreakpointRecord = {
  readonly breakpointId: string;
  readonly cell: CellId;
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  verified: boolean;
  /** Its condition or a logpoint's expression does not parse, or threw when hit. */
  message?: string;
  /** js-debug's id from its last setBreakpoints answer: unique within the cell's source only. */
  dapId?: number;
};

export type BreakpointOptions = {
  readonly condition?: string | undefined;
  readonly hitCondition?: string | undefined;
  readonly logMessage?: string | undefined;
};

const toApi = (record: BreakpointRecord): Breakpoint => ({
  breakpointId: record.breakpointId,
  cell: record.cell,
  line: record.line,
  verified: record.verified,
  ...(record.condition === undefined ? {} : { condition: record.condition }),
  ...(record.hitCondition === undefined ? {} : { hitCondition: record.hitCondition }),
  ...(record.logMessage === undefined ? {} : { logMessage: record.logMessage }),
  ...(record.message === undefined ? {} : { message: record.message }),
});

const option = (
  record: BreakpointRecord,
  key: keyof BreakpointOptions,
  value: string | undefined,
): void => {
  if (value === undefined) return;
  if (value === "") Reflect.deleteProperty(record, key);
  else record[key] = value;
};

/** A line with nothing to stop on: blank, or a comment alone. */
const noCode = (text: string): boolean => /^\s*(?:\/\/.*)?$/u.test(text);

/** `line` of `source`, or the first line after it with code, where V8 can stop; `line` when none follows. */
export function codeLineFrom(source: string, line: number): number {
  const lines = source.split("\n");
  for (let at = line; at <= lines.length; at += 1) if (!noCode(lines[at - 1] ?? "")) return at;
  return line;
}

export class Breakpoints {
  readonly #records: BreakpointRecord[] = [];
  #last = 0;

  list(): Breakpoint[] {
    return [...this.#records]
      .sort((a, b) => a.cell.localeCompare(b.cell) || a.line - b.line)
      .map(toApi);
  }

  ofCell(cell: CellId): BreakpointRecord[] {
    return this.#records.filter((record) => record.cell === cell).sort((a, b) => a.line - b.line);
  }

  all(): BreakpointRecord[] {
    return [...this.#records];
  }

  cells(): CellId[] {
    return [...new Set(this.#records.map((record) => record.cell))];
  }

  size(): number {
    return this.#records.length;
  }

  /** Sets (or changes) the breakpoint on `cell`'s `line`; an empty option string removes that option. */
  set(cell: CellId, line: number, options: BreakpointOptions): BreakpointRecord {
    let record = this.#records.find((each) => each.cell === cell && each.line === line);
    if (!record) {
      this.#last += 1;
      record = { breakpointId: `bp${String(this.#last)}`, cell, line, verified: false };
      this.#records.push(record);
    }
    option(record, "condition", options.condition);
    option(record, "hitCondition", options.hitCondition);
    option(record, "logMessage", options.logMessage);
    delete record.message;
    return record;
  }

  /** The breakpoint js-debug knows as `dapId` in `cell`'s source, the one on `line` when several share the id (js-debug
   * gives two breakpoints of a source the same id); none when that does not tell them apart. */
  byDapId(cell: CellId, dapId: number, line: number | undefined): BreakpointRecord | undefined {
    const found = this.#records.filter((record) => record.cell === cell && record.dapId === dapId);
    return (
      found.find((record) => record.line === line) ?? (found.length === 1 ? found[0] : undefined)
    );
  }

  byId(breakpointId: string): BreakpointRecord | undefined {
    return this.#records.find((record) => record.breakpointId === breakpointId);
  }

  remove(gone: readonly BreakpointRecord[]): void {
    for (const record of gone) {
      const at = this.#records.indexOf(record);
      if (at !== -1) this.#records.splice(at, 1);
    }
  }

  /** The cell's code changed from `before` to `after`: its breakpoints move with their lines (two on one line merge). */
  edited(cell: CellId, before: string, after: string): void {
    const own = this.ofCell(cell);
    if (own.length === 0 || before === after) return;
    const moved = mapLines(
      before,
      after,
      own.map((record) => record.line),
    );
    const taken = new Set<number>();
    own.forEach((record, index) => {
      const line = moved[index] ?? record.line;
      if (taken.has(line)) this.remove([record]);
      else {
        taken.add(line);
        record.line = line;
      }
    });
  }

  /** js-debug bound a breakpoint at `line`: it moves there, unless another one holds that line (it then goes, and
   * true says js-debug must be sent the cell's list again). A move to an earlier line is not taken. */
  bound(record: BreakpointRecord, line: number): boolean {
    if (record.line >= line) return false;
    const other = this.#records.find(
      (each) => each !== record && each.cell === record.cell && each.line === line,
    );
    if (!other) {
      record.line = line;
      return false;
    }
    this.remove([record]);
    return true;
  }

  unverifyAll(): void {
    for (const record of this.#records) {
      record.verified = false;
      delete record.dapId;
    }
  }
}
