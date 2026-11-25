// A package's bundle for the page (04-kernel §8.1): esbuild
// bundles the package from the folder Node found it from, for the browser (ESM), with the plugin of packagePlugin.ts
// (each bare import external under the URL of the folder Node resolves it to, the package's `browser` and `imports`
// maps applied first, its own entries shared by URL). Literal requires get the prelude of requires.ts; a CommonJS
// entry marks itself and gets the named exports Node gives an import of it (commonJsExports.ts). The bundle holds only
// files inside the package's real folder (a link out of it is refused 500), none hidden below it, and for a linked
// package module source only (spec.ts), else it is refused; esbuild's virtual inputs (`(disabled):…`, a `browser`
// field's false, or any `<namespace>:` input) are no files and are not checked. Each input's identity is taken before
// esbuild reads it, for the record of a linked package's inputs, and each bare import is kept with
// where it was resolved from, for the cache to check it again. A relative import without its
// extension resolves in the order of relativeImport.ts, `.js` and `.json` first as a server cell's require does.
// The page's `vue` is Vue's full ESM build, the runtime with its template compiler (`pageEntries`), as a bundler is
// told to alias it for in-browser templates, so a cell's `template: "<button>…"` works without a build step.
import { realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { Metafile } from "esbuild";

import type { Resolver } from "./bareImport.js";
import { buildUnder, fromCommonJs, refusal } from "./bundle.js";
import { commonJsNames, withNamedExports } from "./commonJsExports.js";
import type { Identity } from "./inputs.js";
import { identityOf } from "./inputs.js";
import type { BareImport, Seen } from "./packagePlugin.js";
import { packagePlugin } from "./packagePlugin.js";
import { resolveExtensions } from "./relativeImport.js";
import { commonJsMark, requirePrelude } from "./requires.js";
import type { FoundPackage } from "./resolve.js";
import { isLinkedPackage, packageFileAllowed } from "./spec.js";

/** A package's bundle with the identity of each file it read before the read and its bare imports, or its refusal. */
export type Bundled =
  | {
      readonly ok: true;
      readonly text: string;
      readonly inputs: readonly Identity[] | undefined;
      readonly imports: readonly BareImport[];
    }
  | { readonly ok: false };

/** Whether a metafile input is one of esbuild's virtual modules, not a file. */
const isVirtual = (input: string): boolean => /^(?:\(disabled\)|[a-z][\w-]*):/i.test(input);

/** The files a build read, each with its real path; esbuild's virtual inputs left out. */
const filesOf = (from: string, metafile: Metafile) =>
  Promise.all(
    Object.keys(metafile.inputs)
      .filter((input) => !isVirtual(input))
      .map(async (input) => ({ input, path: await realpath(resolve(from, input)) })),
  );

/**
 * The file a package's main entry is bundled from in the page when it is not the one its `exports` gives: Vue's main
 * is its runtime alone, which ignores a component's `template`; its full build adds the compiler and is otherwise the
 * same module, so every importer of `vue` still shares one instance under `/npm/vue`. A version without that file
 * (Vue 2) keeps its own entry.
 */
const pageEntries: Readonly<Record<string, string>> = { vue: "/dist/vue.esm-bundler.js" };

/** The specifier esbuild bundles for the subpath `subpath` of `name`, found in the real folder `folder`. */
export async function entryOf(name: string, subpath: string, folder: string): Promise<string> {
  const page = subpath === "" ? pageEntries[name] : undefined;
  if (page === undefined) return `${name}${subpath}`;
  const file = await stat(join(folder, page)).catch(() => undefined);
  return file?.isFile() === true ? `${name}${page}` : name;
}

/** The bundle's text: its prelude, its CommonJS mark and its named exports around esbuild's output. */
async function textOf(
  made: Awaited<ReturnType<typeof buildUnder>>,
  seen: Seen,
  pkg: { name: string; lookup: string },
) {
  if (!fromCommonJs(made))
    return `${requirePrelude(seen.requires, pkg.name, made.text)}${made.text}`;
  const entry = Object.values(made.metafile.outputs)[0]?.entryPoint ?? "";
  const names = await commonJsNames(await realpath(resolve(pkg.lookup, entry)));
  const text = withNamedExports(made.text, names);
  return `${requirePrelude(seen.requires, pkg.name, text)}${commonJsMark}${text}`;
}

/**
 * The browser bundle of the subpath `subpath` (`""` or `/sub`) of the package `name` found at `found`, whose folder
 * the page names `base`; rejects when it would hold a file outside the package's real folder, and is refused when it
 * would hold one the rule keeps from a package.
 */
export async function bundlePackage(
  pkg: {
    readonly name: string;
    readonly subpath: string;
    readonly base: string;
    readonly found: FoundPackage;
    /** The subpaths the package's split bundle serves, which a relative import may land on. */
    readonly siblings: readonly string[];
  },
  resolver: Resolver,
  signal: AbortSignal,
): Promise<Bundled> {
  const { folder, lookup } = pkg.found;
  const seen: Seen = { requires: [], imports: [], identities: new Map() };
  const manifest = await identityOf(join(folder, "package.json"));
  const stamp = `${String(manifest?.size)}:${String(manifest?.mtimeMs)}`;
  const bundling = { ...pkg, lookup, exports: pkg.siblings.filter((sub) => sub !== ""), stamp };
  const plugins = [
    packagePlugin(resolver, bundling, seen, {
      split: false,
      linked: isLinkedPackage(folder),
      signal,
    }),
  ];
  const entryPoints = [await entryOf(pkg.name, pkg.subpath, folder)];
  const options = {
    entryPoints,
    absWorkingDir: lookup,
    plugins,
    resolveExtensions: [...resolveExtensions],
  };
  const made = await buildUnder(options, signal);
  const checked = await checkedInputs(folder, lookup, made.metafile, seen);
  if (!checked.ok) return refusal;
  const { inputs } = checked;
  const text = await textOf(made, seen, { name: pkg.name, lookup });
  return { ok: true, text, inputs, imports: seen.imports };
}

/**
 * The identities of what a build read, by the rule: it rejects when a file lies outside the package's real folder,
 * is refused when the rule keeps one from a package, and is undefined when one was not taken.
 */
export async function checkedInputs(
  folder: string,
  lookup: string,
  metafile: Metafile,
  seen: Seen,
): Promise<
  { readonly ok: true; readonly inputs: readonly Identity[] | undefined } | typeof refusal
> {
  const files = await filesOf(lookup, metafile);
  const escaped = files.filter(({ path }) => !path.startsWith(`${folder}${sep}`));
  if (escaped.length > 0) {
    throw new Error(
      `it reads ${escaped.map(({ input }) => input).join(", ")}, outside the package`,
    );
  }
  if (!files.every(({ path }) => packageFileAllowed(folder, path))) return refusal;
  const identities = files.map(({ path }) => seen.identities.get(path));
  const taken = identities.every((identity) => identity !== undefined);
  return { ok: true, inputs: taken ? identities : undefined };
}
