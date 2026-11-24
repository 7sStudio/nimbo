// The export table of 04-kernel §2.1 and 05-bridge §3: each exported name, its local name and the exporting cell.
import type { CellId } from "@jsnb/core";

type ExportTarget = { readonly local: string; readonly cell: CellId };

export type Exports = {
  /** `__scope.__export(name, from)` run by `cell`: `name` is exported, read from the local `from`. */
  readonly register: (name: string, local: string, cell: CellId) => void;
  /** Drops what `cell` exported, before it re-runs (04-kernel §4 step 4). */
  readonly clear: (cell: CellId) => void;
  /** The current table, in registration order, as the `exports` message carries it. */
  readonly list: () => readonly { readonly name: string; readonly cell: CellId }[];
  readonly resolve: (name: string) => ExportTarget | undefined;
  /** True when some export reads the local `name` (`Binding.exported`). */
  readonly isExported: (local: string) => boolean;
};

/** An empty export table. */
export function createExports(): Exports {
  const table = new Map<string, ExportTarget>();
  return {
    register: (name, local, cell) => {
      table.delete(name);
      table.set(name, { local, cell });
    },
    clear: (cell) => {
      for (const [name, target] of table) if (target.cell === cell) table.delete(name);
    },
    list: () => [...table].map(([name, target]) => ({ name, cell: target.cell })),
    resolve: (name) => table.get(name),
    isExported: (local) => [...table.values()].some((target) => target.local === local),
  };
}
