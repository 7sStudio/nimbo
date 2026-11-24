// Where the daemon's process entry is: `@jsnb/server/main` resolved at run time, never imported,
// or NIMBO_DAEMON_ENTRY when it is an absolute path to an existing regular file; anything else is refused, so the MCP
// server never forks a stray path.
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { InvalidArguments } from "../errors/mcp.js";

const entryVariable = "NIMBO_DAEMON_ENTRY";

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    // Missing or unreadable: not an entry the MCP server may fork.
    return false;
  }
};

/** The server's own entry, `dist/main.js` of `@jsnb/server`, as Node resolves it from here. */
const packagedEntry = (): string => fileURLToPath(import.meta.resolve("@jsnb/server/main"));

/** The file to run as the daemon: NIMBO_DAEMON_ENTRY when set and usable, else the server's entry. */
export async function daemonEntry(
  env: Readonly<Record<string, string | undefined>>,
  command: string,
): Promise<string> {
  const chosen = env[entryVariable];
  if (chosen === undefined || chosen === "") return packagedEntry();
  if (isAbsolute(chosen) && (await isFile(chosen))) return chosen;
  throw new InvalidArguments(
    { argument: entryVariable, command },
    `${entryVariable} must be the absolute path of the daemon's entry file; ${JSON.stringify(chosen)} is not one. Unset it to use the installed daemon.`,
  );
}
