// One DuckDB-WASM instance: its worker, AsyncDuckDB, the load with progress, and the watch that rejects the work in
// flight when the worker dies (duckdb-wasm itself forgets those calls without settling them).
import { AsyncDuckDB, VoidLogger } from "@duckdb/duckdb-wasm";

import type { OpenOptions } from "../database.ts";
import { QueryError, loadError, messages } from "../errors.ts";
import { pickBundle } from "./bundles.ts";

export type Instance = {
  readonly db: AsyncDuckDB;
  /** Runs one call into DuckDB; rejects when the instance dies first; a WebAssembly trap kills the instance. */
  track<T>(call: () => Promise<T>): Promise<T>;
  /** Terminates the worker and rejects every call in flight with `error`. */
  kill(error: QueryError): void;
  isAlive(): boolean;
};

/**
 * BIGINT stays bigint (made exact JSON later); DECIMAL becomes DOUBLE. TIMESTAMP stays a Timestamp in its own unit:
 * DuckDB-WASM's Date64 cast relabels nested timestamps without converting their microseconds.
 */
const config = {
  query: { castBigIntToDouble: false, castDecimalToDouble: false, castTimestampToDate: false },
};

const crashed = (cause: unknown) => new QueryError("crashed", messages.crashed(), { cause });
const isTrap = (error: unknown) => error instanceof Error && error.name === "RuntimeError";

function watch(db: AsyncDuckDB, worker: Worker, onDeath: () => void): Instance {
  let death: QueryError | undefined;
  const pending = new Set<(error: QueryError) => void>();
  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    kill(crashed(event.message));
  };
  const kill = (error: QueryError) => {
    if (death !== undefined) return;
    death = error;
    worker.removeEventListener("error", onError);
    // terminate() kills the worker synchronously; its promise carries nothing.
    void db.terminate();
    for (const reject of pending) reject(error);
    pending.clear();
    onDeath();
  };
  const track = <T>(call: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      if (death !== undefined) {
        reject(death);
        return;
      }
      pending.add(reject);
      const settle = () => pending.delete(reject);
      call().then(
        (value) => {
          settle();
          resolve(value);
        },
        (error: unknown) => {
          settle();
          if (isTrap(error)) kill(crashed(error));
          reject(death ?? (error instanceof Error ? error : new Error(String(error))));
        },
      );
    });
  worker.addEventListener("error", onError);
  return { db, track, kill, isAlive: () => death === undefined };
}

/** Starts the worker, instantiates DuckDB (reporting the download) and opens an in-memory database. */
export async function startInstance(options: OpenOptions): Promise<Instance> {
  const bundle = await pickBundle();
  if (bundle.mainWorker === null) throw loadError("no worker script in the DuckDB bundle");
  const worker = new Worker(bundle.mainWorker);
  const db = new AsyncDuckDB(new VoidLogger(), worker);
  const instance = watch(db, worker, options.onDeath);
  const onAbort = () => {
    instance.kill(new QueryError("cancelled", messages.cancelled()));
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  try {
    await instance.track(() =>
      db.instantiate(bundle.mainModule, bundle.pthreadWorker, (progress) => {
        options.onProgress({ loadedBytes: progress.bytesLoaded, totalBytes: progress.bytesTotal });
      }),
    );
    await instance.track(() => db.open(config));
    return instance;
  } catch (error) {
    const cause = error instanceof QueryError ? (error.cause ?? error) : error;
    const failure = options.signal.aborted
      ? new QueryError("cancelled", messages.cancelled())
      : loadError(cause);
    instance.kill(failure);
    throw failure;
  } finally {
    options.signal.removeEventListener("abort", onAbort);
  }
}
