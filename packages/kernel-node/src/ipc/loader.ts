// The workspace loader of 04-kernel §8.1 and 07-file-format §7: <workspace>/.jsnb/loader.mjs, written at kernel
// start when it is missing or different, so a kernel imports packages from the workspace's node_modules. It is read
// and written only as a regular file, off the event loop and without blocking: a FIFO in its place is refused at once.
// Neither the loader nor its folder is followed through a symbolic link: a workspace from someone else could point one
// at a file of the user's outside it, which a start would then overwrite.
import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { LoaderWriteFailed } from "./errors.js";
import { readRegularFile, writeRegularFile } from "./regularFile.js";

/** The loader's whole text: a header and the one export the kernel calls. */
export const loaderSource = `// Written by nimbo when a kernel starts (07-file-format §7): kernels import packages through this module, so Node
// resolves them from this workspace's node_modules with their exports conditions. Edits are overwritten.
export const load = (specifier) => import(specifier);
`;

/** The most the loader read back may hold: its source is a few hundred bytes. */
const maxLoaderBytes = 64 * 1024;

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Makes `folder` (.jsnb) when it is missing; the reason it cannot hold the loader otherwise (a link, a file). */
async function loaderFolder(folder: string): Promise<string | undefined> {
  try {
    const found = await lstat(folder).catch((error: unknown) => {
      if (error instanceof Error && Reflect.get(error, "code") === "ENOENT") return undefined;
      throw error;
    });
    if (found?.isSymbolicLink()) return "its folder .jsnb is a symbolic link";
    if (found && !found.isDirectory()) return "its folder .jsnb is not a directory";
    if (!found) await mkdir(folder);
    return undefined;
  } catch (error) {
    return reasonOf(error);
  }
}

/** Writes the loader of `workspace` unless it already holds exactly `loaderSource`; returns its path. */
export async function writeLoader(workspace: string): Promise<string> {
  const folder = join(workspace, ".jsnb");
  const path = join(folder, "loader.mjs");
  const unusable = await loaderFolder(folder);
  if (unusable !== undefined) throw new LoaderWriteFailed({ path, reason: unusable });
  const read = await readRegularFile(path, maxLoaderBytes);
  if (read.kind === "read" && read.text === loaderSource) return path;
  if (read.kind === "refused") throw new LoaderWriteFailed({ path, reason: read.reason });
  const refused = await writeRegularFile(path, loaderSource);
  if (refused !== undefined) throw new LoaderWriteFailed({ path, reason: refused });
  return path;
}
