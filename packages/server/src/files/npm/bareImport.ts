// Where a bare import points: Node's resolution of the
// package from the importing file's real folder gives its folder, and the page's own import of the name, from the
// workspace, gives `/npm/<name>` when it finds that same folder, else the folder's recorded resolved form
// `/npm/_/<key>/<name>`. One folder has one URL, whichever package or workspace module imports it. `name/` is the
// package `name`, and a legacy name with capitals a name (spec.ts).
import type { PackageIndex } from "./packageIndex.js";
import { keyOf } from "./indexTrust.js";
import type { Lookups } from "./resolve.js";
import { findPackage } from "./resolve.js";
import { packageSpecOf } from "./spec.js";

/** What resolves a bare import: the workspace the page's own imports look from, and the index of resolved forms. */
export type Resolver = {
  readonly root: string;
  readonly index: PackageIndex;
  /** How esbuild resolved each package's entries, by package and import kind, kept across builds. */
  readonly entries: Map<string, Promise<ReadonlyMap<string, string>>>;
};

/**
 * The URL of the package folder Node resolves `spec` to from the real folder `from`; undefined when it finds none.
 * Checking a cached bundle (`check`), the resolved form's key is computed, not recorded, and the folders looked at are
 * shared with the check's other imports.
 */
export async function bareUrlOf(
  resolver: Resolver,
  spec: string,
  from: string,
  check?: Lookups,
): Promise<string | undefined> {
  const named = packageSpecOf(spec);
  const found = named && (await findPackage(named.name, from, check));
  if (named === undefined || found === undefined) return undefined;
  const tail = named.subpath === "" ? "" : `/${named.subpath}`;
  const pages = await findPackage(named.name, resolver.root, check);
  if (pages?.folder === found.folder) return `/npm/${named.name}${tail}`; // the page's own import: shared with it
  const key =
    check === undefined ? await resolver.index.record(named.name, found, from) : keyOf(found);
  return `/npm/_/${key}/${named.name}${tail}`;
}
