// One DuckDB engine per open notebook for cell.outputQuery { mode: "sql" }: created on the
// first SQL query, its files under `.jsnb/cache/sql/`. Table `t` holds one value at a time, loaded once and kept while
// the queries ask for that value; a notebook's SQL calls run one at a time, so a load never swaps `t` under a running
// query. Disposed only once its own calls have settled (their signals abort DuckDB's work first), then after a
// macrotask, so DuckDB is never torn down under a running call (three native crashes on 2026-10-19 came from that).
import type { Result, SqlEngine } from "@jsnb/query-sql/node";
import { createNodeSqlEngine } from "@jsnb/query-sql/node";

import { useInstalledDuckdb } from "../../files/duckdb/duckdb.js";
import { OutputQueryFailed } from "./errors.js";

/** Read through a call: the signal changes across the awaits between two reads. */
const aborted = (signal: AbortSignal): boolean => signal.aborted;

const closedMessage =
  "the notebook closed before it ran. Open the notebook and run the query again.";

type SqlRequest = {
  /** Which value `rows` is (`<execution>:<index>`), so a value already in `t` is not loaded again. */
  readonly key: string;
  readonly rows: () => readonly unknown[];
  readonly sql: string;
  readonly limit: number;
  readonly timeoutMs: number;
};

type SqlAnswer =
  { readonly ok: true; readonly value: Result } | { readonly ok: false; readonly timedOut: true };

export type SqlTables = {
  /** Loads the value into `t` when another one is there, then runs the query; rejects with query-sql's QueryError. */
  readonly query: (request: SqlRequest) => Promise<SqlAnswer>;
  /** The value `key` is no longer retained: `t` lets it go when it holds it. */
  readonly forget: (key: string) => void;
  readonly dispose: () => Promise<void>;
};

type State = { engine: SqlEngine | undefined; held: string | undefined; tail: Promise<unknown> };

/** Runs `work` after the notebook's earlier SQL calls. */
function serially<T>(state: State, work: () => Promise<T>): Promise<T> {
  const run = state.tail.then(work);
  state.tail = run.then(
    () => undefined,
    () => undefined, // the caller gets this call's failure; the chain only orders the next call after it
  );
  return run;
}

async function runQuery(
  state: State,
  request: SqlRequest,
  stop: AbortSignal,
  directory: string,
): Promise<SqlAnswer> {
  // Disposed while this call waited its turn: no engine is created again for a notebook that closed.
  if (aborted(stop)) throw new OutputQueryFailed({ mode: "sql", reason: "closed" }, closedMessage);
  useInstalledDuckdb();
  state.engine ??= createNodeSqlEngine({ directory, timeoutMs: Number.POSITIVE_INFINITY });
  if (state.held !== request.key) {
    state.held = undefined;
    await state.engine.register("t", request.rows(), { signal: stop });
    state.held = request.key;
  }
  const timeout = AbortSignal.timeout(request.timeoutMs);
  try {
    const signal = AbortSignal.any([stop, timeout]);
    return {
      ok: true,
      value: await state.engine.query(request.sql, { limit: request.limit, signal }),
    };
  } catch (error) {
    if (aborted(timeout) && !aborted(stop)) return { ok: false, timedOut: true };
    throw error;
  }
}

/** The SQL tables of one notebook, confined to `directory`. */
export function createSqlTables(directory: string): SqlTables {
  const state: State = { engine: undefined, held: undefined, tail: Promise.resolve() };
  const stop = new AbortController();
  const running = new Set<Promise<unknown>>();
  const tracked = <T>(call: Promise<T>): Promise<T> => {
    running.add(call);
    const forget = (): void => {
      running.delete(call);
    };
    call.then(forget, forget);
    return call;
  };
  return {
    query: (request) =>
      tracked(serially(state, () => runQuery(state, request, stop.signal, directory))),
    forget: (key) => {
      if (state.held !== key || !state.engine) return;
      const { engine } = state;
      state.held = undefined;
      // Freed memory only: a failed drop leaves `t` to be replaced by the next load.
      void tracked(serially(state, () => engine.drop("t"))).catch(() => undefined);
    },
    dispose: async () => {
      stop.abort();
      await Promise.allSettled([...running]);
      await state.engine?.dispose();
      await new Promise((resolve) => setImmediate(resolve)); // DuckDB closes on the microtasks after dispose
    },
  };
}
