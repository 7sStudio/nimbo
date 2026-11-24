// What /npm/<spec> answers (04-kernel §8.1): a package, found as Node finds it from the workspace, bundled once per
// version of it and of esbuild, cached under `.jsnb/cache/npm/<name>@<version>/` (`index.js` or the subpath's file,
// and `meta.json`), the concurrent first requests sharing one build; the resolved form `/npm/_/<key>/<name>` of a
// package folder a bundle imports, served only for a key the index recorded (packageIndex.ts) and cached
// under `_/<key>/`; a workspace module transformed per request. The path rule (spec.ts) refuses with a
// bare 404: a path that names nothing or breaks it, an unrecorded key, and a workspace module whose real path or one
// of whose imports breaks it (outside the workspace, a hidden segment, not module source), or with no regular file.
// A package that is not installed is MissingPackage (404), a build that fails or runs past the timeout NpmModuleFailed
// (500), each naming the spec, so the page shows it as the import's failure. A build runs under the timeout and stops
// once every request waiting for it went away (esbuild cancels it).
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { JsnbError, MissingPackage } from "@jsnb/core";

import type { Resolver } from "./bareImport.js";
import type { Built } from "./bundle.js";
import { transformFile } from "./bundle.js";
import type { CachedSpec, NoteLog } from "./cache.js";
import { cachedBundle } from "./cache.js";
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
  resolver: Resolver,
  below: string,
  signal: AbortSignal,
): Promise<NpmModule> {
  const { root } = resolver;
  const real = await realpath(resolve(root, below)).catch(() => undefined); // nothing there: refused
  if (real === undefined || !isWorkspaceModule(root, real) || !(await isRegular(real))) {
    return refused(404);
  }
  try {
    return answerOf(await transformFile(resolver, real, signal));
  } catch (error) {
    const spec = `./${below}`;
    return failed(500, new NpmModuleFailed({ spec, reason: messageOf(error) }, { cause: error }));
  }
}

type Package = Extract<NpmSpec, { kind: "package" | "resolved" }>;

export type NpmOptions = {
  /** How long one build may run; past it the build is cancelled and its requests fail. */
  readonly timeoutMs: number;
  readonly log: NoteLog;
};

/** A build the concurrent first requests of one bundle share; cancelled once none of them waits for it. */
type SharedBuild = {
  readonly body: Promise<Built>;
  readonly cancel: AbortController;
  waiting: number;
};

/** Waits for `build` while `signal` holds; the last request to leave cancels the build. */
async function waitFor(build: SharedBuild, signal: AbortSignal, log: NoteLog): Promise<Built> {
  build.waiting += 1;
  const leave = (): void => {
    build.waiting -= 1;
    if (build.waiting > 0) return;
    log.info({}, "a bundle was cancelled: every request for it went away");
    build.cancel.abort(new Error("every request for the bundle went away"));
  };
  if (signal.aborted) {
    leave(); // gone before it could wait: its listener would never fire
    signal.throwIfAborted();
  }
  signal.addEventListener("abort", leave, { once: true });
  try {
    return await build.body;
  } finally {
    signal.removeEventListener("abort", leave);
  }
}

/** The build of `spec` the requests share: the one under way, else a new one that `run` makes under its signal. */
function sharedBuild(
  building: Map<string, SharedBuild>,
  spec: CachedSpec,
  run: (signal: AbortSignal) => Promise<Built>,
): SharedBuild {
  const key = `${spec.dir}/${spec.subpath}`;
  const existing = building.get(key);
  if (existing && !existing.cancel.signal.aborted) return existing; // a cancelled one is not joined
  const cancel = new AbortController();
  const build: SharedBuild = { body: run(cancel.signal), cancel, waiting: 0 };
  building.set(key, build);
  const done = (): void => {
    if (building.get(key) === build) building.delete(key);
  };
  void build.body.then(done, done); // each waiting request gets the failure; the next one builds again
  return build;
}

/**
 * The bundle a package spec asks for: the page's own import of a name is the folder Node finds from the workspace
 * (MissingPackage when none), a resolved form the folder its recorded key names (a bare 404 when unrecorded).
 */
async function cachedSpecOf(resolver: Resolver, spec: Package): Promise<CachedSpec | NpmModule> {
  const { name, subpath } = spec;
  if (spec.kind === "package") {
    const found = await findPackage(name, resolver.root);
    if (found === undefined) return failed(404, new MissingPackage({ names: [name] }));
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
  const resolver: Resolver = { root, index: createPackageIndex(where.cacheDir, root, options.log) };
  const building = new Map<string, SharedBuild>();
  const cleared = new Map<string, Promise<void>>();
  const shared = (spec: CachedSpec): SharedBuild =>
    sharedBuild(building, spec, (signal) =>
      cachedBundle(
        { cacheDir: where.cacheDir, log: options.log, resolver, cleared },
        spec,
        AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      ),
    );
  const packageModule = async (spec: Package, signal: AbortSignal): Promise<NpmModule> => {
    const cached = await cachedSpecOf(resolver, spec);
    if (!("found" in cached)) return cached;
    try {
      return answerOf(await waitFor(shared(cached), signal, options.log));
    } catch (error) {
      const name = spec.subpath === "" ? spec.name : `${spec.name}/${spec.subpath}`;
      return failed(
        500,
        new NpmModuleFailed({ spec: name, reason: messageOf(error) }, { cause: error }),
      );
    }
  };
  return async (rest, signal) => {
    const spec = parseNpmSpec(rest);
    if (spec === undefined) return refused(404);
    const timed = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
    return spec.kind === "relative"
      ? workspaceFile(resolver, spec.path, timed)
      : packageModule(spec, signal);
  };
}
