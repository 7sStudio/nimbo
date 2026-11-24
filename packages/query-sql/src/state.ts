// An engine's state: the loaded instance, the one load callers share, the registrations it replays after a
// restart, the order registration changes run in, and the epoch dispose moves on.
import { deadline } from "./abort.ts";
import type { Database, Opener } from "./database.ts";
import type { LoadProgress } from "./engine.ts";
import { QueryError, asQueryError, messages } from "./errors.ts";
import { sharedLoad } from "./loader.ts";
import type { Registrations } from "./registrations.ts";
import { createRegistrations } from "./registrations.ts";

export type State = {
  readonly registrations: Registrations;
  /** True when the backend can restart (a page worker crash), so registrations keep their sources to replay. */
  readonly restarts: boolean;
  /** Runs registration changes one after another, so the record and DuckDB's tables change in the same order. */
  mutate<T>(operation: () => Promise<T>): Promise<T>;
  /** Increases on every dispose; work that started before one rejects `closed`. */
  epoch(): number;
  /** The live instance, else the current or a new load (with replay); rejects `cancelled` or `closed`. */
  ready(signal?: AbortSignal, onProgress?: (progress: LoadProgress) => void): Promise<Database>;
  /** True when an instance is alive or loading. */
  active(): boolean;
  /** Stops the load, closes the instance with `closed`, forgets every registration. */
  dispose(): void;
};

export const closedError = () => new QueryError("closed", messages.closed());

const serial = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    // The caller handles `result`; the tail only orders the next operation after this one.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
};

/** Replays the registrations into a fresh instance; one its source can no longer rebuild is forgotten. */
async function replay(db: Database, registrations: Registrations, signal: AbortSignal) {
  for (const { table, source, alias } of registrations.list()) {
    const stop = deadline(signal, Infinity);
    try {
      if (source === undefined) throw new QueryError("input", messages.source(table));
      await db.register({ table, source, alias, stale: [] }, stop);
    } catch (error) {
      if (signal.aborted) throw error;
      // Forgotten like an output that changed: a query on it then reports DuckDB's missing-table error.
      registrations.forget(table);
      if (!db.alive()) throw error;
    } finally {
      stop.clear();
    }
  }
}

type Slot = { get(): Database | undefined; set(db: Database | undefined): void };

/** The load callers share: open an instance, replay the registrations, then make it the live one. */
const loaderFor = (open: Opener, registrations: Registrations, slot: Slot) =>
  sharedLoad<Database>(
    async (onProgress, signal) => {
      const onDeath = () => {
        if (slot.get()?.alive() === false) slot.set(undefined);
      };
      const db = await open({ onProgress, signal, onDeath });
      // An aborted or failed load must not leave the instance it opened (and its worker) running unseen.
      const onAbort = () => {
        db.close(closedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (signal.aborted) throw closedError();
        await replay(db, registrations, signal);
      } catch (error) {
        db.close(asQueryError(error));
        throw error;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      slot.set(db);
      return db;
    },
    (db) => {
      db.close(closedError());
    },
  );

/** The state of one engine over the backend `open` loads; `restarts` says whether it may need a replay. */
export function createState(open: Opener, restarts: boolean): State {
  const registrations = createRegistrations();
  let database: Database | undefined;
  let epoch = 0;
  const live = () => (database?.alive() === true ? database : undefined);
  const loader = loaderFor(open, registrations, {
    get: () => database,
    set: (db) => {
      database = db;
    },
  });
  return {
    registrations,
    restarts,
    mutate: serial(),
    epoch: () => epoch,
    ready: async (signal, onProgress) => {
      const at = epoch;
      const db = live() ?? (await loader.acquire(onProgress, signal));
      if (at !== epoch) throw closedError();
      return db;
    },
    active: () => live() !== undefined || loader.running(),
    dispose: () => {
      epoch += 1;
      const error = closedError();
      loader.stop(error);
      const db = database;
      database = undefined;
      registrations.clear();
      db?.close(error);
    },
  };
}
