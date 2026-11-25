// The split builds of a daemon's /npm/ (04-kernel §8.1, packageGroup.ts): an entry of a package's split bundle and
// a chunk of it, from the cache (groupCache.ts) or a build through the queue; each package's entries read once per
// state of its package.json (a page's import of date-fns asks for its 260 modules at once). A split build whose
// failure no entry explains alone is remembered, so the package's entries are built one by one, each a single bundle
// (a linked package's until one of its files changes). The last few split builds stay in memory, so a chunk is built
// once even when the cache cannot hold it.
import { join } from "node:path";

import type { BuildQueue } from "./buildQueue.js";
import { BuildTimedOut } from "./buildQueue.js";
import type { CachedSpec, Where } from "./cache.js";
import type { Held } from "./groupCache.js";
import { cacheGroup, cacheUnsplit, heldChunk, heldEntry, heldUnsplit } from "./groupCache.js";
import { createFailures, createRecent, timedOutMs } from "./groupMemory.js";
import { importsHold } from "./importsRecord.js";
import { identitiesHold, identityOf } from "./inputs.js";
import type { Group } from "./packageGroup.js";
import { bundleGroupAround } from "./groupSearch.js";
import { groupSubpaths } from "./packageGroup.js";
import { isLinkedPackage } from "./spec.js";

/** A split build that could not be made: the package's entries are then built one by one. */
type GroupRun =
  | (Extract<Group, { ok: true }> & { readonly cached: boolean })
  | { readonly ok: false }
  | { readonly failed: string; readonly timedOut: boolean };

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
  context: { readonly signal: AbortSignal; readonly searchMs: number },
): Promise<GroupRun> {
  const { signal } = context;
  const pkg = { name: spec.name, base: spec.base, found: spec.found, subpaths };
  const fields = { spec: spec.name, version: spec.found.version, entries: subpaths.length };
  where.log.info(fields, "bundling a package's entries together for the page");
  const budget = { deadline: Date.now() + context.searchMs, trials: maxTrials };
  try {
    const group = await bundleGroupAround(pkg, where.resolver, { signal, budget });
    if (!group.ok) {
      return { failed: "a file it reads is not one a page may load", timedOut: false };
    }
    if (group.left.length > 0) {
      where.log.warn(
        { ...fields, left: group.left },
        "a package's entries that fail are built alone",
      );
    }
    const cached = await cacheGroup(where, spec, group);
    return { ...group, cached };
  } catch (error) {
    // Every request went away: nothing learned. Past the build's limit: the package does not split, as below.
    if (signal.aborted && !(signal.reason instanceof BuildTimedOut)) throw error;
    // Past the build's limit with no error of esbuild's: a slow machine's verdict, not the package's, kept briefly.
    return { failed: messageOf(signal.aborted ? signal.reason : error), timedOut: signal.aborted };
  }
}

/** The trial builds the search for failing entries may make. */
const maxTrials = 40;

/** What a cache lookup holds: its text (none: undefined), or `absent` (build it) as the symbol below. */
const absent = Symbol("absent");

const textOf = (held: Held): string | undefined | typeof absent =>
  held.kind === "absent" ? absent : held.kind === "text" ? held.text : undefined;

/** The split builds kept in memory: a few large packages. */
const recentBytes = 64 * 1024 * 1024;

type Made = Extract<Group, { ok: true }> & { readonly cached: boolean };

const bytesOf = (made: Made): number =>
  [...made.entries.values(), ...made.chunks.values()].reduce(
    (sum, text) => sum + text.length * 2,
    0,
  );

/** Whether a split build kept in memory still holds: its imports resolve as they did, a linked package's files too. */
async function holds(where: Where, spec: CachedSpec, made: Made): Promise<boolean> {
  if (isLinkedPackage(spec.found.folder) && !(await identitiesHold(made.inputs ?? [])))
    return false;
  return importsHold(where.resolver, made.imports);
}

/** The split builds over the cache `where`, each through `queue`; `reset` forgets what they learned. */
export function createGroups(where: Where, queue: BuildQueue<GroupRun>, searchMs: number) {
  const failures = createFailures();
  const recent = createRecent(recentBytes, bytesOf);
  let subpathsOf = subpathsMemo();
  /** Whether `spec`'s package is built entry by entry: found out by this daemon, or marked in the cache by an earlier one. */
  const failed = async (spec: CachedSpec): Promise<boolean> => {
    if ((await failures.get(spec.dir, spec)) !== undefined) return true;
    const marked = await heldUnsplit(where, spec);
    if (marked !== undefined) await failures.add(spec.dir, spec, new Error(marked));
    return marked !== undefined;
  };
  const subpaths = async (spec: CachedSpec): Promise<readonly string[]> =>
    (await failed(spec)) ? [] : subpathsOf(spec.found.folder);
  /** A split build kept in memory, for a cache that could not hold it, while it holds. */
  const kept = async (spec: CachedSpec): Promise<Made | undefined> => {
    const made = recent.get(spec.dir);
    return made !== undefined && !made.cached && (await holds(where, spec, made))
      ? made
      : undefined;
  };
  /** The split build through `queue`: a failure remembered for the package, a success kept among the recent ones. */
  const built = async (spec: CachedSpec, entries: readonly string[], signal: AbortSignal) => {
    const build = (inner: AbortSignal) =>
      buildGroup(where, spec, entries, { signal: inner, searchMs });
    const made = await queue(`group:${spec.dir}`, build, signal);
    if ("failed" in made) {
      if ((await failures.get(spec.dir, spec)) === undefined) {
        where.log.warn(
          { dir: spec.dir, reason: made.failed },
          "a package's entries are built one by one",
        );
        const error = new Error(made.failed);
        await failures.add(spec.dir, spec, error, made.timedOut ? timedOutMs : Infinity);
        if (!made.timedOut) await cacheUnsplit(where, spec, made.failed);
      }
      return undefined;
    }
    if (!made.ok) return undefined;
    recent.set(spec.dir, made);
    return made;
  };
  return {
    /** The entry `spec` of its package's split build; undefined when it is no entry of one (it is built alone). */
    entry: async (spec: CachedSpec, signal: AbortSignal): Promise<string | undefined> => {
      const entries = await subpaths(spec);
      const subpath = spec.subpath === "" ? "" : `/${spec.subpath}`;
      if (!entries.includes(subpath)) return undefined;
      const held = textOf(await heldEntry(where, spec));
      if (held !== absent) return held;
      const made = (await kept(spec)) ?? (await built(spec, entries, signal));
      return made?.entries.get(subpath);
    },
    /** The chunk `hash` of `spec`'s split build; undefined when no build of it holds one. */
    chunk: async (spec: CachedSpec, hash: string, signal: AbortSignal) => {
      const held = textOf(await heldChunk(where, spec, hash));
      if (held !== absent) return held;
      const text = recent.get(spec.dir)?.chunks.get(hash); // a chunk's name is its content's hash
      if (text !== undefined) return text;
      const entries = await subpaths(spec);
      if (entries.length === 0) return undefined;
      return (await built(spec, entries, signal))?.chunks.get(hash);
    },
    /**
     * The subpaths a standalone bundle of `spec`'s package imports by URL: the split build's, or every exported one
     * when the package is built entry by entry, so its entries still share their state.
     */
    siblings: async (spec: CachedSpec): Promise<readonly string[]> =>
      (await failed(spec)) ? subpathsOf(spec.found.folder) : subpaths(spec),
    reset: (): void => {
      failures.clear();
      recent.clear();
      subpathsOf = subpathsMemo();
    },
  };
}
