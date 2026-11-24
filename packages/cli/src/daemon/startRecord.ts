// The start folder's shared parts (startFolder.ts makes one, sweep.ts sweeps them): their names, their
// record `start.json` (the workspace and, once spawned, the daemon's pid), and the move of a daemon's stderr into its
// workspace's `.jsnb/logs`.
import { copyFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

/** The start folders' names, in a workspace's `.jsnb` and in the temp folder, with their CLI's pid. */
export const inWorkspace = /^start-(\d+)-/;
export const inTemp = /^nimbo-start-(\d+)-/;

/** What a start folder says of its start: the workspace, and the daemon's pid once it is spawned. */
const StartRecord = z.object({
  workspace: z.string(),
  pid: z.number().int().positive().optional(),
});
type StartRecord = z.infer<typeof StartRecord>;

export const recordFile = "start.json";

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

export async function readRecord(dir: string): Promise<StartRecord | undefined> {
  try {
    const parsed = StartRecord.safeParse(JSON.parse(await readFile(join(dir, recordFile), "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // None (a CLI killed before it wrote one) or half-written: the folder names no daemon to care for.
    return undefined;
  }
}

/**
 * Moves a daemon's stderr file into `workspace`'s `.jsnb/logs/stderr.log`, the last daemon's file becoming
 * `stderr.previous.log` first (only once the file to move is known to be there, so a sweep that lost a race renames
 * nothing); a dead daemon's file may be copied across devices instead. False when it cannot move (another disk for a
 * live daemon, a file in use on Windows): it stays where it is, still written.
 */
export async function moveInto(
  path: string,
  workspace: string,
  options: { readonly copy: boolean },
): Promise<boolean> {
  try {
    await stat(path);
  } catch {
    // Already moved (a start beside this one swept it first) or never made: nothing to move, nothing renamed.
    return false;
  }
  const logs = join(workspace, ".jsnb", "logs");
  try {
    await mkdir(logs, { recursive: true });
  } catch {
    return false; // no logs folder can be made there (a file at .jsnb): the file stays where it is
  }
  try {
    await rename(join(logs, "stderr.log"), join(logs, "stderr.previous.log"));
  } catch {
    // No daemon started here before (ENOENT), or its file is in use: this one's goes over it.
  }
  try {
    await rename(path, join(logs, "stderr.log"));
    return true;
  } catch (error) {
    if (!options.copy || codeOf(error) !== "EXDEV") return false;
    await copyFile(path, join(logs, "stderr.log")); // a dead daemon writes no more: its words, whole
    return true;
  }
}
