// What /npm/<spec> answers: a package, found as Node finds it from the workspace, bundled once per
// version of it and of esbuild, cached under `.jsnb/cache/npm/<name>@<version>/`. Every entry its package.json exports
// (its main and each subpath without a pattern) comes from one split build of the package (packageGroup.ts), cached
// together (groupCache.ts), its chunks at `<base>/.chunks/<hash>.js`; any other subpath (a pattern export, a file of a
// package without `exports`), or every entry of a package whose split build fails, is a standalone bundle (cache.ts).
// The resolved form `/npm/_/<key>/<name>` of a package folder a bundle imports is served only for a key the index
// recorded (packageIndex.ts) and cached under `_/<key>/`; a workspace module is transformed per request. The path rule
// (spec.ts) refuses with a bare 404: a path that names nothing or breaks it, an unrecorded key, and a workspace module
// whose real path or one of whose imports breaks it (outside the workspace, a hidden segment, not module source), or
// with no regular file. A package that is not installed is MissingPackage (404), a build that fails or runs past its
// limit NpmModuleFailed (500), each naming the spec, so the page shows it as the import's failure. Builds go through
// one bounded queue (buildQueue.ts): the requests for a build share it, its limit runs from its start, and it stops
// once every request waiting for it went away.
import { lstat, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { JsnbError, MissingPackage } from "@jsnb/core";

import type { Resolver } from "./bareImport.js";
import type { Built } from "./bundle.js";
import { transformFile } from "./bundle.js";
import type { BuildQueue } from "./buildQueue.js";
import { BuildTimedOut, createBuildQueue, createTurns, defaultConcurrency } from "./buildQueue.js";
import type { CachedSpec, NoteLog, Where } from "./cache.js";
import { cachedBundle, heldBundle } from "./cache.js";
import { createFailures, timedOutMs } from "./groupMemory.js";
import { createGroups } from "./groups.js";
import { installedAs, subpathAsWritten } from "./spelling.js";
import { createPackageIndex } from "./packageIndex.js";
import { findPackage } from "./resolve.js";
import type { NpmSpec } from "./spec.js";
import { isWorkspaceModule, parseNpmSpec } from "./spec.js";

type Failure = { readonly spec: string; readonly reason: string };

/** A module the page asked for could not be made. */
class NpmModuleFailed extends JsnbError {
  declare readonly data: Failure;
  constructor(data: Failure, options: { readonly cause?: unknown } = {}) {
    super({
      name: "NpmModuleFailed",
      message: `The page cannot load ${data.spec}: ${data.reason}.`,
      data,
      ...options,
    });
  }
}

/** A module, a failure the page shows (`error`), or a refusal of the path rule, answered with no body. */
export type NpmModule =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly status: number; readonly error?: Error };

const failed = (status: number, error: Error): NpmModule => ({ ok: false, status, error });

const refused = (status: 404): NpmModule => ({ ok: false, status });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A module the rule allowed, or the bare 404 of its refusal. */
const answerOf = (built: Built): NpmModule =>
  built.ok ? { ok: true, body: built.text } : refused(404);

/** Whether `path` is a regular file. */
const isRegular = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isFile(),
    () => false, // gone meanwhile: no file
  );

/**
 * A workspace module (`below`: its path below the workspace, which the rule allowed), or the bare 404: its real path
 * breaks the rule (a link out of the workspace or into a hidden folder, or to a file that is no module source), no
 * regular file is there, or one of its imports breaks the rule.
 */
async function workspaceFile(
  context: { readonly resolver: Resolver; readonly builds: BuildQueue<Built> },
  below: string,
  signal: AbortSignal,
): Promise<NpmModule> {
  const { root } = context.resolver;
  const real = await realpath(resolve(root, below)).catch(() => undefined); // nothing there: refused
  if (real === undefined || !isWorkspaceModule(root, real) || !(await isRegular(real))) {
    return refused(404);
  }
  try {
    const transform = (inner: AbortSignal) => transformFile(context.resolver, real, inner);
    return answerOf(await context.builds(`file:${real}`, transform, signal));
  } catch (error) {
    const spec = `./${below}`;
    return failed(500, new NpmModuleFailed({ spec, reason: messageOf(error) }, { cause: error }));
  }
}

type Package = Extract<NpmSpec, { kind: "package" | "resolved" }>;

export type NpmOptions = {
  /** How long one build may run once it started; past it the build is cancelled and its requests fail. */
  readonly timeoutMs: number;
  /** How many builds run at once (defaultConcurrency). */
  readonly concurrency?: number;
  readonly log: NoteLog;
};

/**
 * The bundle a package spec asks for: the page's own import of a name is the folder Node finds from the workspace
 * (MissingPackage when none), a resolved form the folder its recorded key names (a bare 404 when unrecorded).
 */
