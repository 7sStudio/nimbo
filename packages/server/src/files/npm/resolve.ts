// Where /npm/ finds a package, as Node does (04-kernel §8.1): `<dir>/node_modules/<name>` for a folder
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

/**
 * The package `name` as Node finds it from the folder `from`: the first `node_modules/<name>` folder on the way up.
 * Undefined when none is there, or when that folder holds no readable version (a broken install, which Node stops at
 * too).
 */
export async function findPackage(name: string, from: string): Promise<FoundPackage | undefined> {
  for (const lookup of lookupsFrom(from)) {
    const candidate = join(lookup, "node_modules", ...name.split("/"));
    if (!(await isFolder(candidate))) continue;
    const version = await versionAt(candidate);
    if (version === undefined) return undefined;
    return { folder: await realpath(candidate), lookup, version };
  }
  return undefined;
}
