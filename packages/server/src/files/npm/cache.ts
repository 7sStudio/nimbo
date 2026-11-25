// The cache of package bundles for /npm/ (04-kernel §8.1, 07-file-format §7): `.jsnb/cache/npm/<name>@<version>/` for
// the page's own import of a package and `.jsnb/cache/npm/_/<key>/` for a resolved form hold
// `index.js` (or the subpath's file) and `meta.json`, which names the esbuild version that made it and the version of
// the path rule it passed, so a newer esbuild or rule builds (and checks) again; a refused bundle is never cached, and
// a cached bundle that imports a resolved key the index no longer holds is built again (recording it). Every bundle
// keeps what its bare imports resolved to (`<bundle>.imports.json`, importsRecord.ts) and is built again once one would
// resolve to another URL. A linked package's bundle also keeps what it read (`<bundle>.inputs.json`,
// inputs.ts) and is built again once one of those files changed. Each file
// is written under a temp name and renamed into place, meta.json last: a write cut short leaves no
// file a later request serves. A bundle that cannot be cached is still served. Its files are read non-blocking and as
// regular files only, and nothing in the cache is read, written or removed through a symbolic link
// (cacheFiles.ts): a link planted in an entry's place is removed and the entry built again.
import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";

import { version as esbuildVersion } from "esbuild";
import { z } from "zod";

import { writeAtomically } from "../atomicWrite.js";
import type { Built } from "./bundle.js";
import { cacheFolder, madeCacheFolder, readCacheFile } from "./cacheFiles.js";
import type { Identity } from "./inputs.js";
import { inputsUnchanged, parsedJson, recordText } from "./inputs.js";
import type { Resolver } from "./bareImport.js";
import { importsText, importsUnchanged } from "./importsRecord.js";
import type { PackageIndex } from "./packageIndex.js";
import { bundlePackage } from "./packageBundle.js";
import type { FoundPackage } from "./resolve.js";
import { isLinkedPackage } from "./spec.js";

/** Where builds are noted (the daemon's log; `files/` imports no other layer). */
export type NoteLog = {
  readonly info: (fields: Readonly<Record<string, unknown>>, message: string) => void;
  readonly warn: (fields: Readonly<Record<string, unknown>>, message: string) => void;
};

/** The path rule's version a cached bundle passed: one cached under an earlier rule is built and checked again. */
const pathRule = 9; // 9: a subpath's bundle named apart from the main's and from other cases

/** A cached bundle's meta.json: the esbuild version and the rule that made it decide whether it is still good. */
const CacheMeta = z.looseObject({ esbuild: z.string(), rule: z.number().optional() });

/** A meta.json is a line of JSON; a bundle is a package's code, which a page could not load past this anyway. */
const maxMetaBytes = 64 * 1024;
export const maxBundleBytes = 256 * 1024 * 1024;

/**
 * A bundle the cache is asked for: the package's name and subpath, the folder Node found, the URL the page names that
 * folder by (`/npm/<name>` or the resolved form), and its folder in the cache.
 */
export type CachedSpec = {
  readonly name: string;
  readonly subpath: string;
  readonly found: FoundPackage;
  readonly base: string;
  /** `<name>@<version>` for the page's own import, `_/<key>` for a resolved form. */
  readonly dir: string;
  /** For a standalone bundle: the subpaths the package's split bundle serves (none when it is built entry by entry). */
  readonly siblings?: readonly string[];
};

export type Where = {
  readonly cacheDir: string;
  readonly log: NoteLog;
  readonly resolver: Resolver;
  /** Each package folder of the cache this daemon has checked, once, before any of its builds wrote there. */
  readonly cleared: Map<string, Promise<void>>;
};

/** The meta.json files found current, with the identity they had. */
const currents = new Map<string, string>();

/** Whether the meta.json of the entry folder `path` names today's esbuild and path rule. */
export async function current(path: string): Promise<boolean> {
  const file = join(path, "meta.json");
  const identity = await lstat(file).then(
    (stats) => `${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}`,
    () => undefined, // none yet: no cache
  );
  if (identity === undefined) return false;
  if (currents.get(file) === identity) return true; // read once per identity: each chunk of a warm load asks
  const meta = await readCacheFile(file, maxMetaBytes);
  const stamp = meta === undefined ? undefined : CacheMeta.safeParse(parsedJson(meta)).data;
  const good = stamp?.esbuild === esbuildVersion && stamp.rule === pathRule;
  if (good) currents.set(file, identity);
  if (currents.size > 1024) currents.delete(currents.keys().next().value ?? "");
  return good;
}

/**
 * The entry folder `dir` made by another esbuild or rule (or with no meta.json) is removed, a link in a folder's place
 * by cacheFolder (the link itself); a failure is noted, not thrown. The folder removed is a real one, checked just
 * before, and a link inside it is removed itself, not followed.
 */
async function clearIfStale(where: Where, dir: string): Promise<void> {
  const folder = await cacheFolder(where.cacheDir, dir);
  if (folder?.present !== true || (await current(folder.path))) return;
  await rm(folder.path, { recursive: true, force: true }).catch((error: unknown) => {
    where.log.warn(
      { err: error, dir },
      "a stale cache folder could not be removed; its bundles are built again",
    );
  });
}

/**
 * The package folder `dir` checked once per daemon, before any of its bundles is looked up or written: concurrent
 * builds of a package's entries (qs's tree requires a dozen `math-intrinsics/*` at once) share one folder, and a
 * removal that ran while another build wrote there failed that request with ENOTEMPTY.
 */
