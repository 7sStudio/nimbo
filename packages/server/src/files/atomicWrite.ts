// Atomic writes of 07-file-format §5: a temp file `<name>.tmp-<pid>-<random>` beside the target, a name of the write's
// own created exclusively ("wx"), so nothing already at that name, a symbolic link included, is written through; fsync,
// rename over the target, its mode kept (or `mode` for a new file); a crash leaves the old file or the new one, never
// half of either. The rename replaces a link at the target's name: it never writes through one (a fixed `<name>.tmp-<pid>` opened "w" let a link planted at it for the daemon's pid be written through).
import { randomBytes } from "node:crypto";
import { link, lstat, open, readFile, rename, rm } from "node:fs/promises";

export type AtomicWriteOptions = {
  /** The mode of a file that does not exist yet; an existing file keeps its own. */
  readonly mode?: number;
  /** Whether the file now at the path (its text, undefined when none) may be replaced: checked on the file the
   * replace actually took, which is put back when it may not (another program wrote it meanwhile). */
  readonly replaces?: (current: string | undefined) => boolean;
  /**
   * False: no fsync before the rename, for a cache file whose reader checks it against a record written durably
   * after it (a crash can then leave it short, never half of another file's content under its name).
   */
  readonly durable?: boolean;
};

/** The write did not happen: the file at the path changed meanwhile and is left as that program wrote it. */
export const raced = "raced";

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

/** The identity of the file at `path`, undefined when it cannot be read. */
export const identityOf = (path: string): Promise<FileIdentity | undefined> =>
  lstat(path).then(
    (stats) => ({ dev: stats.dev, ino: stats.ino }),
    () => undefined,
  );

/** The text of `path`, undefined when nothing is there. */
const textAt = (path: string): Promise<string | undefined> =>
  readFile(path, "utf8").catch((error: unknown) => {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  });

/** Writes `temp` (ready) over `path`, unless `replaces` refuses the file the rename takes. A hard link keeps that file
 * aside, so a write of another program that lands before the rename is checked and put back, not lost; without links
 * (or with no file yet) the file is checked just before the rename. */
async function replace(
  temp: string,
  path: string,
  replaces: (current: string | undefined) => boolean,
): Promise<boolean> {
  const aside = `${tempPathOf(path)}-${randomBytes(4).toString("hex")}`;
  const linked = await link(path, aside).then(
    () => true,
    () => false,
  );
  if (!linked && !replaces(await textAt(path))) return false;
  await rename(temp, path);
  if (!linked) return true;
  if (replaces(await textAt(aside))) {
    await rm(aside, { force: true });
    return true;
  }
  await rename(aside, path);
  return false;
}

/**
 * Writes `text` to `path` atomically; answers the identity of the file now at `path` (taken from the written file
 * itself, so a rename right after the write cannot mislead it), or `raced` when `replaces` refused the file it would
 * have replaced; rejects with the file system's error (EACCES, ENOSPC, ENOENT…).
 */
export async function writeAtomically(
  path: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<FileIdentity | typeof raced> {
  const mode = (await modeOf(path)) ?? options.mode ?? 0o644;
  const temp = `${tempPathOf(path)}-${randomBytes(4).toString("hex")}`;
  const handle = await open(temp, "wx", mode);
  let written: FileIdentity;
  try {
    await handle.writeFile(text);
    await handle.chmod(mode); // the umask may have narrowed the mode open() was given
    if (options.durable !== false) await handle.sync();
    const stats = await handle.stat();
    written = { dev: stats.dev, ino: stats.ino };
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    if (options.replaces === undefined) await rename(temp, path);
    else if (!(await replace(temp, path, options.replaces))) {
      await rm(temp, { force: true });
      return raced;
    }
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return written;
}
