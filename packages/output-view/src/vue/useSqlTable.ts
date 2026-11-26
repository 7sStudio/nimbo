// SQL mode's table: the output's rows registered as `t` (plus the binding's alias) before the first
// query, from the full value when the page only has the 256 KB slice; one table per page engine, so an output that
// finds another's rows in `t` registers its own again; dropped when the output changes or the view goes away.
import type { Ref, ShallowRef } from "vue";
import { onScopeDispose, shallowRef, watch } from "vue";

import type { QueryEngines, SqlQueryEngine, SqlSchema } from "../model/engines.js";
import { fullValueJson } from "../model/output.js";
import { toPlain } from "../model/plain.js";
import type { QueryFailure } from "../model/query.js";
import { registerRows } from "../model/run.js";

export type SqlTableSource = {
  readonly engines: Readonly<Ref<QueryEngines | undefined>>;
  /** The value's wire form: its rows, as plain JSON, are what `t` holds when nothing was cut. */
  readonly json: Readonly<Ref<unknown>>;
  /** The value was cut to the slice: the full one comes from `fullValueUrl`. */
  readonly truncated: Readonly<Ref<boolean>>;
  readonly fullValueUrl: Readonly<Ref<string | undefined>>;
  readonly fetchFullValue: (url: string, signal: AbortSignal) => Promise<Blob>;
  readonly alias: Readonly<Ref<string | undefined>>;
  /** Shows a failure the bar has no line for: the table that would not drop when the output changed. */
  readonly report: (message: string) => void;
};

type Ready =
  | { readonly ok: true; readonly value: SqlSchema }
  | { readonly ok: false; readonly error: QueryFailure };

type Table = {
  readonly me: symbol;
  readonly source: SqlTableSource;
  readonly schema: ShallowRef<SqlSchema | undefined>;
};

/** Which view's rows each page engine holds in `t`. */
const holders = new WeakMap<SqlQueryEngine, symbol>();

/** The rows `t` holds, as plain JSON: the value's own, or, for a cut one, those of the full value the daemon streams in
 * the same wire form (fullValueJson), so a value cut or not gives the same table. */
async function rowsOf(source: SqlTableSource, signal: AbortSignal): Promise<readonly unknown[]> {
  const url = source.fullValueUrl.value;
  const full = source.truncated.value && url !== undefined;
  const wire = full
    ? fullValueJson(await (await source.fetchFullValue(url, signal)).text())
    : source.json.value;
  const plain = toPlain(wire);
  const rows: readonly unknown[] = Array.isArray(plain) ? plain : [plain];
  return rows;
}

/** Registers the rows unless this view's are already in `t`; the schema feeds autocompletion. */
async function ensure(table: Table, signal: AbortSignal): Promise<Ready> {
  const engines = table.source.engines.value ?? {};
  const held = engines.sql !== undefined && holders.get(engines.sql) === table.me;
  if (held && table.schema.value) return { ok: true, value: table.schema.value };
  let rows: readonly unknown[];
  try {
    rows = await rowsOf(table.source, signal);
  } catch (cause) {
    // The daemon could not stream the full value: the bar says so instead of querying the slice.
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      error: { kind: "load", message: `The full value did not load: ${message}` },
    };
  }
  const registered = await registerRows(engines, rows, table.source.alias.value, signal);
  if (registered.ok && engines.sql) holders.set(engines.sql, table.me);
  table.schema.value = registered.ok ? registered.value : undefined;
  return registered;
}

/** Drops `t` when it holds this view's rows. */
async function drop(table: Table): Promise<void> {
  const sql = table.source.engines.value?.sql;
  table.schema.value = undefined;
  if (sql === undefined || holders.get(sql) !== table.me) return;
  holders.delete(sql);
  try {
    await sql.drop("t");
  } catch (cause) {
    // Converted: the viewer says the old rows may still be in DuckDB (a disposed engine or a crashed worker).
    const message = cause instanceof Error ? cause.message : String(cause);
    table.source.report(`The SQL table t was not dropped: ${message}`);
  }
}

export function useSqlTable(source: SqlTableSource) {
  const table: Table = { me: Symbol("t"), source, schema: shallowRef() };
  // Side effects: new rows (the output changed) or the view closing free the table.
  watch(source.json, () => {
    void drop(table);
  });
  onScopeDispose(() => {
    void drop(table);
  });
  return {
    schema: table.schema,
    ensure: (signal: AbortSignal) => ensure(table, signal),
    drop: () => drop(table),
  };
}

export type SqlTable = ReturnType<typeof useSqlTable>;
