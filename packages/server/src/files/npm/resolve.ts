// Where /npm/ finds a package, as Node does: `<dir>/node_modules/<name>` for a folder
// and each of its parents in turn (a folder itself named node_modules is skipped, as Node skips it), links followed to
// the package's real folder; no NODE_PATH and no global folder. The page's own import of a name looks from the
// workspace; a bundle's bare import looks from the real folder of the file that imports it, so pnpm's
// `.pnpm/<pkg>@<v>/node_modules/<dep>` and a monorepo's parent node_modules are found as a server cell finds them.
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { versionAt } from "../packages/manifest.js";

export type FoundPackage = {
  /** The package's real folder. */
  readonly folder: string;
  /** The folder whose node_modules held it: a bare import of its name from there resolves to it. */
  readonly lookup: string;
  readonly version: string;
};

/** The folders whose node_modules Node looks in from `from`, nearest first. */
function lookupsFrom(from: string): string[] {
  const lookups: string[] = [];
  let dir = from;
  while (dirname(dir) !== dir) {
    if (basename(dir) !== "node_modules") lookups.push(dir);
    dir = dirname(dir);
  }
  lookups.push(dir); // the root of the file system
  return lookups;
}

const isFolder = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isDirectory(),
    () => false, // nothing there, or nothing that leads anywhere: not here
  );

/** What one candidate folder holds: nothing, a package (its real folder and version), or a broken install. */
type Probe =
  | { readonly kind: "none" }
  | { readonly kind: "broken" }
  | { readonly kind: "found"; readonly folder: string; readonly version: string };

/**
 * The probes of one pass over many imports (a cached bundle's check), shared: their parent folders are the same, and a
 * folder with no node_modules is passed over without a probe of each name.
 */
export type Lookups = {
  readonly probes: Map<string, Promise<Probe>>;
  readonly modules: Map<string, Promise<boolean>>;
};

/** A pass with nothing looked at yet. */
export const createLookups = (): Lookups => ({ probes: new Map(), modules: new Map() });

/** Whether `lookup` holds a node_modules folder, asked once per pass. */
const holdsModules = (lookup: string, lookups: Lookups): Promise<boolean> => {
  const key = join(lookup, "node_modules");
  const held = lookups.modules.get(key) ?? isFolder(key);
  lookups.modules.set(key, held);
  return held;
};

async function probe(candidate: string): Promise<Probe> {
  if (!(await isFolder(candidate))) return { kind: "none" };
  const version = await versionAt(candidate);
  if (version === undefined) return { kind: "broken" };
  return { kind: "found", folder: await realpath(candidate), version };
}

/**
 * The package `name` as Node finds it from the folder `from`: the first `node_modules/<name>` folder on the way up.
 * Undefined when none is there, or when that folder holds no readable version (a broken install, which Node stops at
 * too). `lookups` shares what the folders held with the other calls of one pass.
 */
export async function findPackage(
  name: string,
  from: string,
  lookups?: Lookups,
): Promise<FoundPackage | undefined> {
  for (const lookup of lookupsFrom(from)) {
    if (lookups !== undefined && !(await holdsModules(lookup, lookups))) continue;
    const candidate = join(lookup, "node_modules", ...name.split("/"));
    const held = lookups?.probes.get(candidate) ?? probe(candidate);
    lookups?.probes.set(candidate, held);
    const found = await held;
    if (found.kind === "none") continue;
    return found.kind === "found"
      ? { folder: found.folder, lookup, version: found.version }
      : undefined;
  }
  return undefined;
}
