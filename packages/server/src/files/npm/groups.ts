// The split builds of a daemon's /npm/ (04-kernel §8.1, packageGroup.ts): an entry of a package's split bundle and
// a chunk of it, from the cache (groupCache.ts) or a build through the queue; each package's entries read once per
// state of its package.json (a page's import of date-fns asks for its 260 modules at once); a split build that fails
// remembered, so the package's entries are built one by one (a linked package's is tried again each time: it is being
// edited).
import { join } from "node:path";

import type { BuildQueue } from "./buildQueue.js";
import type { CachedSpec, Where } from "./cache.js";
import type { Held } from "./groupCache.js";
import { cacheGroup, heldChunk, heldEntry } from "./groupCache.js";
import { identityOf } from "./inputs.js";
import type { Group } from "./packageGroup.js";
import { bundleGroup, groupSubpaths } from "./packageGroup.js";
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
    const group = await bundleGroup(pkg, where.resolver, signal);
    if (group.ok) await cacheGroup(where, spec, group);
    return group.ok ? group : { failed: "a file it reads is not one a page may load" };
  } catch (error) {
    if (signal.aborted) throw error; // cancelled or past its limit: the request's failure
    return { failed: messageOf(error) };
  }
}

/** What a cache lookup holds: its text (none: undefined), or `absent` (build it) as the symbol below. */
const absent = Symbol("absent");

const textOf = (held: Held): string | undefined | typeof absent =>
  held.kind === "absent" ? absent : held.kind === "text" ? held.text : undefined;

/** The split builds of packages through `queue`; one that fails noted, and kept unless its package is a linked one. */
function builder(where: Where, queue: BuildQueue<GroupRun>, failures: Map<string, string>) {
  return async (spec: CachedSpec, entries: readonly string[], signal: AbortSignal) => {
    const build = (inner: AbortSignal) => buildGroup(where, spec, entries, inner);
    const made = await queue(`group:${spec.dir}`, build, signal);
    if (!("failed" in made)) return made.ok ? made : undefined;
    if (!failures.has(spec.dir)) {
      const fields = { dir: spec.dir, reason: made.failed };
      where.log.warn(fields, "a package's entries are built one by one");
      if (!isLinkedPackage(spec.found.folder)) failures.set(spec.dir, made.failed);
    }
    return undefined;
  };
}

/** The split builds over the cache `where`, each through `queue`. */
export function createGroups(where: Where, queue: BuildQueue<GroupRun>) {
  const failures = new Map<string, string>();
  const subpathsOf = subpathsMemo();
  const subpaths = (spec: CachedSpec): Promise<readonly string[]> =>
    failures.has(spec.dir) ? Promise.resolve([]) : subpathsOf(spec.found.folder);
  const built = builder(where, queue, failures);
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
      const entries = await subpaths(spec);
      if (entries.length === 0) return undefined;
      return (await built(spec, entries, signal))?.chunks.get(hash);
    },
  };
}
