// The cache of a package's split bundle (04-kernel §8.1, 07-file-format §7), in the package's entry folder beside its
// standalone bundles: each entry's bundle under the standalone name of its subpath, each chunk as `chunks/<hash>.js`,
// `group.json` (the entries and chunks the build made, with their sizes), `group.imports.json` (importsRecord.ts) and, for a linked
// package, `group.inputs.json` (inputs.ts, its package.json included), then meta.json last, each written under a temp
// name and renamed into place. An entry is served while meta.json names today's esbuild and rule, its imports resolve
// as recorded, the keys they name are in the index and a linked package's files are unchanged; else the whole package
// is built again. A chunk is served from the cache while meta.json is current, whatever else changed since: its name
// is its content's hash, so it is what the entry that imports it was built with; a chunk the cache lacks builds the
// package again (esbuild makes the same chunk from the same files). The chunks of the build before are kept (a page
// that loaded its entries may still import one), older ones removed when the package is written again; a manifest is
// read once per identity of its file. A split bundle the cache cannot hold is still served.
import { lstat, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { writeAtomically } from "../atomicWrite.js";
import type { CachedSpec, Where } from "./cache.js";
import { bundleName, cleared, current, keysRecorded, maxBundleBytes, metaText } from "./cache.js";
import { cacheFolder, madeCacheFolder, readCacheFile } from "./cacheFiles.js";
import { importsText, importsUnchanged } from "./importsRecord.js";
import type { Identity } from "./inputs.js";
import { identityOf, inputsUnchanged, parsedJson, recordText } from "./inputs.js";
import type { Group } from "./packageGroup.js";
import { isLinkedPackage } from "./spec.js";

/** Each entry's and chunk's size in bytes, written durably after them: a file of another size is no cache. */
const Manifest = z.object({
  entries: z.record(z.string(), z.number()),
  chunks: z.record(z.string(), z.number()),
  /** The chunks of the build before, kept for a page that loaded its entries (a later dynamic import). */
  previous: z.record(z.string(), z.number()).optional(),
});
type Manifest = z.infer<typeof Manifest>;

/** A manifest names each entry and chunk once: far below this. */
const maxManifestBytes = 16 * 1024 * 1024;

/** How many cache files are written at once: a package's chunks number in the hundreds. */
const writesAtOnce = 32;

/** What the cache holds for a subpath or a chunk: its text, nothing (`absent`), or no such one in a current build. */
export type Held =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "none" };

const absent: Held = { kind: "absent" };
const none: Held = { kind: "none" };

/** Whether the split bundle in `folder` is still good: what made it, its imports, its keys and a linked one's files. */
async function stillGood(where: Where, spec: CachedSpec, folder: string): Promise<boolean> {
  if (!(await current(folder))) return false;
  if (
    isLinkedPackage(spec.found.folder) &&
    !(await inputsUnchanged(join(folder, "group.inputs.json")))
  ) {
    return false;
  }
  const imports = join(folder, "group.imports.json");
  if (!(await importsUnchanged(where.resolver, imports))) return false;
  const record = await readCacheFile(imports, maxManifestBytes);
  return record !== undefined && (await keysRecorded(where.resolver.index, record));
}

/** The entry `spec.subpath` of the cached split bundle: its text, absent (build it), or none (not an entry of it). */
export async function heldEntry(where: Where, spec: CachedSpec): Promise<Held> {
  await cleared(where, spec.dir);
  const folder = await cacheFolder(where.cacheDir, spec.dir);
  if (folder?.present !== true) return absent;
  const manifest = await manifestIn(folder.path);
  if (manifest === undefined || !(await stillGood(where, spec, folder.path))) return absent;
  const size = manifest.entries[spec.subpath === "" ? "" : `/${spec.subpath}`];
  if (size === undefined) return none;
  return sized(
    await readCacheFile(join(folder.path, bundleName(spec.subpath)), maxBundleBytes),
    size,
  );
}

/** A cache file's text when it has the size its manifest records; absent otherwise (a write a crash cut short). */
const sized = (text: string | undefined, size: number | undefined): Held =>
  text !== undefined && Buffer.byteLength(text) === size ? { kind: "text", text } : absent;

/**
 * The chunk `hash` of the cached split bundle while meta.json is current: none when its manifest lists no such chunk,
 * absent when there is no manifest or the file is not the one it lists.
 */
export async function heldChunk(where: Where, spec: CachedSpec, hash: string): Promise<Held> {
  await cleared(where, spec.dir);
  const folder = await cacheFolder(where.cacheDir, `${spec.dir}/chunks`);
  if (folder?.present !== true) return absent;
  const entry = dirname(folder.path);
  if (!(await current(entry))) return absent;
  const manifest = await manifestIn(entry);
  if (manifest === undefined) return absent;
  const size = manifest.chunks[hash] ?? manifest.previous?.[hash];
  if (size === undefined) return none; // no chunk of the build the cache holds: nothing to build again for
  return sized(await readCacheFile(join(folder.path, `${hash}.js`), maxBundleBytes), size);
}

