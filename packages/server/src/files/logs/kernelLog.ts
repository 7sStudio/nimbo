// Each kernel's log: `.jsnb/logs/kernel-<notebook>.log`, the lines kernel-node hands to onLog
// (already redacted on its side of the pipes), rotated like the daemon log. The name is the ref encoded
// into one flat file name; a ref that encodes past 120 bytes (nine bytes per CJK character, a deep path) keeps a readable
// prefix and a short hash of the ref instead, well under a file system's 255-byte name. Lines it cannot write are
// dropped and counted (drops.ts), never thrown. A deleted notebook's log goes with it and a renamed one's follows it,
// so a notebook made later under the old name never shows the older one's log.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { droppingWriter } from "./drops.js";
import { defaultFiles, openRotatingFile } from "./rotatingFile.js";

const maxEncodedBytes = 120;
const prefixBytes = 60;

/** The longest start of `text` whose encoding fits `bytes`, cut between code points. */
function prefixOf(text: string, bytes: number): string {
  let prefix = "";
  for (const char of text) {
    if (encodeURIComponent(prefix + char).length > bytes) break;
    prefix += char;
  }
  return encodeURIComponent(prefix);
}

/** `kernel-demo.log` for demo.jsnb, `kernel-sub%2Fdemo.log` for sub/demo.jsnb; a long ref: `kernel-<prefix>-<hash>.log`. */
function kernelLogName(ref: string): string {
  const name = ref.replace(/\.jsnb$/, "");
  const encoded = encodeURIComponent(name);
  if (encoded.length <= maxEncodedBytes) return `kernel-${encoded}.log`;
  const hash = createHash("sha256").update(ref).digest("hex").slice(0, 12);
  return `kernel-${prefixOf(name, prefixBytes)}-${hash}.log`;
}

/** The log file's absolute path: what kernel.log answers and the kernel-exited banner's "Kernel log" opens. */
export const kernelLogPath = (folder: string, ref: string): string =>
  join(folder, kernelLogName(ref));

export type LogTail = {
  readonly path: string;
  /** The last lines of the current file, oldest first; none when the file is missing or empty. */
  readonly lines: readonly string[];
  /** Earlier lines exist: in the file beyond `lines`, or beyond the window read (64 KiB); rotated files are not read. */
  readonly truncated: boolean;
};

const tailWindowBytes = 64 * 1024;

/** The last `count` lines of the log at `path` (kernel.log): read without following a link, from the
 * last 64 KiB; a file that is missing, unreadable or a link answers no lines. */
export function readLogTail(path: string, count: number): LogTail {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { path, lines: [], truncated: false }; // no log yet, or one the daemon must not read (a link)
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - tailWindowBytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const all = buffer.toString("utf8").split("\n");
    if (all.at(-1) === "") all.pop();
    const cut = start > 0 && all.length > 1 ? 1 : 0; // a window that opens mid-line drops that partial line
    const whole = all.slice(cut);
    const lines = whole.slice(Math.max(0, whole.length - count));
    return { path, lines, truncated: lines.length < whole.length || start > 0 };
  } catch {
    return { path, lines: [], truncated: false }; // a read that fails mid-way: no lines rather than a daemon error
  } finally {
    closeSync(fd);
  }
}

export type KernelLog = {
  /** Appends a line; one the file drops is counted and noted before the next it writes, never thrown. */
  readonly write: (line: string) => void;
  readonly close: () => void;
};

/**
 * Opens the log of the kernel of `ref` in `folder`; one that cannot be opened yet (a full disk, a folder that refuses
 * writes) is opened at the next line, so a notebook opens all the same.
 */
export function openKernelLog(folder: string, ref: string): KernelLog {
  const file = openRotatingFile(join(folder, kernelLogName(ref)));
  return { write: droppingWriter(file, "kernel log"), close: file.close };
}

/** The kernel log of `ref` and its rotated files, live one first: `kernel-demo.log`, `kernel-demo.log.1` … `.4`. */
function kernelLogFiles(folder: string, ref: string): readonly string[] {
  const live = kernelLogPath(folder, ref);
  return [
    live,
    ...Array.from({ length: defaultFiles - 1 }, (_, at) => `${live}.${String(at + 1)}`),
  ];
}

/** Told of a kernel log file that could not be removed, so the daemon log says why it stayed. */
export type KernelLogLeft = (file: string, error: unknown) => void;

/**
 * Removes the kernel log of the deleted notebook `ref` and its rotated files (notebook.delete). A log is safe to
 * delete: one that cannot be removed stays, `left` is told, and the delete goes on, so this never
 * rejects.
 */
export async function removeKernelLog(
  folder: string,
  ref: string,
  left: KernelLogLeft = () => undefined,
): Promise<void> {
  await Promise.all(
    kernelLogFiles(folder, ref).map((file) =>
      rm(file, { force: true }).catch((error: unknown) => {
        left(file, error);
      }),
    ),
  );
}

/**
 * Moves the kernel log of `ref` and its rotated files to the names of `to` (notebook.rename), the leftovers of an
 * older `to` removed first so the logs are the renamed notebook's alone; `sameFile` (a rename that only changes the
 * case of the name, on a file system that ignores case) removes nothing, since `to`'s files are `ref`'s. A file that
 * cannot be moved is removed instead, and one that cannot be removed either stays, `left` told: this never rejects.
 */
export async function moveKernelLog(
  folder: string,
  move: { readonly ref: string; readonly to: string; readonly sameFile: boolean },
  left: KernelLogLeft = () => undefined,
): Promise<void> {
  const [from, to] = [kernelLogFiles(folder, move.ref), kernelLogFiles(folder, move.to)];
  if (from[0] === to[0]) return;
  if (!move.sameFile) await removeKernelLog(folder, move.to, left);
  await Promise.all(
    from.map(async (file, at) => {
      await rename(file, to[at] ?? file).catch(async (error: unknown) => {
        if (Reflect.get(Object(error), "code") === "ENOENT") return; // no such rotated file
        await rm(file, { force: true }).catch((removal: unknown) => {
          left(file, removal);
        });
      });
    }),
  );
}
