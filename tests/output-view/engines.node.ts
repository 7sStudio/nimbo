// The host's engines in Node: query-sql's daemon engine on @duckdb/node-api, confined to a temporary folder that
// dispose removes once the engines are freed (a temporary workspace, everything deleted after).
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeSqlEngine } from "@jsnb/query-sql/node";

import type { HostEngines } from "./engines.js";
import { createHostEngines } from "./engines.js";

/** The host's engines with SQL on the node engine, its files in `directory`, a fresh folder under the OS's temporary one. */
export function createNodeEngines(): HostEngines & { readonly directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "jsnb-output-view-"));
  const engines = createHostEngines(createNodeSqlEngine({ directory }));
  return {
    ...engines,
    directory,
    dispose: async () => {
      await engines.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
