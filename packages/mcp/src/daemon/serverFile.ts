// The daemon's discovery file `<workspace>/.jsnb/server.json` (03-api §7.1), read with core's schema (`ServerFile`),
// and whether the process it names is still alive (process.kill, which core, being pure, may not call; 08 §4).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ServerFile } from "@jsnb/core";
import { parseServerFile } from "@jsnb/core";

import { ServerFileUnreadable } from "../errors/daemon.js";

export const serverFilePath = (workspace: string): string =>
  join(workspace, ".jsnb", "server.json");

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The file's content, or undefined when there is none or it is not a server.json (a half-written or foreign file). */
export async function readServerFile(workspace: string): Promise<ServerFile | undefined> {
  let text: string;
  try {
    text = await readFile(serverFilePath(workspace), "utf8");
  } catch (error) {
    // Nothing there, or `.jsnb` is not a folder: no daemon wrote a file (the daemon's start names the second).
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") return undefined;
    const code = codeOf(error);
    throw new ServerFileUnreadable(
      { path: serverFilePath(workspace), code: typeof code === "string" ? code : "unknown" },
      { cause: error },
    );
  }
  return parseServerFile(text);
}

/** Whether a process `pid` exists (EPERM: it does, and belongs to another user). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}
