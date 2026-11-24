// The esbuild plugin of a package's bundle (04-kernel §8.1). A
// bare import is external under the URL of the folder Node resolves it to from the importing file (bareImport.ts),
// unless the importing package's own package.json decides it first (packageFields.ts): its `browser` map disables a
// name or maps it to its own file (esbuild applies both) or to another bare name, and its `imports` map gives a `#name`
// its own file (esbuild bundles it) or another package (that package's bare import). A relative import that lands on
// one of the package's own entries (its main, or an `exports` target) other than the bundle's own is external under
// that entry's URL, so a subpath entry (moment's `locale/fr.js` requiring `../moment`) shares the main entry's
// instance instead of bundling a copy. Each bare import is noted with where it was resolved from, for the cache to
// check it again, each literal require for the prelude (requires.ts), and each file's identity before
// esbuild reads it.
import type { ImportKind, OnResolveArgs, OnResolveResult, Plugin, PluginBuild } from "esbuild";

import type { Resolver } from "./bareImport.js";
import { bareUrlOf } from "./bareImport.js";
import type { Identity } from "./inputs.js";
import { identityOf } from "./inputs.js";
import type { FieldsRead } from "./packageFields.js";
import { decided } from "./packageFields.js";
import type { Required } from "./requires.js";

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
 * The package being bundled: its name, the URL of its folder (`/npm/<name>` or the resolved form), the subpath of the
 * bundle's entry (`""` or `/locale/fr.js`), the folder it is resolved from, and its `exports` subpaths (`/client`).
 */
export type Bundling = {
  readonly name: string;
  readonly base: string;
  readonly subpath: string;
  readonly lookup: string;
  readonly exports: readonly string[];
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

/** A bare import or `#name`: external where it points, unless the importing package leaves it to esbuild. */
function onBare(resolver: Resolver, seen: Seen) {
  const read: FieldsRead = new Map();
  return async (args: OnResolveArgs): Promise<OnResolveResult | undefined> => {
    if (args.pluginData === inner || args.kind === "entry-point") return undefined;
    if (/^[a-z][a-z0-9+.-]*:/i.test(args.path)) return undefined;
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

/** A relative import that lands on another of the package's own entries: external under that entry's URL. */
function onRelative(builder: PluginBuild, pkg: Bundling, seen: Seen) {
  const entries = new Map<string, Promise<Map<string, string>>>();
  const entriesFor = (kind: ImportKind): Promise<Map<string, string>> => {
    const key = isRequire(kind) ? "require" : "import";
    const made = entries.get(key) ?? entriesOf(builder, pkg, kind);
    entries.set(key, made);
    return made;
  };
  return async (args: OnResolveArgs): Promise<OnResolveResult | undefined> => {
    if (args.pluginData === inner || args.kind === "entry-point") return undefined;
    const options = { kind: args.kind, resolveDir: args.resolveDir, pluginData: inner };
    const resolved = await builder.resolve(args.path, options);
    const url = (await entriesFor(args.kind)).get(resolved.path);
    if (url === undefined || url === `${pkg.base}${pkg.subpath}`) return undefined; // bundled as usual
    if (isRequire(args.kind)) seen.requires.push({ url, spec: args.path, found: true });
    return { path: url, external: true };
  };
}

/** The plugin of one package build. */
export function packagePlugin(resolver: Resolver, pkg: Bundling, seen: Seen): Plugin {
  return {
    name: "nimbo-npm-package",
    setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, onBare(resolver, seen));
      builder.onResolve({ filter: /^\.\.?(?:\/|$)/ }, onRelative(builder, pkg, seen));
      builder.onLoad({ filter: /.*/ }, async (args) => {
        if (args.namespace === "file") seen.identities.set(args.path, await identityOf(args.path));
        return undefined; // esbuild reads it as usual, after the identity was taken
      });
    },
  };
}
