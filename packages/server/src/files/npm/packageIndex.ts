// The package folders a bundle imports under a resolved URL: a bare import that Node
// resolves to another folder than the page's own import of that name would is written `/npm/_/<key>/<name>[/<sub>]`,
// the key a hash of the package's real folder and version. The index from key to folder is the daemon's record, kept
// in the npm cache (`_index.json`): Zod-checked when read, written atomically, recorded only while the daemon bundles
// (a folder Node resolution reached from a workspace file or from a file the daemon bundled, never one a request
// names, with the folder it was resolved from), and on disk before a bundle that refers to its key is cached or
// served. A key the index lacks, or whose entry no longer holds (indexTrust.ts: its hash; its lookup folder a real
// folder of the workspace the path rule allows, inside a package Node resolves from the workspace, or inside the real
// folder of another entry that holds; and its folder what Node resolves from there now), is a bare 404 and leaves the index, which is written again without it. Each entry keeps the
// real path of its lookup folder: esbuild hands a folder in the case an import wrote it (`./Lib/x` for `lib/x.js` on
// macOS's file system), which the trust check, reading only real paths, would not take. The security boundary is
// "recorded keys only".
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { isSymbolicLink, writeAtomically } from "../atomicWrite.js";
import { isRealFolder } from "./cacheFiles.js";
import { readRegularFile } from "../regularFile.js";
import type { IndexEntry } from "./indexTrust.js";
import { Entry, foundIfHolds, keyOf } from "./indexTrust.js";
import { parsedJson } from "./inputs.js";
import type { FoundPackage } from "./resolve.js";

const IndexFile = z.object({ entries: z.record(z.string(), z.unknown()) });

/** Where a write the index cannot make is noted (the daemon's log). */
type Warn = { readonly warn: (fields: Readonly<Record<string, unknown>>, message: string) => void };

/** An index is a line per package the bundles import: far below this. */
const maxIndexBytes = 16 * 1024 * 1024;

export type PackageIndex = {
  /** Records `found`, a folder of `name` resolved from the folder `from` (kept as its real path); answers its key. */
  readonly record: (name: string, found: FoundPackage, from: string) => Promise<string>;
  /** The package `key` names as Node finds it now, while its entry holds; else undefined, the key gone from the index. */
  readonly entryOf: (
    key: string,
  ) => Promise<(FoundPackage & { readonly name: string }) | undefined>;
};

/**
 * The index as the cache holds it, each entry checked on its own: one that is not what the schema says is dropped
 * (`dropped`), so the file is written again without it; a file that is no index at all reads as empty. A symbolic link
 * in its place is never read (checked with lstat, opened with O_NOFOLLOW): it reads as empty and is replaced by the
 * index written again, the rename removing the link itself.
 */
async function load(
  cacheDir: string,
  path: string,
): Promise<{ map: Map<string, IndexEntry>; dropped: boolean }> {
  if (!(await isRealFolder(cacheDir))) return { map: new Map(), dropped: false }; // never read through a link
  if (await isSymbolicLink(path).catch(() => false)) return { map: new Map(), dropped: true };
  const read = await readRegularFile(path, maxIndexBytes, { follow: false });
  if (read.kind !== "read") return { map: new Map(), dropped: false };
  const parsed = IndexFile.safeParse(parsedJson(read.text));
  if (!parsed.success) return { map: new Map(), dropped: true };
  const map = new Map<string, IndexEntry>();
  for (const [key, value] of Object.entries(parsed.data.entries)) {
    const entry = Entry.safeParse(value);
    if (/^[0-9a-f]{16}$/.test(key) && entry.success) map.set(key, entry.data);
  }
  return { map, dropped: map.size !== Object.keys(parsed.data.entries).length };
}

/** Writes the index at `path` (in `cacheDir`), one write after another; a write that fails is noted, not thrown. */
function writerOf(cacheDir: string, path: string, log: Warn) {
  let writes: Promise<unknown> = Promise.resolve();
  return async (map: Map<string, IndexEntry>): Promise<void> => {
    const text = `${JSON.stringify({ entries: Object.fromEntries(map) })}\n`;
    const write = async (): Promise<void> => {
      await mkdir(cacheDir, { recursive: true });
      if (!(await isRealFolder(cacheDir))) throw new Error(`${cacheDir} is not a real folder`);
      await writeAtomically(path, text); // a link at its name is replaced, not written through
    };
    writes = writes.then(write).catch((error: unknown) => {
      log.warn(
        { err: error, path },
        "the index of /npm/ packages could not be written; this daemon keeps it",
      );
    });
    await writes;
  };
}

/**
 * The index of the npm cache `cacheDir` for the workspace whose real path is `root`; a write it cannot make is noted,
 * and this daemon goes on from memory.
 */
export function createPackageIndex(cacheDir: string, root: string, log: Warn): PackageIndex {
  const path = join(cacheDir, "_index.json");
  const persist = writerOf(cacheDir, path, log);
  let entries: Promise<Map<string, IndexEntry>> | undefined;
  const loaded = (): Promise<Map<string, IndexEntry>> =>
    (entries ??= load(cacheDir, path).then(async ({ map, dropped }) => {
      if (dropped) await persist(map); // an entry not what the schema says: the file without it
      return map;
    }));
  return {
    record: async (name, found, resolvedFrom) => {
      const from = await realpath(resolvedFrom).catch(() => resolvedFrom); // gone: the check drops it at read
      const map = await loaded();
      const key = keyOf(found);
      if (map.get(key)?.from === from) return key; // recorded already
      map.set(key, { folder: found.folder, from, name, version: found.version });
      await persist(map);
      return key;
    },
    entryOf: async (key) => {
      const map = await loaded();
      const entry = map.get(key);
      if (entry === undefined) return undefined;
      const found = await foundIfHolds({ root, entries: map }, key);
      if (found !== undefined) return { ...found, name: entry.name };
      map.delete(key); // gone, moved, or never reached from the workspace: the index is written without it
      await persist(map);
      return undefined;
    },
  };
}
