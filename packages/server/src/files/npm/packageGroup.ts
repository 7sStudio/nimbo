// A package's split bundle (04-kernel §8.1): one esbuild build of every entry the package exports (its main and each
// `exports` subpath without a pattern), with code splitting, as a bundler pre-bundles a dependency: the package's own
// files are inlined, and the code two entries share sits in a chunk both import, so each module of the package runs
// once on the page whichever entries a cell imports (rxjs and rxjs/operators share one Observable). An entry is served
// as `<base>[/<sub>]`, a chunk as `<base>/.chunks/<hash>.js`; a dynamic import of another entry is rewritten to that
// entry's URL. Bare imports, the browser and imports maps and the path rule are those of packagePlugin.ts and
// packageBundle.ts; a bare import of the package itself that lands on one of its entries is bundled with them. A
// CommonJS entry gets its mark and named exports, and each output the split prelude of requires.ts. An `exports` entry whose target under the page's conditions is no module
// source file of the package (types or styles only, a file not there) is left out: it is built on its own when asked
// for, as a pattern subpath is.
import { realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import type { Metafile } from "esbuild";
import { z } from "zod";

import { readRegularFile } from "../regularFile.js";

import type { Resolver } from "./bareImport.js";
import { buildUnder, refusal } from "./bundle.js";
import { commonJsNames, withNamedExports } from "./commonJsExports.js";
import type { Identity } from "./inputs.js";
import { parsedJson } from "./inputs.js";
import { checkedInputs, entryOf } from "./packageBundle.js";
import { targetOf } from "./packageFields.js";
import type { BareImport, Seen } from "./packagePlugin.js";
import { packagePlugin } from "./packagePlugin.js";
import { resolveExtensions } from "./relativeImport.js";
import type { Required } from "./requires.js";
import { commonJsMark, splitPrelude } from "./requires.js";
import type { FoundPackage } from "./resolve.js";
import { isLinkedPackage } from "./spec.js";

/** The entries a split build may hold: more is a package no page imports whole, its entries then built one by one. */
const maxEntries = 4000;

const Exports = z.looseObject({
  exports: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

/** The conditions of the page's import, as esbuild applies them to an entry. */
const conditions = ["browser", "import", "module", "default"];

/** Whether `target` (an `exports` target) is a module source file of the package in `folder`. */
const isModuleFile = async (folder: string, target: string | undefined): Promise<boolean> =>
  target !== undefined &&
  target.startsWith("./") &&
  /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(target) &&
  (await stat(join(folder, target)).then(
    (stats) => stats.isFile(),
    () => false, // not there: no entry of the build
  ));

/**
 * The subpaths (`""`, `/sub`) a package's split bundle holds, from its package.json read as a regular file: its main
 * alone without a subpath map in `exports`, else each key without a pattern whose target is module source; empty past
 * `maxEntries`.
 */
export async function groupSubpaths(folder: string): Promise<readonly string[]> {
  const read = await readRegularFile(join(folder, "package.json"), 1024 * 1024);
  const map =
    read.kind === "read" ? Exports.safeParse(parsedJson(read.text)).data?.exports : undefined;
  if (map === undefined || !Object.keys(map).some((key) => key.startsWith("."))) return [""]; // its main alone
  const keys = Object.keys(map).filter(
    (key) => key === "." || (key.startsWith("./") && !key.includes("*")),
  );
  if (keys.length > maxEntries) return [];
  const kept = await Promise.all(
    keys.map(async (key) =>
      (await isModuleFile(folder, targetOf(map[key], conditions))) ? [key.slice(1)] : [],
    ),
  );
  return kept.flat();
}

/** A package's split bundle: each entry's module by subpath, each chunk by hash, what it read and imported. */
export type Group =
  | {
      readonly ok: true;
      readonly entries: ReadonlyMap<string, string>;
      readonly chunks: ReadonlyMap<string, string>;
      readonly inputs: readonly Identity[] | undefined;
      readonly imports: readonly BareImport[];
      /** The exported subpaths left out of the build: each fails on its own, and is built alone when asked for. */
      readonly left: readonly string[];
    }
  | { readonly ok: false };

export type GroupPackage = {
  readonly name: string;
  readonly base: string;
  readonly found: FoundPackage;
  readonly subpaths: readonly string[];
};

/** Where esbuild would write the outputs (it writes nothing): a folder name no package holds. */
const outName = ".nimbo-out";

/** An output's place among the build's: an entry by its index, or a chunk by its hash. */
const placeOf = (outdir: string, path: string) => {
  const below = relative(outdir, path).split(sep).join("/");
  const entry = /^\.entries\/(\d+)\.js$/.exec(below)?.[1];
  const chunk = /^\.chunks\/([A-Z0-9]{8})\.js$/.exec(below)?.[1];
  return { entry: entry === undefined ? undefined : Number(entry), chunk };
};

/** `text` with every dynamic import of another entry's output pointed at that entry's URL. */
const withEntryUrls = (text: string, pkg: GroupPackage): string =>
  text.replaceAll(
    new RegExp(
      `"${pkg.base.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.entries/(\\d+)\\.js"`,
      "g",
    ),
    (whole, at: string) => {
      const subpath = pkg.subpaths[Number(at)];
      return subpath === undefined ? whole : JSON.stringify(`${pkg.base}${subpath}`);
    },
  );

/** The CommonJS mark and named exports of an entry built from a CommonJS file; else the text as it is. */
async function asEntry(
  text: string,
  entryPoint: string | undefined,
  made: { lookup: string; metafile: Metafile },
) {
  if (entryPoint === undefined || made.metafile.inputs[entryPoint]?.format !== "cjs") return text;
  const names = await commonJsNames(await realpath(resolve(made.lookup, entryPoint)));
  return `${commonJsMark}${withNamedExports(text, names)}`;
}

/** What shapes the outputs of one split build. */
type Context = {
  readonly pkg: GroupPackage;
  readonly requires: readonly Required[];
  readonly lookup: string;
  readonly metafile: Metafile;
};

/** An output's text: entry URLs, the CommonJS form of a CommonJS entry, and the prelude where `__require` is defined. */
async function outputText(
  text: string,
  output: { readonly entryPoint: string | undefined; readonly isEntry: boolean },
  context: Context,
): Promise<string> {
  const pointed = withEntryUrls(text, context.pkg);
  const shaped = output.isEntry ? await asEntry(pointed, output.entryPoint, context) : pointed;
  return `${splitPrelude(context.requires, context.pkg, shaped)}${shaped}`;
}

/** The split bundle of `pkg`; rejects when it would hold a file outside the package, refused when the rule keeps one. */
export async function bundleGroup(
  pkg: GroupPackage,
  resolver: Resolver,
  signal: AbortSignal,
): Promise<Group> {
  const { folder, lookup } = pkg.found;
  const seen: Seen = { requires: [], imports: [], identities: new Map() };
  const bundling = { name: pkg.name, base: pkg.base, subpath: "", lookup, exports: [] };
  const specs = await Promise.all(
    pkg.subpaths.map((subpath) => entryOf(pkg.name, subpath, folder)),
  );
  const mode = { split: true, linked: isLinkedPackage(folder), signal, entries: specs };
  const outdir = join(lookup, outName);
  const options = {
    entryPoints: specs.map((spec, at) => ({ in: spec, out: `.entries/${String(at)}` })),
    absWorkingDir: lookup,
    plugins: [packagePlugin(resolver, bundling, seen, mode)],
    resolveExtensions: [...resolveExtensions],
    splitting: true,
    outdir,
    chunkNames: ".chunks/[hash]",
    publicPath: `${pkg.base}/`,
  };
  const made = await buildUnder(options, signal);
  const checked = await checkedInputs(folder, lookup, made.metafile, seen);
  if (!checked.ok) return refusal;
  const context = { pkg, requires: seen.requires, lookup, metafile: made.metafile };
  const { entries, chunks } = await sorted(made.files, outdir, context);
  return { ok: true, entries, chunks, inputs: checked.inputs, imports: seen.imports, left: [] };
}

/** More entries than this failing on their own: the package is built entry by entry. */
const maxLeft = 8;

/** The split build of `subpaths` alone, or the reason it cannot be made (a rule's refusal among them). */
async function attempt(
  pkg: GroupPackage,
  resolver: Resolver,
  signal: AbortSignal,
): Promise<Group | Error> {
  try {
    const group = await bundleGroup(pkg, resolver, signal);
    return group.ok ? group : new Error("a file it reads is not one a page may load");
  } catch (error) {
    signal.throwIfAborted(); // cancelled or past its limit: the request's failure, not the package's
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * The subpaths among `subpaths` (whose split build fails) that fail on their own, found by halves, added to `left`;
 * false once more than `maxLeft` do.
 */
async function failing(
  pkg: GroupPackage,
  context: { readonly resolver: Resolver; readonly signal: AbortSignal },
  left: string[],
): Promise<boolean> {
  const [only] = pkg.subpaths;
  if (pkg.subpaths.length === 1 && only !== undefined) {
    left.push(only);
    return left.length <= maxLeft;
  }
  const half = Math.ceil(pkg.subpaths.length / 2);
  for (const part of [pkg.subpaths.slice(0, half), pkg.subpaths.slice(half)]) {
    const tried = await attempt({ ...pkg, subpaths: part }, context.resolver, context.signal);
    if (tried instanceof Error && !(await failing({ ...pkg, subpaths: part }, context, left))) {
      return false;
    }
  }
  return true;
}

/**
 * The split bundle of `pkg`; when it cannot be made, the entries that fail on their own are found by halves and left
 * out (`left`), and the rest is built together. Rejects with the first failure when none fails on its own, when too
 * many do, or when the rest still fails together.
 */
export async function bundleGroupAround(
  pkg: GroupPackage,
  resolver: Resolver,
  signal: AbortSignal,
): Promise<Group> {
  const first = await attempt(pkg, resolver, signal);
  if (!(first instanceof Error)) return first;
  const left: string[] = [];
  const found = await failing(pkg, { resolver, signal }, left);
  const kept = pkg.subpaths.filter((subpath) => !left.includes(subpath));
  if (!found || left.length === 0 || kept.length === 0) throw first;
  const rest = await attempt({ ...pkg, subpaths: kept }, resolver, signal);
  if (rest instanceof Error) throw first;
  return rest.ok ? { ...rest, left } : rest;
}

/** The build's outputs, each shaped for the page: the entries by subpath, the chunks by hash. */
async function sorted(
  files: readonly { readonly path: string; readonly text: string }[],
  outdir: string,
  context: Context,
) {
  const entries = new Map<string, string>();
  const chunks = new Map<string, string>();
  for (const file of files) {
    const place = placeOf(outdir, file.path);
    const key = relative(context.lookup, file.path).split(sep).join("/");
    const entryPoint = context.metafile.outputs[key]?.entryPoint;
    const isEntry = place.entry !== undefined;
    const text = await outputText(file.text, { entryPoint, isEntry }, context);
    const subpath = place.entry === undefined ? undefined : context.pkg.subpaths[place.entry];
    if (subpath !== undefined) entries.set(subpath, text);
    if (place.chunk !== undefined) chunks.set(place.chunk, text);
  }
  return { entries, chunks };
}
