// The metadata of each scope name (Binding): the cell that defined it and its declaration kind.
import type { BindingKind, CellId } from "@jsnb/core";

type NameInfo = { readonly definedBy: CellId; readonly kind: BindingKind };

/** What one finished run tells about the names it defined. */
export type RunFacts = {
  readonly cell: CellId;
  readonly ok: boolean;
  readonly defines: readonly string[];
  readonly kinds: Readonly<Partial<Record<string, BindingKind>>>;
  /** The values the record held for `defines` before the run; a name absent here was not defined yet. */
  readonly before: ReadonlyMap<string, unknown>;
  readonly record: Readonly<Record<string, unknown>>;
};

export type Names = {
  /** A write created `name` on the record from `cell` (a timer's write included): `var` until a run says better. */
  readonly created: (name: string, cell: CellId) => void;
  /**
   * After a run, each name of `defines` the record has is attributed to the run's cell with its kind; a run that
   * ended in error claims only the names it created or changed (`Object.is` against `before`).
   */
  readonly attribute: (run: RunFacts) => void;
  readonly get: (name: string) => NameInfo | undefined;
};

/** An empty table of name metadata. */
export function createNames(): Names {
  const table = new Map<string, NameInfo>();
  const claims = (run: RunFacts, name: string): boolean => {
    if (!Object.hasOwn(run.record, name)) return false;
    if (run.ok) return true;
    return !run.before.has(name) || !Object.is(run.before.get(name), run.record[name]);
  };
  return {
    created: (name, cell) => {
      table.set(name, { definedBy: cell, kind: "var" });
    },
    attribute: (run) => {
      for (const name of run.defines) {
        if (!claims(run, name)) continue;
        const kind = run.kinds[name] ?? table.get(name)?.kind ?? "var";
        table.set(name, { definedBy: run.cell, kind });
      }
    },
    get: (name) => table.get(name),
  };
}
