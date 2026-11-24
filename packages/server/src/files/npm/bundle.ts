// The page's modules at /npm/ (04-kernel §8.1): esbuild's builds under a signal that cancels them (esbuild's
// context().cancel()), and a workspace module (a relative specifier) served as its own source, TypeScript stripped,
// its imports rewritten to /npm/ URLs (a relative one to the /npm/ path of the file it resolves to, as Node and
// TypeScript resolve it: relativeImport.ts). A workspace module's build holds that module alone: the
// plugin resolves every one of its imports (static, dynamic, require, whatever loader the file would take) and keeps it
// external when the path rule (spec.ts) allows the file it resolves to, else refuses the module, so no JSON, text,
// style or asset file is ever read into a build. A bare import points where a package's does (bareImport.ts), as Node
// resolves it from the module's real folder (a monorepo package's own dependency). A workspace
// CommonJS file's literal requires get the prelude of requires.ts and its named exports those Node gives.
// A package's bundle is packageBundle.ts. A refusal is a result (`Built`), which the caller answers
// with a bare 404; a build that fails throws.
import { dirname, relative, sep } from "node:path";

import type { BuildOptions, Metafile, Plugin } from "esbuild";
import { context } from "esbuild";

import type { Resolver } from "./bareImport.js";
import { bareUrlOf } from "./bareImport.js";
import { commonJsNames, withNamedExports } from "./commonJsExports.js";
import { resolveRelative } from "./relativeImport.js";
import type { Required } from "./requires.js";
import { commonJsMark, requirePrelude } from "./requires.js";

/** A module the path rule allows, or its refusal (one of its imports or of its bundle's files breaks the rule). */
export type Built = { readonly ok: true; readonly text: string } | { readonly ok: false };

/** A refusal of the path rule. */
export const refusal: { readonly ok: false } = { ok: false };

/** A workspace file's path below the workspace, as the page names it (`./lib/prices.ts`). */
const belowOf = (root: string, path: string): string =>
  `./${relative(root, path).split(sep).join("/")}`;

/** The /npm/ URL of a workspace file, from its absolute path. */
const fileUrl = (root: string, path: string): string =>
  `/npm/${encodeURIComponent(belowOf(root, path))}`;

/** What one transform saw: whether the rule refused an import, and its literal requires. */
type Seen = { refused: boolean; readonly requires: Required[] };

/**
 * Where an import of a workspace module from its real folder `from` points: a relative one at the /npm/ URL of the
 * file it resolves to (the path as written when nothing is there, which the page is then told is missing), refused
 * when the rule refuses that file; a bare one where Node resolves it (bareImport.ts), else at /npm/<spec>, which the
 * page is told is missing. Whether it found something, for a require.
 */
async function targetOf(
  resolver: Resolver,
  spec: string,
  from: string,
): Promise<{ readonly url: string; readonly found: boolean } | undefined> {
  if (!/^\.\.?(?:\/|$)/.test(spec)) {
    const url = await bareUrlOf(resolver, spec, from);
    return { url: url ?? `/npm/${spec}`, found: url !== undefined };
  }
  const resolved = await resolveRelative(resolver.root, from, spec);
  if (resolved.kind === "refused") return undefined;
  return { url: fileUrl(resolver.root, resolved.path), found: resolved.kind === "file" };
}

/**
 * Leaves every import but the entry external: bare ones as /npm/<spec>, relative ones as the /npm/ URL of the file
 * they resolve to when the path rule allows it, else the build fails and `seen` says so; notes each literal require.
 */
function externals(resolver: Resolver, seen: Seen): Plugin {
  return {
    name: "nimbo-npm-externals",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, async (args) => {
        if (args.kind === "entry-point") return undefined;
        const spec = args.path;
        if (spec.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(spec))
          return { path: spec, external: true };
        const target = await targetOf(resolver, spec, args.resolveDir);
        if (target === undefined) {
          seen.refused = true;
          return { errors: [{ text: `${spec} is no module of the workspace` }] };
        }
        if (args.kind === "require-call")
          seen.requires.push({ url: target.url, spec, found: target.found });
        return { path: target.url, external: true };
      });
    },
  };
}

const common = {
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  logLevel: "silent",
  // Vue's ESM builds read three compile-time flags a bundler defines, and warn on every load without them.
  define: {
    "process.env.NODE_ENV": '"development"',
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
} as const;

/** What one esbuild run made: the module's text and what it read. */
export type Made = { readonly text: string; readonly metafile: Metafile };

/** Whether the build's entry is CommonJS: its module then marks itself for the modules that require it. */
export const fromCommonJs = (made: Made): boolean => {
  const entry = Object.values(made.metafile.outputs)[0]?.entryPoint;
  return entry !== undefined && made.metafile.inputs[entry]?.format === "cjs";
};

/** One build that `signal` cancels: esbuild stops it, and the call rejects with the signal's reason. */
export async function buildUnder(options: BuildOptions, signal: AbortSignal): Promise<Made> {
  signal.throwIfAborted();
  const builder = await context({ ...common, ...options, metafile: true });
  const cancel = (): void => void builder.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted(); // aborted while esbuild prepared the build (its listener came after): it never starts
    const result = await builder.rebuild();
    signal.throwIfAborted();
    return {
      text: result.outputFiles?.[0]?.text ?? "",
      metafile: result.metafile,
    };
  } catch (error) {
    signal.throwIfAborted(); // a cancelled build fails with esbuild's own message; the reason is the signal's
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    await builder.dispose();
  }
}

/**
 * The workspace module `path` (a real path the rule allows) as a browser module of its own; refused when one of its
 * imports breaks the path rule.
 */
export async function transformFile(
  resolver: Resolver,
  path: string,
  signal: AbortSignal,
): Promise<Built> {
  const seen: Seen = { refused: false, requires: [] };
  const plugins = [externals(resolver, seen)];
  try {
    const options = { entryPoints: [path], absWorkingDir: dirname(path), plugins };
    const made = await buildUnder(options, signal);
    const commonJs = fromCommonJs(made);
    const text = commonJs ? withNamedExports(made.text, await commonJsNames(path)) : made.text;
    const prelude = requirePrelude(seen.requires, belowOf(resolver.root, path), text);
    return { ok: true, text: `${prelude}${commonJs ? commonJsMark : ""}${text}` };
  } catch (error) {
    if (seen.refused) return refusal;
    throw error;
  }
}
