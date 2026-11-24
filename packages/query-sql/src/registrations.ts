// The tables an engine registered, in order, with their aliases (and their sources where the engine restarts), so a
// restarted engine replays them. Names compare as DuckDB compares identifiers: ASCII letters ignore case.
import type { TableSource } from "./engine.ts";
import type { Outcome } from "./errors.ts";
import { QueryError, messages } from "./errors.ts";

type Registration = {
  readonly table: string;
  /** Kept only by an engine that restarts and replays; the daemon's never does. */
  readonly source: TableSource | undefined;
  readonly alias: string | undefined;
};

export type Registrations = {
  /** Every registration, oldest first: the order a restarted engine replays them in. */
  list(): readonly Registration[];
  aliasOf(table: string): string | undefined;
  /** Checks the names against the other registrations; the value is the alias views the change leaves stale. */
  plan(table: string, alias: string | undefined): Outcome<readonly string[]>;
  /** Records a registration (replacing one whose name differs only in case); an alias another table owned moves. */
  remember(registration: Registration): void;
  forget(table: string): void;
  clear(): void;
};

/** A name as DuckDB looks it up: identifiers are case-insensitive (ASCII), even quoted. */
const fold = (name: string) => name.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());

/** True when DuckDB sees the two names as the same identifier. */
export const sameName = (a: string, b: string): boolean => fold(a) === fold(b);

type ByTable = Map<string, Registration>;

const ownerOf = (byTable: ByTable, alias: string) =>
  [...byTable.values()].find(
    (registration) => registration.alias !== undefined && sameName(registration.alias, alias),
  )?.table;

const taken = (name: string, owner: string): Outcome<never> => ({
  ok: false,
  error: new QueryError("input", messages.taken(name, owner)),
});

/** A table named like another table's alias, or an alias named like another table, is refused. */
function conflict(byTable: ByTable, table: string, alias: string | undefined) {
  const tableOwner = ownerOf(byTable, table);
  if (tableOwner !== undefined && !sameName(tableOwner, table)) return taken(table, tableOwner);
  const aliasTable = alias === undefined ? undefined : byTable.get(fold(alias))?.table;
  return alias !== undefined && aliasTable !== undefined ? taken(alias, aliasTable) : undefined;
}

function plan(
  byTable: ByTable,
  table: string,
  alias: string | undefined,
): Outcome<readonly string[]> {
  const refused = conflict(byTable, table, alias);
  if (refused !== undefined) return refused;
  const previous = byTable.get(fold(table))?.alias;
  const kept = previous === undefined || (alias !== undefined && sameName(previous, alias));
  return { ok: true, value: kept ? [] : [previous] };
}

function remember(byTable: ByTable, registration: Registration) {
  const owner = registration.alias === undefined ? undefined : ownerOf(byTable, registration.alias);
  const moved = owner === undefined ? undefined : byTable.get(fold(owner));
  if (moved !== undefined && !sameName(moved.table, registration.table)) {
    byTable.set(fold(moved.table), { ...moved, alias: undefined });
  }
  byTable.delete(fold(registration.table));
  byTable.set(fold(registration.table), registration);
}

/** An empty record of registrations. */
export function createRegistrations(): Registrations {
  const byTable: ByTable = new Map();
  return {
    list: () => [...byTable.values()],
    aliasOf: (table) => byTable.get(fold(table))?.alias,
    plan: (table, alias) => plan(byTable, table, alias),
    remember: (registration) => {
      remember(byTable, registration);
    },
    forget: (table) => {
      byTable.delete(fold(table));
    },
    clear: () => {
      byTable.clear();
    },
  };
}
