// The esbuild plugin of a package's bundle (04-kernel §8.1). A
// bare import is external under the URL of the folder Node resolves it to from the importing file (bareImport.ts),
// unless the importing package's own package.json decides it first (packageFields.ts): its `browser` map disables a
// name or maps it to its own file (esbuild applies both) or to another bare name, and its `imports` map gives a `#name`
// its own file (esbuild bundles it) or another package (that package's bare import). A relative import that lands on
// one of the package's own entries (its main, or an `exports` target) other than the bundle's own is external under
// that entry's URL, so a subpath entry (moment's `locale/fr.js` requiring `../moment`) shares the main entry's
// instance instead of bundling a copy. Each bare import is noted with where it was resolved from, for the cache to
// check it again, each literal require for the prelude (requires.ts), and each file's identity before
// esbuild reads it. In a package's split build (packageGroup.ts) the entries share their code through esbuild's chunks
// instead, and a bare import of the package itself that lands on one of the build's entries is bundled with them. A
// static import of a Node built-in that no installed package provides is a stand-in whose use throws an error naming
// it (as Vite's browser-external does). Once the build's signal aborts, every callback answers at once with an error.
import { isBuiltin } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";

import type { ImportKind, OnResolveArgs, OnResolveResult, Plugin, PluginBuild } from "esbuild";

import type { Resolver } from "./bareImport.js";
import { bareUrlOf } from "./bareImport.js";
import type { Identity } from "./inputs.js";
import { identityOf } from "./inputs.js";
import type { FieldsRead } from "./packageFields.js";
import { decided } from "./packageFields.js";
import type { Required } from "./requires.js";
import { findPackage } from "./resolve.js";
import { packageSpecOf } from "./spec.js";

/** A bare import as the bundle resolved it: the spec, the real folder it was resolved from, its URL (null: none). */
export type BareImport = {
  readonly spec: string;
  readonly from: string;
  readonly url: string | null;
};

/** What one build saw: its literal requires, its bare imports, and each file's identity before esbuild read it. */
export type Seen = {
  readonly requires: Required[];
  readonly imports: BareImport[];
  readonly identities: Map<string, Identity | undefined>;
};

/**
 * How a build runs: split over the package's entries or one entry alone, whether its package is a linked one (whose
 * files' identities are taken), and the signal that cancels it.
 */
export type Mode = {
  readonly split: boolean;
  readonly linked: boolean;
  readonly signal: AbortSignal;
  /** A split build's entry specs, which a bare import of the package itself may land on. */
  readonly entries?: readonly string[];
};

/**
 * The package being bundled: its name, the URL of its folder (`/npm/<name>` or the resolved form), the subpath of the
 * bundle's entry (`""` or `/locale/fr.js`), the folder it is resolved from, and its `exports` subpaths (`/client`).
 */
export type Bundling = {
  readonly name: string;
  readonly base: string;
  readonly subpath: string;
  readonly lookup: string;
  readonly exports: readonly string[];
  /** The state of its package.json, part of the key its entries' resolution is kept under. */
  readonly stamp?: string;
};

/** Marks the plugin's own calls of esbuild's resolver, which the plugin leaves to esbuild. */
const inner = Symbol("nimbo inner resolve");

const isRequire = (kind: ImportKind): boolean => kind === "require-call";

/** The package's own entries (its main and each `exports` subpath) as esbuild resolves them for `kind`: path to URL. */
async function entriesOf(builder: PluginBuild, pkg: Bundling, kind: ImportKind) {
  const resolved = await Promise.all(
    ["", ...pkg.exports].map(async (subpath) => {
      const options = { kind, resolveDir: pkg.lookup, pluginData: inner };
      const found = await builder.resolve(`${pkg.name}${subpath}`, options);
      return found.errors.length === 0 && found.path !== ""
        ? [[found.path, `${pkg.base}${subpath}`] as const]
        : [];
    }),
  );
  return new Map(resolved.flat());
}

