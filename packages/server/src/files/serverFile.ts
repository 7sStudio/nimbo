// `.jsnb/server.json` (its schema is core's `ServerFile`), mode 0600,
// created only when absent (a hard link from a fsynced temp file, so two daemons never both write it), read back for
// discovery, and removed on a clean stop only while it is still this daemon's.
import { randomBytes } from "node:crypto";
import { link, open, readFile, rm } from "node:fs/promises";

import type { ServerFile } from "@jsnb/core";
import { parseServerFile } from "@jsnb/core";

import { tempPathOf } from "./atomicWrite.js";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The file's text, or undefined when there is no file. */
export async function readServerText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** The file's content, or undefined when it is missing or is not a server.json (both mean: no daemon to find). */
export async function readServerFile(path: string): Promise<ServerFile | undefined> {
  const text = await readServerText(path);
  return text === undefined ? undefined : parseServerFile(text);
}

/**
 * Writes the file mode 0600 unless one exists; false when another daemon's file is already there. The temporary file
 * has a name of its own per call, so two daemons starting in one process never write the same one.
 */
export async function createServerFile(path: string, content: ServerFile): Promise<boolean> {
  const temp = `${tempPathOf(path)}-${randomBytes(4).toString("hex")}`;
  const handle = await open(temp, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(content, null, 2)}\n`);
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temp, path);
    return true;
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

/** Removes the file when it still names `own` (pid and start); another daemon's file stays. */
export async function removeServerFile(
  path: string,
  own: Pick<ServerFile, "pid" | "startedAt">,
): Promise<void> {
  const current = await readServerFile(path);
  if (current?.pid === own.pid && current.startedAt === own.startedAt) {
    await rm(path, { force: true });
  }
}

/** Whether a process with `pid` exists (EPERM: it exists under another user). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}
