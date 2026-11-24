// Folders inside a test's temporary folder used as workspaces of their own, so a file can sit outside the daemon's
// workspace yet inside the test's world (deleted with it), and a log line awaited without a sleep.
import { existsSync, readFileSync, watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Workspace } from "@jsnb/test-tools/workspace";

/** The folder `name` inside the test's temporary folder, as a workspace of its own. */
export async function within(ws: Workspace, name: string): Promise<Workspace> {
  const dir = ws.path(name);
  await mkdir(dir, { recursive: true });
  return { dir, path: (...parts) => join(dir, ...parts) };
}

/**
 * Resolves once `file` exists, its folder watched for it: a log the daemon opens at its first line may not be there yet
 * when a test waits for that line (a watch of the file itself fails then).
 */
function made(file: string): Promise<void> {
  return new Promise((resolve) => {
    const watcher = watch(dirname(file), () => {
      if (!existsSync(file)) return;
      watcher.close();
      resolve();
    });
    if (!existsSync(file)) return;
    watcher.close();
    resolve();
  });
}

/**
 * Resolves once `file` (a log, appended to as it goes) holds `text`, the file itself watched once it exists (a watch
 * of its folder does not see an append on macOS).
 */
export async function logged(file: string, text: string): Promise<void> {
  await made(file);
  return new Promise((resolve) => {
    const seen = (): boolean => readFileSync(file, "utf8").includes(text);
    const watcher = watch(file, () => {
      if (!seen()) return;
      watcher.close();
      resolve();
    });
    if (!seen()) return;
    watcher.close();
    resolve();
  });
}
