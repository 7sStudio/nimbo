// How a query's failure reaches the caller of cell.outputQuery: a query the engine refuses (a
// syntax error, a runtime error of the query on this value, DuckDB rejecting the SQL) is INVALID_PARAMS on `query`
// with the engine's message and the offset of the mistake; a timeout is a result (`timedOut`), not an error; an engine
// that could not run (it did not load, ran out of memory, or the notebook closed) is OutputQueryFailed.
import type { QueryMode } from "@jsnb/core";
import { InvalidParams, JsnbError, productName } from "@jsnb/core";

type Failure = { readonly mode: QueryMode; readonly reason: string };

/** The engine of a mode could not answer; `reason` is the engine's (unavailable, memory, load, crashed, closed…). */
export class OutputQueryFailed extends JsnbError {
  declare readonly data: Failure;
  constructor(data: Failure, detail: string) {
    super({
      name: "OutputQueryFailed",
      message: `The ${data.mode} query could not run: ${detail}`,
      data,
    });
  }
}

/** The query itself is wrong for this value: INVALID_PARAMS on `query`, the offset of the mistake in the message. */
export const invalidQuery = (message: string, position: number | undefined): InvalidParams =>
  new InvalidParams({
    issues: [
      {
        path: ["query"],
        message: position === undefined ? message : `${message} (at offset ${String(position)})`,
      },
    ],
  });

/** The daemon's DuckDB binding is not installed: sql.install, `<product> sql install`, puts it in place. */
export class SqlEngineMissing extends JsnbError {
  declare readonly data: { readonly version: string; readonly folder: string };
  constructor(data: { readonly version: string; readonly folder: string }) {
    super({
      name: "SqlEngineMissing",
      message: `DuckDB is not installed for SQL queries on the daemon: run ${productName} sql install (the sql.install command), then run the query again.`,
      data,
    });
  }
}