export function cleared(where: Where, dir: string): Promise<void> {
  const known = where.cleared.get(dir);
  if (known !== undefined) return known;
  const clearing = clearIfStale(where, dir);
  where.cleared.set(dir, clearing);
  return clearing;
}

/** Whether every resolved key a cached bundle imports is still in the index; else it is built again, recording them. */
export async function keysRecorded(index: PackageIndex, text: string): Promise<boolean> {
  const keys = new Set(
    [...text.matchAll(/\/npm\/_\/([0-9a-f]{16})\//g)].map((match) => match[1] ?? ""),
  );
  const entries = await Promise.all([...keys].map((key) => index.entryOf(key)));
  return entries.every((entry) => entry !== undefined);
}

/**
 * What the cache holds for `spec`, its bundle named `name` in the entry's folder, checked with lstat before any of its
 * files is opened: `text` when still good, `own` when the package is a linked one (its inputs checked).
 */
async function lookup(where: Where, spec: CachedSpec, name: string) {
  const own = isLinkedPackage(spec.found.folder); // a linked package: its files are checked
  const folder = await cacheFolder(where.cacheDir, spec.dir);
  if (folder?.present !== true) return { own, text: undefined };
  const file = join(folder.path, name);
  const fresh =
    (await current(folder.path)) &&
    (!own || (await inputsUnchanged(recordOf(file)))) &&
    (await importsUnchanged(where.resolver, importsOf(file)));
  const text = fresh ? await readCacheFile(file, maxBundleBytes) : undefined;
  const recorded = text !== undefined && (await keysRecorded(where.resolver.index, text));
  return { own, text: recorded ? text : undefined };
}

/** The meta.json of an entry folder: what made its bundles. */
export const metaText = (name: string, version: string): string =>
  `${JSON.stringify({ name, version, esbuild: esbuildVersion, rule: pathRule })}\n`;

/**
 * The name of a subpath's bundle in its entry folder (`""` or `locale/fr`, no leading slash): a subpath's name starts
 * with `@`, so the main's never meets one (a package exporting both `.` and `./index`), and names differing only by
 * case stay apart on a file system that ignores it.
 */
export const bundleName = (subpath: string): string =>
  subpath === "" ? "index.js" : `@${caseless(encodeURIComponent(subpath))}.js`;

/** `name` with each capital written `^` and its small letter (`^` is escaped by then): one file whatever case rules. */
const caseless = (name: string): string =>
  name.replaceAll(/[A-Z]/g, (capital) => `^${capital.toLowerCase()}`);

/** The cached bundle of `spec` while it is still good; undefined when it is to be built. */
export async function heldBundle(where: Where, spec: CachedSpec): Promise<string | undefined> {
  await cleared(where, spec.dir);
  return (await lookup(where, spec, bundleName(spec.subpath))).text;
}

/** The cached bundle when it is still good, else a fresh one written to the cache. */
export async function cachedBundle(
  where: Where,
  spec: CachedSpec,
  signal: AbortSignal,
): Promise<Built> {
  const { version } = spec.found;
  const name = bundleName(spec.subpath);
  await cleared(where, spec.dir);
  const found = await lookup(where, spec, name);
  if (found.text !== undefined) return { ok: true, text: found.text };
  const subpath = spec.subpath === "" ? "" : `/${spec.subpath}`;
  where.log.info({ spec: `${spec.name}${subpath}`, version }, "bundling a package for the page");
  const built = await bundlePackage(
    {
      name: spec.name,
      subpath,
      base: spec.base,
      found: spec.found,
      siblings: spec.siblings ?? [""],
    },
    where.resolver,
    signal,
  );
  if (!built.ok) return built; // refused by the rule: nothing is cached
  const inputs = found.own ? (built.inputs ?? []) : undefined; // none taken: an empty record, built again next time
  await cache(where, {
    dir: spec.dir,
    name,
    body: built.text,
    inputs,
    imports: importsText(built.imports),
    meta: metaText(spec.name, version),
  });
  return { ok: true, text: built.text };
}

/** Where a workspace package's bundle `file` keeps what it read. */
const recordOf = (file: string): string => `${file}.inputs.json`;

/** Where a bundle `file` keeps what its bare imports resolved to. */
const importsOf = (file: string): string => `${file}.imports.json`;

/**
 * Writes a bundle to the cache, in its entry's folder made real first (a link in its place removed), each file under a
 * temp name renamed into place and meta.json last, so a write cut short (a full disk, a crash) leaves no file a later
 * request serves: without its meta.json the bundle is built again. A write that fails is noted and the page still gets
 * its module: the cache is a convenience.
 */
async function cache(
  where: Where,
  entry: {
    /** The entry's folder below the cache, and the bundle's name in it. */
    readonly dir: string;
    readonly name: string;
    readonly body: string;
    /** What a linked package's bundle read; a registry package's has no record. */
    readonly inputs: readonly Identity[] | undefined;
    /** What its bare imports resolved to (importsRecord.ts). */
    readonly imports: string;
    readonly meta: string;
  },
): Promise<void> {
  try {
    const folder = await madeCacheFolder(where.cacheDir, entry.dir);
    if (folder === undefined) return; // not a folder the cache may use: served, not cached
    const file = join(folder, entry.name);
    await writeAtomically(file, entry.body);
    if (entry.inputs !== undefined) {
      await writeAtomically(recordOf(file), recordText(entry.inputs));
    }
    await writeAtomically(importsOf(file), entry.imports);
    await writeAtomically(join(folder, "meta.json"), entry.meta);
  } catch (error) {
    // Noted, not thrown: the bundle in hand is good, only the next request pays the build again.
    where.log.warn(
      { err: error, dir: entry.dir },
      "a bundle could not be cached; it is built again next time",
    );
  }
}
