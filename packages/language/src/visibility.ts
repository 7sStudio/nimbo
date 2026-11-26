// Which names a cell sees and where each comes from, in the scope's lookup order: its own
// names, other cells of its realm, the bridge (client cells), the built-ins. Types follow document order: the nearest
// cell above that defines a name, else the nearest below.
import type { CellId } from "@jsnb/core";

import { clientBuiltinNames, serverBuiltinNames } from "./builtins.js";
import type { CellDeclarations, NameKind } from "./declarations.js";

export type Realm = "server" | "client";

export type ScannedCell = {
  readonly id: CellId;
  readonly realm: Realm;
  readonly declarations: CellDeclarations;
};

type BridgeName = {
  readonly name: string;
  readonly provider: CellId;
  readonly kind: NameKind;
};

export type Visibility = {
  /** Provider cell → the names imported from it, in first-seen order. */
  readonly imports: ReadonlyMap<CellId, readonly string[]>;
  /** Server exports a client cell reaches through the bridge. */
  readonly bridge: readonly BridgeName[];
  /** The built-ins nothing above shadows. */
  readonly builtins: readonly string[];
};

/** The cell of `cells` that provides `name` to the cell at `index`: the nearest above, else the nearest below. */
function provider(
  cells: readonly ScannedCell[],
  index: number,
  has: (cell: ScannedCell) => boolean,
): ScannedCell | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const cell = cells[i];
    if (cell && has(cell)) return cell;
  }
  for (let i = index + 1; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell && has(cell)) return cell;
  }
  return undefined;
}

const unique = (lists: Iterable<Iterable<string>>): string[] => {
  const seen = new Set<string>();
  for (const list of lists) for (const name of list) seen.add(name);
  return [...seen];
};

/** Rule 2: for each name another cell of the realm declares and the cell does not, its provider. */
function sameRealmImports(cells: readonly ScannedCell[], cell: ScannedCell): Map<CellId, string[]> {
  const own = cell.declarations.names;
  const imports = new Map<CellId, string[]>();
  const sameRealm = cells.filter((other) => other.realm === cell.realm);
  const here = sameRealm.indexOf(cell);
  for (const name of unique(sameRealm.map((other) => other.declarations.names.keys()))) {
    const from = own.has(name)
      ? undefined
      : provider(sameRealm, here, (other) => other.declarations.names.has(name));
    if (from) imports.set(from.id, [...(imports.get(from.id) ?? []), name]);
  }
  return imports;
}

/** Rule 3: the server exports a client cell sees that nothing of its own realm provides. */
function bridgeNames(
  cells: readonly ScannedCell[],
  index: number,
  hidden: (name: string) => boolean,
): BridgeName[] {
  const servers = cells.filter((other) => other.realm === "server");
  const isExporter = (name: string) => (other: ScannedCell) =>
    other.realm === "server" && other.declarations.exported.has(name);
  return unique(servers.map((s) => s.declarations.exported.keys())).flatMap((name) => {
    if (hidden(name)) return [];
    const from = provider(cells, index, isExporter(name));
    const kind = from?.declarations.exported.get(name);
    return from && kind ? [{ name, provider: from.id, kind }] : [];
  });
}

/** What the cell at `index` of `cells` (the notebook's code cells in document order) sees from the others. */
export function visibility(cells: readonly ScannedCell[], index: number): Visibility {
  const cell = cells[index];
  if (!cell) return { imports: new Map(), bridge: [], builtins: [] };
  const own = cell.declarations.names;
  const imports = sameRealmImports(cells, cell);
  const imported = new Set([...imports.values()].flat());
  const bridge =
    cell.realm === "client"
      ? bridgeNames(cells, index, (name) => own.has(name) || imported.has(name))
      : [];
  const bridged = new Set(bridge.map((b) => b.name));
  const layer = cell.realm === "server" ? serverBuiltinNames : clientBuiltinNames;
  const builtins = layer.filter(
    (name) => !own.has(name) && !imported.has(name) && !bridged.has(name),
  );
  return { imports, bridge, builtins };
}

/** The names a cell of the other realm declares that `cell` cannot see: the cross-realm messages. */
export function otherRealmNames(cells: readonly ScannedCell[], realm: Realm): ReadonlySet<string> {
  const others = cells.filter((cell) => cell.realm !== realm);
  return new Set(unique(others.map((cell) => cell.declarations.names.keys())));
}
