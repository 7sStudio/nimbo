// One statement on its own connection, cancelled through DuckDB's interrupt (cancelSent) when its deadline fires.
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { AsyncRecordBatchStreamReader } from "apache-arrow";

import type { Deadline } from "../abort.ts";
import { deadline } from "../abort.ts";
import { fromDuckDB } from "../diagnostics.ts";
import { QueryError } from "../errors.ts";
import { statements } from "../sql.ts";
import type { Batches } from "../result.ts";
import type { Instance } from "./instance.ts";

/** Opens a connection for `use` and closes it after, unless the instance died meanwhile. */
export async function withConnection<T>(
  instance: Instance,
  use: (connection: AsyncDuckDBConnection) => Promise<T>,
): Promise<T> {
  const connection = await instance.track(() => instance.db.connect());
  try {
    return await use(connection);
  } finally {
    if (instance.isAlive()) await instance.track(() => connection.close());
  }
}

/** A deadline that never fires, for the engine's own cleanup statements. */
export const unbounded = (): Deadline => deadline(undefined, Infinity);

/** The stream of a sent (and opened) statement as batches pulled one by one, each pull watched by the instance. */
const batchesOf = (instance: Instance, reader: AsyncRecordBatchStreamReader): Batches => ({
  schema: reader.schema,
  next: async () => {
    const step = await instance.track(() => reader.next());
    return step.done === true ? undefined : step.value;
  },
});

/**
 * Sends `sql` and hands its stream to `read`. When the deadline fires, cancelSent interrupts DuckDB and the call
 * rejects with the deadline's error; DuckDB's own failures become QueryError("query") with the position.
 */
export async function send<T>(
  instance: Instance,
  connection: AsyncDuckDBConnection,
  request: { readonly sql: string; readonly stop: Deadline; readonly offset?: number },
  read: (batches: Batches) => Promise<T>,
): Promise<T> {
  const { sql, stop } = request;
  if (stop.signal.aborted) throw stop.error();
  const onAbort = () => {
    // A cancel that fails leaves the statement to finish; the deadline's error is what the caller gets either way.
    instance
      .track(() => connection.cancelSent())
      .then(
        () => undefined,
        () => undefined,
      );
  };
  stop.signal.addEventListener("abort", onAbort, { once: true });
  try {
    // open() reads the schema; the reader forgets it once the stream ends, so it is kept from here.
    const reader = await instance.track(async () => (await connection.send(sql)).open());
    return await read(batchesOf(instance, reader));
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw stop.stopped() === undefined ? fromDuckDB(error, sql, request.offset) : stop.error();
  } finally {
    stop.signal.removeEventListener("abort", onAbort);
  }
}

/** Pulls every batch without reading it. */
export async function drain(batches: Batches, stop: Deadline): Promise<void> {
  for (let batch = await batches.next(); batch !== undefined; batch = await batches.next()) {
    if (stop.signal.aborted) throw stop.error();
  }
}

/**
 * Runs a statement for its effect. The deadline can interrupt it while it runs; once DuckDB has finished it, the
 * effect stands, so its (empty) result is drained without looking at the deadline again.
 */
export const execute = (
  instance: Instance,
  connection: AsyncDuckDBConnection,
  sql: string,
  stop: Deadline = unbounded(),
): Promise<void> =>
  send(instance, connection, { sql, stop }, (batches) => drain(batches, unbounded()));

/** Runs `work` as one transaction on `connection`: all of its statements take effect, or none of them. */
export async function inTransaction(
  instance: Instance,
  connection: AsyncDuckDBConnection,
  work: () => Promise<void>,
): Promise<void> {
  await execute(instance, connection, statements.begin);
  try {
    await work();
  } catch (error) {
    // The rollback puts DuckDB back as it was; its own failure must not hide the error that caused it.
    if (instance.isAlive()) {
      await execute(instance, connection, statements.rollback).then(
        () => undefined,
        () => undefined,
      );
    }
    throw error;
  }
  await execute(instance, connection, statements.commit);
}
