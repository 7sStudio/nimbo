// `nimbo sql install` and `sql status` with no daemon to ask: the same install sql.install runs, in a
// process of its own, so installing DuckDB needs no workspace. It writes one JSON line per progress step, then
// `{ "status": … }` or `{ "error": { name, message, data } }`.
import { isJsnbError } from "@jsnb/core";

import { duckdbStatus, installDuckdb } from "./files/duckdb/duckdb.js";

const line = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

try {
  const status =
    process.argv[2] === "status"
      ? duckdbStatus()
      : await installDuckdb((progress) => {
          line({ progress });
        });
  line({ status });
} catch (error) {
  line({
    error: isJsnbError(error)
      ? { name: error.name, message: error.message, data: error.data }
      : {
          name: "SqlInstallFailed",
          message: error instanceof Error ? error.message : String(error),
          data: {},
        },
  });
  process.exitCode = 1;
}
