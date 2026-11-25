// The split builds of a daemon's /npm/ (04-kernel §8.1, packageGroup.ts): an entry of a package's split bundle and
// a chunk of it, from the cache (groupCache.ts) or a build through the queue; each package's entries read once per
// state of its package.json (a page's import of date-fns asks for its 260 modules at once). A split build whose
// failure no entry explains alone is remembered, so the package's entries are built one by one, each a single bundle
// (a linked package's until one of its files changes). The last few split builds stay in memory, so a chunk is built
// once even when the cache cannot hold it.
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { BuildQueue } from "./buildQueue.js";
import type { CachedSpec, Where } from "./cache.js";
import type { Held } from "./groupCache.js";
import { cacheGroup, heldChunk, heldEntry } from "./groupCache.js";
import { identityOf } from "./inputs.js";
import type { Group } from "./packageGroup.js";
import { bundleGroupAround, groupSubpaths } from "./packageGroup.js";
import { isLinkedPackage } from "./spec.js";

/** A split build that could not be made: the package's entries are then built one by one. */
type GroupRun = Group | { readonly failed: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The subpaths of each package's split build, read again once its package.json changed. */
function subpathsMemo() {
  const known = new Map<
    string,
    { readonly stamp: string; readonly subpaths: Promise<readonly string[]> }
  >();
  return async (folder: string): Promise<readonly string[]> => {
    const identity = await identityOf(join(folder, "package.json"));
    const stamp = `${String(identity?.size)}:${String(identity?.mtimeMs)}`;
    const held = known.get(folder);
    if (held?.stamp === stamp) return held.subpaths;
    const subpaths = groupSubpaths(folder);
    known.set(folder, { stamp, subpaths });
    return subpaths;
  };
}

/** The split build of `spec`'s package, cached; a failure that is no cancellation is its result. */
async function buildGroup(
  where: Where,
  spec: CachedSpec,
  subpaths: readonly string[],
  signal: AbortSignal,
) {
  const pkg = { name: spec.name, base: spec.base, found: spec.found, subpaths };
  const fields = { spec: spec.name, version: spec.found.version, entries: subpaths.length };
  where.log.info(fields, "bundling a package's entries together for the page");
  try {
    const group = await bundleGroupAround(pkg, where.resolver, signal);
    if (!group.ok) return { failed: "a file it reads is not one a page may load" };
    if (group.left.length > 0) {
      where.log.warn(
        { ...fields, left: group.left },
        "a package's entries that fail are built alone",
      );
    }
    await cacheGroup(where, spec, group);
    return group;
  } catch (error) {
    if (signal.aborted) throw error; // cancelled or past its limit: the request's failure
    return { failed: messageOf(error) };
  }
}

/** What a cache lookup holds: its text (none: undefined), or `absent` (build it) as the symbol below. */
const absent = Symbol("absent");

const textOf = (held: Held): string | undefined | typeof absent =>
  held.kind === "absent" ? absent : held.kind === "text" ? held.text : undefined;

/** The files a linked package's stamp covers: far more than one holds. */
const maxStampFiles = 20_000;

/** A stamp of the linked package in `folder`: its files' paths, sizes and times, its node_modules and hidden ones aside. */
async function folderStamp(folder: string): Promise<string> {
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

/** The stamp a failure is kept under: a registry package's version is in its folder's name, a linked one is edited. */
const stampOf = (spec: CachedSpec): Promise<string> =>
  isLinkedPackage(spec.found.folder) ? folderStamp(spec.found.folder) : Promise.resolve("");

/** The split builds of packages that failed, each until its package changed. */
function failuresOf(where: Where) {
  const failures = new Map<string, string>();
  return {
    has: async (spec: CachedSpec): Promise<boolean> => {
      const stamp = failures.get(spec.dir);
      if (stamp === undefined) return false;
      if (stamp === (await stampOf(spec))) return true;
      failures.delete(spec.dir); // a linked package edited since: tried again
      return false;
    },
    add: async (spec: CachedSpec, reason: string): Promise<void> => {
      where.log.warn({ dir: spec.dir, reason }, "a package's entries are built one by one");
      failures.set(spec.dir, await stampOf(spec));
    },
    clear: () => {
      failures.clear();
    },
  };
}

/** The last split builds of this daemon, served when the cache cannot hold them: a few packages. */
const recentGroups = 8;

type Built = Extract<Group, { ok: true }>;

/** The split builds through `queue`: a failure noted, a success kept among the recent ones. */
function builder(
  where: Where,
  queue: BuildQueue<GroupRun>,
  memory: { readonly failures: ReturnType<typeof failuresOf>; readonly recent: Map<string, Built> },
) {
  return async (spec: CachedSpec, entries: readonly string[], signal: AbortSignal) => {
    const build = (inner: AbortSignal) => buildGroup(where, spec, entries, inner);
    const made = await queue(`group:${spec.dir}`, build, signal);
    if ("failed" in made) {
      if (!(await memory.failures.has(spec))) await memory.failures.add(spec, made.failed);
      return undefined;
    }
    if (!made.ok) return undefined;
    const { recent } = memory;
    recent.delete(spec.dir);
    recent.set(spec.dir, made);
    const [oldest] = recent.keys();
    if (recent.size > recentGroups && oldest !== undefined) recent.delete(oldest);
    return made;
  };
}

/** The split builds over the cache `where`, each through `queue`; `reset` forgets what they learned. */
export function createGroups(where: Where, queue: BuildQueue<GroupRun>) {
  const failures = failuresOf(where);
  let subpathsOf = subpathsMemo();
  const recent = new Map<string, Built>();
  const subpaths = async (spec: CachedSpec): Promise<readonly string[]> =>
    (await failures.has(spec)) ? [] : subpathsOf(spec.found.folder);
  const built = builder(where, queue, { failures, recent });
  return {
    /** The entry `spec` of its package's split build; undefined when it is no entry of one (it is built alone). */
    entry: async (spec: CachedSpec, signal: AbortSignal): Promise<string | undefined> => {
      const entries = await subpaths(spec);
      const subpath = spec.subpath === "" ? "" : `/${spec.subpath}`;
      if (!entries.includes(subpath)) return undefined;
      const held = textOf(await heldEntry(where, spec));
      if (held !== absent) return held;
      return (await built(spec, entries, signal))?.entries.get(subpath);
    },
    /** The chunk `hash` of `spec`'s split build; undefined when no build of it holds one. */
    chunk: async (spec: CachedSpec, hash: string, signal: AbortSignal) => {
      const held = textOf(await heldChunk(where, spec, hash));
      if (held !== absent) return held;
      const kept = recent.get(spec.dir)?.chunks.get(hash); // a chunk's name is its content's hash
      if (kept !== undefined) return kept;
      const entries = await subpaths(spec);
      if (entries.length === 0) return undefined;
      return (await built(spec, entries, signal))?.chunks.get(hash);
    },
    /** The subpaths a standalone bundle of `spec`'s package may import as entries: its main alone once it failed. */
    siblings: async (spec: CachedSpec): Promise<readonly string[]> => {
      const entries = await subpaths(spec);
      return entries.length === 0 ? [""] : entries;
    },
    reset: (): void => {
      failures.clear();
      subpathsOf = subpathsMemo();
      recent.clear();
    },
  };
}