/** Where a bare import or `#name` points: a URL (null: none found), or undefined when it is esbuild's to resolve. */
async function bareTarget(
  resolver: Resolver,
  spec: string,
  from: string,
  context: { readonly kind: ImportKind; readonly read: FieldsRead },
): Promise<{ readonly url: string | null; readonly spec: string } | undefined> {
  const decision = await decided(spec, from, isRequire(context.kind), context.read);
  if (decision?.kind === "esbuild") return undefined;
  const target = decision?.spec ?? spec;
  return { url: (await bareUrlOf(resolver, target, from)) ?? null, spec: target };
}

/** The specs a split build's own entries resolve to, by esbuild; a bare import of the package that lands on one is it. */
function ownEntry(builder: PluginBuild, pkg: Bundling, entries: readonly string[] | undefined) {
  let paths: Promise<Set<string>> | undefined;
  const pathsOf = async (): Promise<Set<string>> => {
    const resolved = await Promise.all(
      (entries ?? []).map((spec) =>
        builder.resolve(spec, { kind: "entry-point", resolveDir: pkg.lookup, pluginData: inner }),
      ),
    );
    return new Set(resolved.filter((found) => found.errors.length === 0).map(({ path }) => path));
  };
  return async (args: OnResolveArgs): Promise<boolean> => {
    if (entries === undefined || packageSpecOf(args.path)?.name !== pkg.name) return false;
    paths ??= pathsOf();
    const options = { kind: args.kind, resolveDir: args.resolveDir, pluginData: inner };
    const resolved = await builder.resolve(args.path, options);
    return resolved.errors.length === 0 && (await paths).has(resolved.path);
  };
}

/** The namespace of the stand-in for a Node built-in a package imports. */
const builtinSpace = "nimbo-builtin";

/**
 * The stand-in for the Node built-in `spec` that `from` imports: its import succeeds, as a package that only reaches
 * for it on the server (a branch the page never takes) needs, and any use of it throws an error naming it.
 */
const builtinStandIn = (
  spec: string,
  from: string,
): string => `var message = (key) => ${JSON.stringify(
  `${spec} is a Node.js built-in module, which a page cannot load: ${from} reads `,
)} + ${JSON.stringify(spec)} + "." + key + ". Use it in a server cell.";
var thrower = new Proxy({}, { get(_, key) {
  if (typeof key === "symbol" || key === "then" || key === "__esModule") return undefined;
  throw new Error(message(String(key)));
} });
module.exports = new Proxy({}, { get: (_, key) => thrower[key], getPrototypeOf: () => thrower });
`;

/** Whether `args` is a static import of a Node built-in that no installed package of its name provides. */
async function isBuiltinImport(args: OnResolveArgs): Promise<boolean> {
  if (args.kind !== "import-statement" || !isBuiltin(args.path)) return false;
  const name = packageSpecOf(args.path)?.name ?? args.path;
  return (await findPackage(name, args.resolveDir)) === undefined;
}

/** A bare import or `#name`: external where it points, unless the importing package leaves it to esbuild. */
function onBare(resolver: Resolver, seen: Seen, own: (args: OnResolveArgs) => Promise<boolean>) {
  const read: FieldsRead = new Map();
  return async (args: OnResolveArgs): Promise<OnResolveResult | undefined> => {
    if (args.pluginData === inner || args.kind === "entry-point") return undefined;
    if (await isBuiltinImport(args)) return { path: args.path, namespace: builtinSpace };
    if (/^[a-z][a-z0-9+.-]*:/i.test(args.path)) return undefined;
    if (await own(args)) return undefined; // the package itself, bundled with its other entries
    const context = { kind: args.kind, read };
    const target = await bareTarget(resolver, args.path, args.resolveDir, context);
    if (target === undefined) return undefined; // the package's own file, or a name its browser map disables
    seen.imports.push({ spec: target.spec, from: args.resolveDir, url: target.url });
    const url = target.url ?? `/npm/${target.spec}`; // none found: the page is told it is missing
    if (isRequire(args.kind))
      seen.requires.push({ url, spec: args.path, found: target.url !== null });
    return { path: url, external: true };
  };
}

