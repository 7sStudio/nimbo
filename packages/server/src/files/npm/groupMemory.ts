// What the daemon remembers of its packages' builds (04-kernel §8.1): the builds that failed, each until its package
// changed (a registry package's version is its folder's name; a linked one's files are stamped, the stamp kept a few
// seconds; an install or upgrade in the workspace's node_modules retries a standalone build), and the last split
// builds, bounded by bytes, served when the cache cannot hold them.
import { createHash } from "node:crypto";
import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { CachedSpec } from "./cache.js";
import { isLinkedPackage } from "./spec.js";

/** The files a linked package's stamp covers: far more than one holds. */
const maxStampFiles = 20_000;

/** How long a linked package's stamp is taken as current: a page's burst of requests walks it once. */
const stampMs = 2000;

/** A stamp of the linked package in `folder`: its files' paths, sizes and times, its node_modules and hidden ones aside. */
async function walkStamp(folder: string): Promise<string> {
  const hash = createHash("sha256");
  const folders = [folder];
  let files = 0;
  for (
    let next = folders.pop();
    next !== undefined && files < maxStampFiles;
    next = folders.pop()
  ) {
    const entries = await readdir(next, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(next, entry.name);
      if (entry.isDirectory()) folders.push(path);
      const stats = entry.isFile() ? await stat(path).catch(() => undefined) : undefined;
      if (stats !== undefined)
        hash.update(`${path}\0${String(stats.size)}\0${String(stats.mtimeMs)}\n`);
      files += 1;
    }
  }
  return hash.digest("hex");
}

const stamps = new Map<string, { readonly at: number; readonly stamp: Promise<string> }>();

/** The stamp of a linked package's folder, walked at most every `stampMs`. */
function folderStamp(folder: string): Promise<string> {
  const held = stamps.get(folder);
  if (held !== undefined && Date.now() - held.at < stampMs) return held.stamp;
  const stamp = walkStamp(folder);
  stamps.set(folder, { at: Date.now(), stamp });
  if (stamps.size > 256) stamps.delete(stamps.keys().next().value ?? "");
  return stamp;
}

/**
 * What a failure is kept under: a linked package's files; a registry package's folder (a file added to it, as an
 * install does); with `root`, the workspace's node_modules too.
 */
async function stampOf(spec: CachedSpec, root: string | undefined): Promise<string> {
  const { folder } = spec.found;
  const own = isLinkedPackage(folder)
    ? await folderStamp(folder)
    : String((await lstat(folder).catch(() => undefined))?.mtimeMs);
  if (root === undefined) return own;
  const modules = await lstat(join(root, "node_modules")).catch(() => undefined);
  return `${own}:${String(modules?.mtimeMs)}`;
}

/**
 * The builds that failed, by key, each with its reason, until the stamp of its package changes; with `root`, also
 * until the workspace's node_modules changes (an install may bring what the build lacked).
 */
export function createFailures(root?: string) {
  const failures = new Map<string, { readonly stamp: string; readonly error: Error }>();
  return {
    get: async (key: string, spec: CachedSpec): Promise<Error | undefined> => {
      const held = failures.get(key);
      if (held === undefined) return undefined;
      if (held.stamp === (await stampOf(spec, root))) return held.error;
      failures.delete(key);
      return undefined;
    },
    add: async (key: string, spec: CachedSpec, error: Error): Promise<void> => {
      failures.set(key, { stamp: await stampOf(spec, root), error });
    },
    clear: (): void => {
      failures.clear();
    },
  };
}

/** The last values kept, by key, at most `maxBytes` of them, the oldest dropped first. */
export function createRecent<T>(maxBytes: number, bytesOf: (value: T) => number) {
  const kept = new Map<string, { readonly value: T; readonly bytes: number }>();
  let total = 0;
  const drop = (key: string): void => {
    total -= kept.get(key)?.bytes ?? 0;
    kept.delete(key);
  };
  return {
    get: (key: string): T | undefined => kept.get(key)?.value,
    set: (key: string, value: T): void => {
      drop(key);
      const bytes = bytesOf(value);
      if (bytes > maxBytes) return;
      kept.set(key, { value, bytes });
      total += bytes;
      for (const oldest of kept.keys()) {
        if (total <= maxBytes) break;
        drop(oldest);
      }
    },
    clear: (): void => {
      kept.clear();
      total = 0;
    },
  };
}
