// The real world for the MCP server: this process's streams, environment and folder, and node:child_process's spawn.
import { spawn } from "node:child_process";

import { WorkingFolderGone } from "../errors/mcp.js";
import type { World } from "./world.js";

/**
 * process.cwd(), which Node reads once and keeps: a folder already gone then is WorkingFolderGone, not Node's uv_cwd
 * stack; one deleted or moved later is found gone by findWorkspace.
 */
function workingFolder(): string {
  try {
    return process.cwd();
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT")
      throw new WorkingFolderGone({ cause: error });
    throw error;
  }
}

/** The World of the running process. */
export function processWorld(): World {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: workingFolder,
    execPath: process.execPath,
    spawn,
  };
}
