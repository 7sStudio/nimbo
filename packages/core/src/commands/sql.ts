// The sql commands: the daemon's DuckDB binding, which `cell.outputQuery { mode: "sql" }` runs on and
// which is installed on demand, outside the app.
import { z } from "zod";

import { defineCommand } from "./define.js";

const status = z.object({
  installed: z.boolean(),
  /** The @duckdb/node-api version the daemon loads and installs. */
  version: z.string(),
  /** `dependency`: installed beside the daemon (a checkout); `installed`: in the data folder; `missing`. */
  source: z.enum(["dependency", "installed", "missing"]),
  /** The folder sql.install installs into. */
  folder: z.string(),
});

export const sqlStatus = defineCommand({
  name: "sql.status",
  description:
    "Whether the daemon's DuckDB binding (for SQL output queries from the CLI and agents) is installed, its version and where it loads from.",
  input: z.object({}),
  output: status,
});

export const sqlInstall = defineCommand({
  name: "sql.install",
  description:
    "Download and install the daemon's DuckDB binding (about 40 MB, kept across upgrades), each package checked against its pinned integrity; progress arrives as sql.progress events. Does nothing when it is installed already.",
  input: z.object({}),
  output: status,
  tags: { mutating: true, streaming: true, idempotent: true },
});
