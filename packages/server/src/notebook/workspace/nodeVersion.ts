// The version of the Node the kernels run on (workspace.info), asked of the binary kernel.nodePath names.
import { stat } from "node:fs/promises";
import { delimiter, join, resolve, sep } from "node:path";

import { nodeVersionOf } from "@jsnb/kernel-node";

import type { SettingsService } from "./settings.js";

/** The file `path` names: itself when it has a folder in it, else the first file of that name in a PATH folder, as a
 * spawn finds a bare command; with its change time, or undefined when there is none. */
async function binaryOf(
  path: string,
): Promise<{ readonly file: string; readonly changed: number } | undefined> {
  const folders = path.includes(sep) ? [""] : (process.env.PATH ?? "").split(delimiter);
  for (const folder of folders) {
    const file = folder === "" ? resolve(path) : join(folder, path);
    const stats = await stat(file).catch(() => undefined);
    if (stats?.isFile() === true) return { file, changed: stats.ctimeMs };
  }
  return undefined;
}

/**
 * The version of the Node the kernels run on: kernel.nodePath's as that binary answers, else the daemon's own.
 * An answer is kept per binary (a bare name found on PATH as a spawn finds it) and its change time, so a Node upgraded
 * in place is asked again. "unknown" from a binary that exists is kept too, so one that hangs costs its 10 s timeout once
 * and not on every workspace.info; a missing file is never kept, so a binary installed later answers.
 */
export function kernelNodeVersion(settings: SettingsService): () => Promise<string> {
  const asked = new Map<string, Promise<string>>();
  return async () => {
    const path = settings.current()["kernel.nodePath"] ?? undefined;
    if (path === undefined) return nodeVersionOf(undefined);
    const binary = await binaryOf(path);
    if (binary === undefined) return nodeVersionOf(path); // no such file: "unknown", asked again next time
    const key = `${String(binary.changed)}:${binary.file}`;
    const known = asked.get(key) ?? nodeVersionOf(path);
    asked.set(key, known);
    return known;
  };
}