async function cachedSpecOf(resolver: Resolver, spec: Package): Promise<CachedSpec | NpmModule> {
  const { name, subpath } = spec;
  if (spec.kind === "package") {
    const found = await findPackage(name, resolver.root);
    if (found === undefined) return failed(404, new MissingPackage({ names: [name] }));
    const spelled = await installedAs(found.lookup, name);
    if (spelled !== name) {
      // a file system that ignores case finds `Date-fns` too: one package, one URL, one module instance
      const reason = `the package is installed as ${spelled ?? "another name"}; import it by that name`;
      return failed(404, new NpmModuleFailed({ spec: name, reason }));
    }
    const dir = `${name}@${encodeURIComponent(found.version)}`; // one segment, whatever the version holds
    return { name, subpath, found, base: `/npm/${name}`, dir };
  }
  const entry = await resolver.index.entryOf(spec.key);
  if (entry?.name !== name) return refused(404); // recorded keys only
  return { name, subpath, found: entry, base: `/npm/_/${spec.key}/${name}`, dir: `_/${spec.key}` };
}

/** The modules of the workspace `root` (a real path), cached in `cacheDir`. */
export function createNpmModules(
  where: { readonly root: string; readonly cacheDir: string },
  options: NpmOptions,
): (rest: string, signal: AbortSignal) => Promise<NpmModule> {
  const { root } = where;
  const index = createPackageIndex(where.cacheDir, root, options.log);
  const resolver: Resolver = { root, index, entries: new Map() };
  const turns = createTurns({
    concurrency: options.concurrency ?? defaultConcurrency(),
    timeoutMs: options.timeoutMs,
  });
  const builds = createBuildQueue<Built>(turns);
  const cache: Where = { cacheDir: where.cacheDir, log: options.log, resolver, cleared: new Map() };
  const groups = createGroups(cache, createBuildQueue(turns), options.timeoutMs / 2);
  const failedAlone = createFailures(root);

  // Forgets what the daemon learned of its packages once cache.clear replaced the cache's folder (a new folder in its
  // place): failed split builds, entries read, builds kept in memory, folders checked.
  let folder: string | undefined;
  const cleared = async (): Promise<void> => {
    const stats = await lstat(cache.cacheDir).catch(() => undefined);
    const now = stats === undefined ? "" : `${String(stats.dev)}:${String(stats.ino)}`;
    if (folder !== undefined && now !== folder) {
      groups.reset();
      failedAlone.clear();
      cache.cleared.clear();
      resolver.entries.clear();
    }
    folder = now;
  };

  // A standalone bundle of a package's subpath: from the cache, else built through the queue, a subpath spelled
  // otherwise than its file refused, and a build that failed answered with its failure until the package or the install
  // changes.
  const standalone = async (spec: CachedSpec, signal: AbortSignal): Promise<Built> => {
    const held = await heldBundle(cache, spec); // a cached one is no build: it takes no turn in the queue
    if (held !== undefined) return { ok: true, text: held };
    const spelled = await subpathAsWritten(spec.found.folder, spec.subpath);
    if (spelled !== undefined) {
      throw new Error(`the package's file is spelled ${spelled}; import it by that name`);
    }
    const key = `${spec.dir}/${spec.subpath}`;
    const before = await failedAlone.get(key, spec); // a build that failed fails the same until something changed
    if (before !== undefined) throw before;
    const alone = { ...spec, siblings: await groups.siblings(spec) };
    const build = (inner: AbortSignal) => cachedBundle(cache, alone, inner);
    try {
      return await builds(`entry:${key}`, build, signal);
    } catch (error) {
      if (!signal.aborted) {
        const failure = error instanceof Error ? error : new Error(String(error));
        const forMs = failure instanceof BuildTimedOut ? timedOutMs : Infinity; // a slow moment, tried again soon
        await failedAlone.add(key, spec, failure, forMs);
      }
      throw error;
    }
  };

  // a package module: an entry of the package's split build, a chunk of it, or a standalone bundle
  const packageModule = async (spec: Package, signal: AbortSignal): Promise<NpmModule> => {
    await cleared();
    const cached = await cachedSpecOf(resolver, spec);
    if (!("found" in cached)) return cached;
    try {
      if (spec.chunk !== undefined) {
        const text = await groups.chunk(cached, spec.chunk, signal);
        return text === undefined ? refused(404) : { ok: true, body: text };
      }
      const text = await groups.entry(cached, signal);
      if (text !== undefined) return { ok: true, body: text };
      return answerOf(await standalone(cached, signal));
    } catch (error) {
      const name = spec.subpath === "" ? spec.name : `${spec.name}/${spec.subpath}`;
      const reason = messageOf(error);
      return failed(500, new NpmModuleFailed({ spec: name, reason }, { cause: error }));
    }
  };

  return async (rest, signal) => {
    const spec = parseNpmSpec(rest);
    if (spec === undefined) return refused(404);
    return spec.kind === "relative"
      ? workspaceFile({ resolver, builds }, spec.path, signal)
      : packageModule(spec, signal);
  };
}
