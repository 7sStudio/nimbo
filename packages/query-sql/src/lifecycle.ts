// The SqlEngine both backends share: input checks, lazy load on first use, deadlines on queries and exports,
// registrations replayed after a restart, dispose. The backend arrives through an Opener (database.ts).
import { deadline } from "./abort.ts";
import type { Opener } from "./database.ts";
import { sameName } from "./registrations.ts";
import type { SqlEngine, SqlEngineOptions } from "./engine.ts";
import type { Outcome } from "./errors.ts";
import { asQueryError } from "./errors.ts";
import type { Settings } from "./input.ts";
import { checkFormat, checkLimit, checkName, checkOptions } from "./input.ts";
import type { State } from "./state.ts";
import { closedError, createState } from "./state.ts";

const must = <T>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
};

/** Every public method rejects with QueryError only (throw at the boundary). */
const guard = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw asQueryError(error);
  }
};

const register =
  (state: State): SqlEngine["register"] =>
  (table, source, options = {}) => {
    const at = state.epoch();
    const stillOpen = () => {
      if (at !== state.epoch()) throw closedError();
    };
    return guard(() =>
      state.mutate(async () => {
        stillOpen();
        const name = must(checkName("table", table));
        const wanted = options.alias;
        const alias =
          wanted === undefined || sameName(wanted, name)
            ? undefined
            : must(checkName("alias", wanted));
        const stale = must(state.registrations.plan(name, alias));
        const db = await state.ready(options.signal);
        const stop = deadline(options.signal, Infinity);
        try {
          await db.register({ table: name, source, alias, stale }, stop);
        } finally {
          stop.clear();
        }
        stillOpen();
        state.registrations.remember({
          table: name,
          source: state.restarts ? source : undefined,
          alias,
        });
        return db.schema(name, alias);
      }),
    );
  };

const drop =
  (state: State): SqlEngine["drop"] =>
  (table) =>
    guard(() =>
      state.mutate(async () => {
        const name = must(checkName("table", table));
        const alias = state.registrations.aliasOf(name);
        state.registrations.forget(name);
        // Nothing loaded means nothing to drop: no download just to forget a table.
        if (!state.active()) return;
        await (await state.ready()).drop(name, alias);
      }),
    );

const query =
  (state: State, settings: Settings): SqlEngine["query"] =>
  (sql, options = {}) =>
    guard(async () => {
      const limit = must(checkLimit(options.limit, settings.maxRows));
      const db = await state.ready(options.signal);
      const stop = deadline(options.signal, settings.timeoutMs);
      try {
        return await db.query(sql, limit, stop);
      } finally {
        stop.clear();
      }
    });

const exportAll =
  (state: State, settings: Settings): SqlEngine["exportAll"] =>
  (sql, options) =>
    guard(async () => {
      const format = must(checkFormat(options.format));
      const db = await state.ready(options.signal);
      const stop = deadline(options.signal, settings.timeoutMs);
      try {
        return await db.exportAll(sql, format, stop);
      } finally {
        stop.clear();
      }
    });

/** How a backend lives: `restarts` when it can die on its own and come back (a page worker), so tables replay. */
export type Backend = { readonly open: Opener; readonly restarts: boolean };

/** A SqlEngine over the backend; invalid options throw QueryError("input"). */
export function createLifecycle(backend: Backend, options: SqlEngineOptions = {}): SqlEngine {
  const settings = must(checkOptions(options));
  const state = createState(backend.open, backend.restarts);
  return {
    load: (onProgress, signal) =>
      guard(async () => {
        await state.ready(signal, onProgress);
      }),
    register: register(state),
    query: query(state, settings),
    schema: (table) =>
      guard(async () => {
        const name = must(checkName("table", table));
        return (await state.ready()).schema(name, state.registrations.aliasOf(name));
      }),
    exportAll: exportAll(state, settings),
    drop: drop(state),
    dispose: () => {
      state.dispose();
      return Promise.resolve();
    },
  };
}
