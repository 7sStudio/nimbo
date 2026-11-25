// The search for the entries a package's split build cannot take (04-kernel §8.1): when the build fails, the entries
// whose own file esbuild's errors name are left out first; when the rest still fails, the entries that fail on their
// own are found by halves. The search has a budget of its own (time and trial builds): past it, or past the build's
// limit, the package gives up splitting, which the caller remembers for the package's version.
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { Resolver } from "./bareImport.js";
import type { Group, GroupPackage } from "./packageGroup.js";
import { bundleGroup, entryFiles } from "./packageGroup.js";

/** More entries than this failing on their own: the package is built entry by entry. */
const maxLeft = 64;

/** What the search may spend: until `deadline` (ms since the epoch), and `trials` more builds. */
export type Budget = { readonly deadline: number; trials: number };

/** The package could not be split within the search's budget. */
export class SplitGaveUp extends Error {
  constructor(reason: string) {
    super(`its entries could not be bundled together: ${reason}`);
    this.name = "SplitGaveUp";
  }
}

type Search = {
  readonly resolver: Resolver;
  readonly signal: AbortSignal;
  readonly budget: Budget;
};

/** The split build of `pkg` alone, or why it cannot be made (a rule's refusal among them). */
async function attempt(pkg: GroupPackage, search: Search): Promise<Group | Error> {
  if (search.budget.trials <= 0 || Date.now() > search.budget.deadline) {
    throw new SplitGaveUp("the search for the entries that fail ran out of its budget");
  }
  search.budget.trials -= 1;
  try {
    const group = await bundleGroup(pkg, search.resolver, search.signal);
    return group.ok ? group : new Error("a file it reads is not one a page may load");
  } catch (error) {
    search.signal.throwIfAborted(); // cancelled or past the build's limit: the caller decides
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** The entries whose own file one of `failure`'s errors is in. */
async function named(pkg: GroupPackage, failure: Error): Promise<string[]> {
  const errors: unknown = Reflect.get(failure, "errors");
  if (!Array.isArray(errors)) return [];
  const located = errors.map((error: unknown) => {
    const file: unknown = Reflect.get(Object(Reflect.get(Object(error), "location")), "file");
    const path = typeof file === "string" ? resolve(pkg.found.lookup, file) : "";
    return realpath(path).catch(() => "");
  });
  const files = new Set(await Promise.all(located));
  const targets = await entryFiles(pkg.found.folder, pkg.subpaths);
  const real = await Promise.all(
    [...targets].map(
      async ([subpath, file]) => [subpath, await realpath(file).catch(() => file)] as const,
    ),
  );
  return real.filter(([, file]) => files.has(file)).map(([subpath]) => subpath);
}

/** The entries of `pkg` (whose split build fails) that fail on their own, found by halves, added to `left`. */
async function failing(pkg: GroupPackage, search: Search, left: string[]): Promise<void> {
  const [only] = pkg.subpaths;
  if (pkg.subpaths.length === 1 && only !== undefined) {
    left.push(only);
    if (left.length > maxLeft) throw new SplitGaveUp(`more than ${String(maxLeft)} of them fail`);
    return;
  }
  const half = Math.ceil(pkg.subpaths.length / 2);
  for (const part of [pkg.subpaths.slice(0, half), pkg.subpaths.slice(half)]) {
    const tried = await attempt({ ...pkg, subpaths: part }, search);
    if (tried instanceof Error) await failing({ ...pkg, subpaths: part }, search, left);
  }
}

/**
 * The split bundle of `pkg`; when it cannot be made, the entries that fail are left out (`left`) and the rest is built
 * together. Rejects with SplitGaveUp when that cannot be done within `budget`, or when the rest still fails.
 */
export async function bundleGroupAround(
  pkg: GroupPackage,
  resolver: Resolver,
  context: { readonly signal: AbortSignal; readonly budget: Budget },
): Promise<Group> {
  const search = { resolver, ...context };
  const first = await attempt(pkg, search);
  if (!(first instanceof Error)) return first;
  const left = await named(pkg, first);
  let rest: Group | Error = first;
  if (left.length > 0) rest = await attempt({ ...pkg, subpaths: without(pkg, left) }, search);
  if (rest instanceof Error) {
    await failing({ ...pkg, subpaths: without(pkg, left) }, search, left);
    if (without(pkg, left).length === 0) throw new SplitGaveUp(first.message);
    rest = await attempt({ ...pkg, subpaths: without(pkg, left) }, search);
  }
  if (rest instanceof Error || without(pkg, left).length === 0)
    throw new SplitGaveUp(first.message);
  return rest.ok ? { ...rest, left } : rest;
}

const without = (pkg: GroupPackage, left: readonly string[]): string[] =>
  pkg.subpaths.filter((subpath) => !left.includes(subpath));
