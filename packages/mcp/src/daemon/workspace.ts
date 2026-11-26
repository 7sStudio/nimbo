// The workspace: the nearest ancestor of the working folder that holds a `.jsnb/`
// folder, else the working folder itself, found as the CLI finds it. The MCP server lives for an agent's session and
// Node keeps the working folder's path from its start, so a folder deleted or moved since is WorkingFolderGone, never
// an ancestor's workspace found from a path that leads nowhere.
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { WorkingFolderGone } from "../errors/mcp.js";

const isFolder = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Missing or unreadable: not a workspace marker, so the search goes on upwards.
    return false;
  }
};

/** The folder whose daemon the MCP server talks to. */
export async function findWorkspace(cwd: string): Promise<string> {
  const start = resolve(cwd);
  if (!(await isFolder(start))) throw new WorkingFolderGone();
  for (let dir = start; ; dir = dirname(dir)) {
    if (await isFolder(join(dir, ".jsnb"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}
