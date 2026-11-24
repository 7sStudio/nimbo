// Atomic writes of 07-file-format §5: a temp file `<name>.tmp-<pid>-<random>` beside the target, a name of the write's
// own created exclusively ("wx"), so nothing already at that name, a symbolic link included, is written through; fsync,
// rename over the target, its mode kept (or `mode` for a new file); a crash leaves the old file or the new one, never
// half of either. The rename replaces a link at the target's name: it never writes through one (a fixed `<name>.tmp-<pid>` opened "w" let a link planted at it for the daemon's pid be written through).
import { randomBytes } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";

export type AtomicWriteOptions = {
  /** The mode of a file that does not exist yet; an existing file keeps its own. */
  readonly mode?: number;
};

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** Whether `path` is a symbolic link (a write would replace the link, not its target); false when nothing is there. */
export async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (codeOf(error) === "ENOENT") return false;
    throw error;
  }
}

/** The temp file a write of `path` goes through, owned by this process. */
export const tempPathOf = (path: string): string => `${path}.tmp-${String(process.pid)}`;

/** The permission bits of `path` when it is a regular file; undefined when it does not exist. */
async function modeOf(path: string): Promise<number | undefined> {
  try {
    const stats = await lstat(path);
    return stats.isFile() ? stats.mode & 0o777 : undefined;
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** A file's device and inode: which file it is, whatever its name (a rename keeps it, an atomic write makes a new one). */
export type FileIdentity = { readonly dev: number; readonly ino: number };

/**
 * Writes `text` to `path` atomically; answers the identity of the file now at `path` (taken from the written file
 * itself, so a rename right after the write cannot mislead it); rejects with the file system's error (EACCES,
 * ENOSPC, ENOENT…).
 */
export async function writeAtomically(
  path: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<FileIdentity> {
  const mode = (await modeOf(path)) ?? options.mode ?? 0o644;
  const temp = `${tempPathOf(path)}-${randomBytes(4).toString("hex")}`;
  const handle = await open(temp, "wx", mode);
  let written: FileIdentity;
  try {
    await handle.writeFile(text);
    await handle.chmod(mode); // the umask may have narrowed the mode open() was given
    await handle.sync();
    const stats = await handle.stat();
    written = { dev: stats.dev, ino: stats.ino };
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return written;
}
