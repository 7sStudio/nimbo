// Reading a workspace file the daemon does not own without ever blocking: opened non-blocking and read
// only when its descriptor is a regular file of at most `maxBytes`, so a FIFO in place of `.env` or a settings file
// never freezes the daemon's event loop; anything else is refused with the reason. With `follow: false` the file is
// opened with O_NOFOLLOW, so a symbolic link in its place is refused at the open itself (the npm cache's files).
import type { Stats } from "node:fs";
import { constants, fstatSync, openSync, closeSync, readSync } from "node:fs";
import { open } from "node:fs/promises";

export type FileRead =
  | { readonly kind: "missing" }
  | { readonly kind: "read"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: string };

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Why `stats` may not be read as a file of at most `maxBytes`, or undefined when it may. */
function refusalOf(stats: Stats, maxBytes: number): string | undefined {
  if (stats.isFIFO()) return "it is a FIFO (a named pipe), not a regular file";
  if (stats.isDirectory()) return "it is a directory, not a regular file";
  if (!stats.isFile()) return "it is not a regular file";
  if (stats.size > maxBytes)
    return `it holds ${String(stats.size)} bytes, over the ${String(maxBytes)} allowed`;
  return undefined;
}

/** What a read may follow: `follow: false` refuses a symbolic link at `path` itself (O_NOFOLLOW). */
export type ReadOptions = { readonly follow?: boolean };

/** The error O_NOFOLLOW gives a link: ELOOP, or EMLINK on the BSDs. */
const isLinkRefusal = (error: unknown): boolean =>
  ["ELOOP", "EMLINK"].includes(String(codeOf(error)));

/** Reads `path` as UTF-8 off the event loop when it is a regular file of at most `maxBytes`. */
export async function readRegularFile(
  path: string,
  maxBytes: number,
  options: ReadOptions = {},
): Promise<FileRead> {
  const noFollow = options.follow === false ? constants.O_NOFOLLOW : 0;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | noFollow);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { kind: "missing" };
    if (noFollow !== 0 && isLinkRefusal(error))
      return { kind: "refused", reason: "it is a symbolic link, which is not followed" };
    return { kind: "refused", reason: messageOf(error) };
  }
  try {
    const refused = refusalOf(await handle.stat(), maxBytes);
    if (refused !== undefined) return { kind: "refused", reason: refused };
    const text = await handle.readFile("utf8");
    return Buffer.byteLength(text) > maxBytes
      ? { kind: "refused", reason: `it grew over the ${String(maxBytes)} bytes allowed` }
      : { kind: "read", text };
  } catch (error) {
    return { kind: "refused", reason: messageOf(error) };
  } finally {
    await handle.close();
  }
}

/** The synchronous twin, for the log's redactor, which must mask a secret from the very next line. */
export function readRegularFileSync(path: string, maxBytes: number): FileRead {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { kind: "missing" };
    return { kind: "refused", reason: messageOf(error) };
  }
  try {
    const stats = fstatSync(fd);
    const refused = refusalOf(stats, maxBytes);
    if (refused !== undefined) return { kind: "refused", reason: refused };
    const buffer = Buffer.alloc(stats.size);
    const read = stats.size === 0 ? 0 : readSync(fd, buffer, 0, stats.size, 0);
    return { kind: "read", text: buffer.toString("utf8", 0, read) };
  } catch (error) {
    return { kind: "refused", reason: messageOf(error) };
  } finally {
    closeSync(fd);
  }
}
