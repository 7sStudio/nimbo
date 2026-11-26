// The workspace files kernel-node opens itself, read and written without ever blocking: the
// kernel's and the log redactor's .env, the daemon side's .jsnb/loader.mjs. A FIFO with no writer blocks whatever
// opens it for reading, and one with no reader whatever opens it for writing, for good; a synchronous read of one on
// the daemon's event loop froze every kernel it served. So a file is opened non-blocking and read or written only when
// its descriptor is a regular file (of at most `maxBytes` to read); anything else is refused at once with the reason.
// nimbo's own file, the loader, is also never read or written through a symbolic link (O_NOFOLLOW): a workspace from
// someone else could make a kernel start overwrite one of the user's files through one. A symlinked .env, a common
// setup the kernel only reads, is still followed.
import { Buffer } from "node:buffer";
import type { Stats } from "node:fs";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { lstat, open } from "node:fs/promises";

export type FileRead =
  | { readonly kind: "missing" }
  | { readonly kind: "read"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: string };

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** Why an open or a stat failed: a symbolic link refused by O_NOFOLLOW (ELOOP), else the error's own message. */
const reasonOf = (error: unknown): string => {
  if (codeOf(error) === "ELOOP") return "it is a symbolic link, not a regular file";
  return error instanceof Error ? error.message : String(error);
};

/** O_NOFOLLOW where the platform has it (POSIX); 0 elsewhere. */
const noFollowFlag: unknown = Reflect.get(constants, "O_NOFOLLOW");
const noFollow = typeof noFollowFlag === "number" ? noFollowFlag : 0;

/** What `stats` is, when it is not a regular file. */
function notRegular(stats: Stats): string {
  if (stats.isFIFO()) return "it is a FIFO (a named pipe), not a regular file";
  if (stats.isDirectory()) return "it is a directory, not a regular file";
  if (stats.isSocket()) return "it is a socket, not a regular file";
  if (stats.isCharacterDevice() || stats.isBlockDevice())
    return "it is a device, not a regular file";
  return "it is not a regular file";
}

const grew = (maxBytes: number): string =>
  `it grew over the ${String(maxBytes)} bytes allowed while it was read`;

/** The refusal of `stats` for a read of at most `maxBytes`, or undefined when it may be read. */
function refusalOf(stats: Stats, maxBytes: number): string | undefined {
  if (!stats.isFile()) return notRegular(stats);
  if (stats.size > maxBytes)
    return `it holds ${String(stats.size)} bytes, over the ${String(maxBytes)} allowed`;
  return undefined;
}

/**
 * Reads the open file `fd` to its end as UTF-8, at most `maxBytes`: into a buffer of `size` bytes, its fstat size, and
 * one more to see the end, grown only while the file grows as it is read (a .env is a few hundred bytes, not 1 MiB).
 */
export function readToEndSync(fd: number, size: number, maxBytes: number): FileRead {
  let buffer = Buffer.alloc(Math.min(size, maxBytes) + 1);
  let length = 0;
  for (;;) {
    const read = readSync(fd, buffer, length, buffer.length - length, null);
    if (read === 0) return { kind: "read", text: buffer.toString("utf8", 0, length) };
    length += read;
    if (length > maxBytes) return { kind: "refused", reason: grew(maxBytes) };
    if (length === buffer.length) {
      const larger = Buffer.alloc(Math.min(buffer.length * 2, maxBytes + 1));
      buffer.copy(larger, 0, 0, length);
      buffer = larger;
    }
  }
}

/** Reads the file at `path` as UTF-8 when it is a regular file of at most `maxBytes`; never blocks on a FIFO. */
export function readRegularFileSync(path: string, maxBytes: number): FileRead {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    return codeOf(error) === "ENOENT"
      ? { kind: "missing" }
      : { kind: "refused", reason: reasonOf(error) };
  }
  try {
    const stats = fstatSync(fd);
    const refused = refusalOf(stats, maxBytes);
    if (refused !== undefined) return { kind: "refused", reason: refused };
    return readToEndSync(fd, stats.size, maxBytes);
  } catch (error) {
    return { kind: "refused", reason: reasonOf(error) };
  } finally {
    closeSync(fd);
  }
}

/**
 * Reads the file at `path` as UTF-8 off the event loop when it is a regular file of at most `maxBytes`, never through
 * a symbolic link (the loader's read).
 */
export async function readRegularFile(path: string, maxBytes: number): Promise<FileRead> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | noFollow);
  } catch (error) {
    return codeOf(error) === "ENOENT"
      ? { kind: "missing" }
      : { kind: "refused", reason: reasonOf(error) };
  }
  try {
    const refused = refusalOf(await handle.stat(), maxBytes);
    if (refused !== undefined) return { kind: "refused", reason: refused };
    const text = await handle.readFile("utf8");
    return Buffer.byteLength(text) > maxBytes
      ? { kind: "refused", reason: grew(maxBytes) }
      : { kind: "read", text };
  } catch (error) {
    return { kind: "refused", reason: reasonOf(error) };
  } finally {
    await handle.close();
  }
}

/**
 * Writes `text` to `path` when it is absent or a regular file, off the event loop and never through a symbolic link;
 * the reason it was refused otherwise. Anything else is refused before it is opened, and the open is non-blocking and
 * O_NOFOLLOW, so a FIFO or a link that took its place in the meantime fails at once.
 */
export async function writeRegularFile(path: string, text: string): Promise<string | undefined> {
  try {
    const existing = await lstat(path).catch((error: unknown) => {
      if (codeOf(error) === "ENOENT") return undefined;
      throw error;
    });
    if (existing?.isSymbolicLink()) return "it is a symbolic link, not a regular file";
    if (existing && !existing.isFile()) return notRegular(existing);
    const flags =
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NONBLOCK | noFollow;
    const handle = await open(path, flags, 0o644);
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) return notRegular(opened);
      await handle.writeFile(text);
      return undefined;
    } finally {
      await handle.close();
    }
  } catch (error) {
    return reasonOf(error);
  }
}
