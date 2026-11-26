// A log file rotated at a size (5 × 1 MB): `name.log`, then `name.log.1` … `name.log.4`, the oldest
// dropped. Writes are synchronous appends, so a line logged right before a crash is on disk and lines never interleave.
// A log file is never opened through a symbolic link (O_NOFOLLOW): a link planted in `.jsnb/logs` is WorkspaceUnusable.
// Neither the open nor a write throws anything else (a full disk must not end the daemon or a notebook's open):
// a file that cannot be opened is opened again at the next line, a line that cannot be written, or
// whose rotation fails, is dropped and `write` says so, and a line cut short is cut back off the file (ftruncate, which
// a full disk allows), so every line in it is whole; only when that fails too does the next line start on its own.
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";

import { WorkspaceUnusable } from "../workspaceDir.js";

/** How many files a rotated log keeps by default, the live one included: `name.log` and `name.log.1` … `.4`. */
export const defaultFiles = 5;

export type RotatingFile = {
  /** Appends `text`, rotating first when it would cross the size; false when it could not be written (dropped). */
  readonly write: (text: string) => boolean;
  /** The code of the last failure (`ENOSPC`, `EACCES`…), for the note of what was dropped. */
  readonly lastFailure: () => string;
  readonly close: () => void;
};

/** writeSync's shape: bytes from `at` written to `fd`, how many went in. */
type WriteSync = (fd: number, bytes: Buffer, at: number) => number;

export type RotationOptions = {
  /** The size a file may reach before rotation; default 1 MiB. */
  readonly maxBytes?: number;
  /** How many files are kept, the live one included; default 5. */
  readonly files?: number;
  /**
   * writeSync, or a stub for the one failure no real file produces on demand: a disk that fills in the middle of a
   * line (a full disk takes a disk image).
   */
  readonly writeSync?: WriteSync;
};

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** Renames `from` to `to` when `from` exists. */
function shift(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error; // nothing to shift at this position yet
  }
}

const appendFlags =
  constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW;

/** `path` opened for appending, never through a link. */
function openAppend(path: string): number {
  try {
    return openSync(path, appendFlags, 0o600);
  } catch (error) {
    if (codeOf(error) !== "ELOOP") throw error;
    throw new WorkspaceUnusable({ path, reason: "it is a symbolic link" }, { cause: error });
  }
}

type File = {
  readonly path: string;
  readonly maxBytes: number;
  readonly files: number;
  readonly writeSync: WriteSync;
  /** Undefined while no file is open (its open failed, or a failed rotation closed it): the next write opens it. */
  fd: number | undefined;
  size: number;
  /** A write failed part-way: the next line starts with a newline of its own. */
  cut: boolean;
  failure: string;
  closed: boolean;
};

/** The file open again (its open failed, or a rotation lost it), its size read from it. */
function reopen(file: File): number {
  const fd = openAppend(file.path);
  file.fd = fd;
  file.size = fstatSync(fd).size;
  return fd;
}

function rotate(file: File): number {
  if (file.fd !== undefined) closeSync(file.fd);
  file.fd = undefined;
  rmSync(`${file.path}.${String(file.files - 1)}`, { force: true });
  for (let index = file.files - 2; index >= 1; index -= 1) {
    shift(`${file.path}.${String(index)}`, `${file.path}.${String(index + 1)}`);
  }
  shift(file.path, `${file.path}.1`);
  const fd = openAppend(file.path);
  file.fd = fd;
  file.size = 0;
  file.cut = false;
  return fd;
}

/** The size of the open file `fd`; undefined when even that fails. */
function sizeOf(fd: number): number | undefined {
  try {
    return fstatSync(fd).size;
  } catch {
    return undefined; // the size the file kept count of stands
  }
}

/**
 * A line that failed part-way is cut back off: the file truncated to `size`, its length before the line. When that fails too, the part written stays and the next line starts with a newline of its own.
 */
function cutBack(file: File, fd: number, size: number): void {
  try {
    ftruncateSync(fd, size);
  } catch {
    file.cut = true; // the cut part stays: the next line begins on a line of its own
    file.size = sizeOf(fd) ?? file.size;
  }
}

/** One line to the file: opened or rotated first when needed, then written whole; throws what the file system throws. */
function append(file: File, text: string): void {
  let fd = file.fd ?? reopen(file);
  const bytes = Buffer.from(file.cut ? `\n${text}` : text);
  if (file.size > 0 && file.size + bytes.length > file.maxBytes) fd = rotate(file);
  let at = 0;
  try {
    while (at < bytes.length) at += file.writeSync(fd, bytes, at);
  } catch (error) {
    if (at > 0) cutBack(file, fd, file.size);
    throw error;
  }
  file.cut = false;
  file.size += bytes.length;
}

const codeText = (error: unknown): string => {
  const code = codeOf(error);
  return typeof code === "string" ? code : "EIO";
};

/** Opens `path` for appending with rotation; a file that cannot be opened yet is opened at the next line. */
export function openRotatingFile(path: string, options: RotationOptions = {}): RotatingFile {
  const file: File = {
    path,
    maxBytes: options.maxBytes ?? 1_048_576,
    files: options.files ?? defaultFiles,
    writeSync: options.writeSync ?? writeSync,
    fd: undefined,
    size: 0,
    cut: false,
    failure: "",
    closed: false,
  };
  try {
    reopen(file);
  } catch (error) {
    if (error instanceof WorkspaceUnusable) throw error; // a planted link is refused, as at every open
    file.failure = codeText(error); // a full disk, a folder that refuses writes: tried again at the next line
  }
  return {
    write: (text) => {
      if (file.closed) return false;
      try {
        append(file, text);
        return true;
      } catch (error) {
        // A full disk, a folder that refuses writes, a link planted for the rotation: the line is dropped, never thrown
        // into the caller, which may be any code that logs (the daemon keeps running and keeps its state).
        file.failure = codeText(error);
        return false;
      }
    },
    lastFailure: () => file.failure,
    close: () => {
      if (file.closed) return;
      file.closed = true;
      if (file.fd !== undefined) closeSync(file.fd);
    },
  };
}
