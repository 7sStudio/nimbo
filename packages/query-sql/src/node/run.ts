// One statement on its own node-api connection, interrupted (connection.interrupt) when its deadline fires, and again
// until it returns, since DuckDB loses an interrupt that comes before it begins the statement.
import type { DuckDBConnection, DuckDBDataChunk, DuckDBResult } from "@duckdb/node-api";

import type { Deadline } from "../abort.ts";
import { deadline } from "../abort.ts";
import { fromDuckDB } from "../diagnostics.ts";
import { QueryError } from "../errors.ts";
import { statements } from "../sql.ts";
import type { NodeInstance } from "./instance.ts";
import { interruptAgainMs } from "./instance.ts";

/** A deadline that never fires, for the engine's own statements. */
export const unbounded = (): Deadline => deadline(undefined, Infinity);

/** Opens a connection for `use` and closes it after. */
export async function withConnection<T>(
  node: NodeInstance,
  use: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const connection = await node.connect();
  try {
    return await use(connection);
  } finally {
    node.release(connection);
  }
}

/** The result's chunks pulled one by one (`undefined` at the end), each pull watched by the instance. */
export type Chunks = {
  readonly result: DuckDBResult;
  next(): Promise<DuckDBDataChunk | undefined>;
};

/**
 * Streams `sql` and hands its chunks to `read`. When the deadline fires, DuckDB is interrupted and the call rejects
 * with the deadline's error; DuckDB's own failures become QueryError("query") with the position.
 */
export async function stream<T>(
  node: NodeInstance,
  connection: DuckDBConnection,
  request: { readonly sql: string; readonly stop: Deadline; readonly offset?: number },
  read: (chunks: Chunks) => Promise<T>,
): Promise<T> {
  const { sql, stop } = request;
  if (stop.signal.aborted) throw stop.error();
  let again: ReturnType<typeof setInterval> | undefined;
  const onAbort = () => {
    connection.interrupt();
    again = setInterval(() => {
      connection.interrupt();
    }, interruptAgainMs);
  };
  stop.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const result = await node.track(() => connection.stream(sql));
    const next = async () => {
      const chunk = await node.track(() => result.fetchChunk());
      return chunk === null || chunk.rowCount === 0 ? undefined : chunk;
    };
    return await read({ result, next });
  } catch (error) {
    if (error instanceof QueryError) throw error;
    throw stop.stopped() === undefined ? fromDuckDB(error, sql, request.offset) : stop.error();
  } finally {
    clearInterval(again);
    stop.signal.removeEventListener("abort", onAbort);
  }
}

/** Pulls every chunk without reading it; `stop` is checked between chunks. */
export async function drain(chunks: Chunks, stop: Deadline): Promise<void> {
  for (let chunk = await chunks.next(); chunk !== undefined; chunk = await chunks.next()) {
    if (stop.signal.aborted) throw stop.error();
  }
}

/** Runs a statement for its effect: interruptible while it runs, standing once DuckDB finished it. */
export const execute = (
  node: NodeInstance,
  connection: DuckDBConnection,
  sql: string,
  stop: Deadline = unbounded(),
): Promise<void> => stream(node, connection, { sql, stop }, (chunks) => drain(chunks, unbounded()));

/** Runs `work` as one transaction on `connection`: all of its statements take effect, or none of them. */
export async function inTransaction(
  node: NodeInstance,
  connection: DuckDBConnection,
  work: () => Promise<void>,
): Promise<void> {
  await execute(node, connection, statements.begin);
  try {
    await work();
  } catch (error) {
    // The rollback puts DuckDB back as it was; its own failure must not hide the error that caused it.
    if (node.isAlive()) {
      await execute(node, connection, statements.rollback).then(
        () => undefined,
        () => undefined,
      );
    }
    throw error;
  }
  await execute(node, connection, statements.commit);
}