/** The paths that may name an entry's file: the file, without its extension, and its folder for an index. */
const nearPaths = new WeakMap<ReadonlyMap<string, string>, ReadonlySet<string>>();

const withoutExtension = (path: string): string =>
  path.slice(0, path.length - extname(path).length);

/** Whether `path` (a relative import made absolute) may resolve to one of `entries`' files. */
function nearEntry(entries: ReadonlyMap<string, string>, path: string): boolean {
  let near = nearPaths.get(entries);
  if (near === undefined) {
    const paths = new Set<string>();
    for (const file of entries.keys()) {
      const bare = withoutExtension(file);
      paths.add(file).add(bare);
      if (basename(bare) === "index") paths.add(dirname(file));
    }
    near = paths;
    nearPaths.set(entries, near);
  }
  return near.has(path) || near.has(withoutExtension(path));
}

/** A relative import that lands on another of the package's own entries: external under that entry's URL. */
function onRelative(builder: PluginBuild, pkg: Bundling, seen: Seen, resolver: Resolver) {
  const entriesFor = (kind: ImportKind): Promise<ReadonlyMap<string, string>> => {
    const key = [
      isRequire(kind) ? "require" : "import",
      pkg.lookup,
      pkg.base,
      pkg.stamp,
      ...pkg.exports,
    ];
    const memo = key.join("\0"); // once per package: a page's standalone builds would each resolve them all again
    const held = resolver.entries.get(memo);
    if (held !== undefined) return held;
    const made = entriesOf(builder, pkg, kind);
    resolver.entries.set(memo, made);
    made.catch(() => resolver.entries.delete(memo)); // a cancelled build's resolution is not kept
    return made;
  };
  return async (args: OnResolveArgs): Promise<OnResolveResult | undefined> => {
    if (args.pluginData === inner || args.kind === "entry-point") return undefined;
    const entries = await entriesFor(args.kind);
    // Only an import whose path could name an entry's file is resolved here: a package's thousands of others are not.
    if (!nearEntry(entries, resolve(args.resolveDir, args.path))) return undefined;
    const options = { kind: args.kind, resolveDir: args.resolveDir, pluginData: inner };
    const resolved = await builder.resolve(args.path, options);
    const url = entries.get(resolved.path);
    if (url === undefined || url === `${pkg.base}${pkg.subpath}`) return undefined; // bundled as usual
    if (isRequire(args.kind)) seen.requires.push({ url, spec: args.path, found: true });
    return { path: url, external: true };
  };
}

type Cancelled = { readonly errors: { text: string }[] };

/** `callback`, answering an error at once when `signal` aborted: a cancelled build reads and resolves nothing more. */
const until =
  <A, R>(signal: AbortSignal, callback: (args: A) => Promise<R | undefined>) =>
  (args: A): Promise<R | Cancelled | undefined> =>
    signal.aborted
      ? Promise.resolve({ errors: [{ text: "the build was cancelled" }] })
      : callback(args);

/** The plugin of one package build. */
export function packagePlugin(resolver: Resolver, pkg: Bundling, seen: Seen, mode: Mode): Plugin {
  const { signal } = mode;
  return {
    name: "nimbo-npm-package",
    setup(builder) {
      const own = ownEntry(builder, pkg, mode.split ? mode.entries : undefined);
      builder.onResolve({ filter: /^[^./]/ }, until(signal, onBare(resolver, seen, own)));
      builder.onLoad({ filter: /.*/, namespace: builtinSpace }, (args) => ({
        contents: builtinStandIn(args.path, pkg.name),
        loader: "js",
      }));
      if (!mode.split) {
        builder.onResolve(
          { filter: /^\.\.?(?:\/|$)/ },
          until(signal, onRelative(builder, pkg, seen, resolver)),
        );
      }
      if (!mode.linked) return; // a registry package's version says whether its files changed
      builder.onLoad(
        { filter: /.*/, namespace: "file" },
        until(signal, async (args) => {
          seen.identities.set(args.path, await identityOf(args.path));
          return undefined; // esbuild reads it as usual, after the identity was taken
        }),
      );
    },
  };
}