/** The manifest of the entry folder `folder`; undefined when there is none or it is not what the schema says. */
async function manifestIn(folder: string): Promise<Manifest | undefined> {
  const path = join(folder, "group.json");
  const stamp = await stampOf(path);
  const held = manifests.get(path);
  if (stamp !== undefined && held?.stamp === stamp) return held.manifest;
  const read = await readCacheFile(path, maxManifestBytes);
  const manifest = read === undefined ? undefined : Manifest.safeParse(parsedJson(read)).data;
  if (stamp !== undefined && manifest !== undefined) remember(manifests, path, { stamp, manifest });
  return manifest;
}

/** A cache file's identity: a file written again is a new one (atomicWrite.ts renames it into place). */
const stampOf = (path: string): Promise<string | undefined> =>
  lstat(path).then(
    (stats) => `${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}`,
    () => undefined,
  );

/** The manifests read, by path and identity: a warm page load asks for one per chunk (date-fns: 260). */
const manifests = new Map<string, { readonly stamp: string; readonly manifest: Manifest }>();

/** How many manifests are kept read: far more than a page imports packages. */
const manifestsKept = 256;

function remember<T>(memo: Map<string, T>, key: string, value: T): void {
  memo.delete(key);
  memo.set(key, value);
  const [oldest] = memo.keys();
  if (memo.size > manifestsKept && oldest !== undefined) memo.delete(oldest);
}

/** Writes `files` (path to text) a few at a time, without an fsync each: the manifest records their sizes. */
async function writeAll(files: readonly (readonly [string, string])[]): Promise<void> {
  for (let at = 0; at < files.length; at += writesAtOnce) {
    const some = files.slice(at, at + writesAtOnce);
    await Promise.all(some.map(([path, text]) => writeAtomically(path, text, { durable: false })));
  }
}

/** Each text's size in bytes, by its key. */
const sizesOf = (texts: ReadonlyMap<string, string>): Record<string, number> =>
  Object.fromEntries([...texts].map(([key, text]) => [key, Buffer.byteLength(text)]));

/** The identities a linked package's record keeps: what the build read, and its package.json. */
async function linkedInputs(spec: CachedSpec, inputs: readonly Identity[] | undefined) {
  const manifest = await identityOf(join(spec.found.folder, "package.json"));
  return inputs === undefined || manifest === undefined ? [] : [...inputs, manifest]; // none: built again next time
}

/** Removes the chunks of `folder` that neither the build nor the one before holds. */
async function prune(folder: string, kept: Readonly<Record<string, number>>): Promise<void> {
  const names = await readdir(folder);
  const stale = names.filter((name) => !Object.hasOwn(kept, name.replace(/\.js$/, "")));
  await Promise.all(stale.map((name) => rm(join(folder, name), { force: true })));
}

/**
 * Writes the split bundle `group` of `spec` to the cache, meta.json last; a write that fails is noted, and the bundle
 * in hand is still served.
 */
export async function cacheGroup(
  where: Where,
  spec: CachedSpec,
  group: Extract<Group, { ok: true }>,
) {
  try {
    const folder = await madeCacheFolder(where.cacheDir, spec.dir);
    const chunks = await madeCacheFolder(where.cacheDir, `${spec.dir}/chunks`);
    if (folder === undefined || chunks === undefined) return; // not a folder the cache may use: served, not cached
    await writeAll([
      ...[...group.chunks].map(([hash, text]) => [join(chunks, `${hash}.js`), text] as const),
      ...[...group.entries].map(
        ([subpath, text]) => [join(folder, bundleName(subpath.slice(1))), text] as const,
      ),
    ]);
    if (isLinkedPackage(spec.found.folder)) {
      const inputs = await linkedInputs(spec, group.inputs);
      await writeAtomically(join(folder, "group.inputs.json"), recordText(inputs));
    }
    await writeAtomically(join(folder, "group.imports.json"), importsText(group.imports));
    const chunkSizes = sizesOf(group.chunks);
    const before = (await current(folder)) ? await manifestIn(folder) : undefined;
    const previous = Object.fromEntries(
      Object.entries(before?.chunks ?? {}).filter(([hash]) => !Object.hasOwn(chunkSizes, hash)),
    );
    const manifest = { entries: sizesOf(group.entries), chunks: chunkSizes, previous };
    await writeAtomically(join(folder, "group.json"), `${JSON.stringify(manifest)}\n`);
    await writeAtomically(join(folder, "meta.json"), metaText(spec.name, spec.found.version));
    await prune(chunks, { ...previous, ...chunkSizes });
  } catch (error) {
    where.log.warn(
      { err: error, dir: spec.dir },
      "a split bundle could not be cached; it is built again next time",
    );
  }
}
