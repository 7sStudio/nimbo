// The daemon's `--ui` arguments as the MCP server also computes them (`@jsnb/client/node`), with `@jsnb/ui` resolved
// from the CLI, which depends on it.
import { fileURLToPath } from "node:url";

import { daemonUiArguments, uiVariable } from "@jsnb/client/node";

import { InvalidArguments } from "../errors/cli.js";

/** NIMBO_UI_DIR when set and usable, else the packaged build, else none; a bad NIMBO_UI_DIR is refused. */
export async function uiArguments(
  env: Readonly<Record<string, string | undefined>>,
  command: string,
): Promise<readonly string[]> {
  const found = await daemonUiArguments(env, () =>
    fileURLToPath(import.meta.resolve("@jsnb/ui/index.html")),
  );
  if (found.ok) return found.args;
  throw new InvalidArguments({ argument: uiVariable, command }, found.message);
}
