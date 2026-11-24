// How a relative import of a workspace module resolves (04-kernel §8.1): as Node and
// TypeScript do, against the importing file's real folder. The path as written first; then `.js` and `.json`, the
// order of a server cell's require (Node's own extensions), then `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.tsx` and
// `.jsx`, for a require and an import alike (one list, also a package bundle's in esbuild); a JavaScript extension
// that names TypeScript source as TypeScript resolves it (`./x.js` for `x.ts` or `x.tsx`, `.mjs` for `.mts`, `.cjs`
// for `.cts`, `.jsx` for `.tsx`); a folder to its package.json `main`, as Node's require and TypeScript follow it,
// then to its `index` with the same extensions. The path rule (spec.ts) holds on the path as written (inside the
// workspace, no dot segment) and on the file it resolves to, as written and as its real path (module source only),
// so leaving the extension off reaches nothing more: a resolution that lands on data, a hidden file or a link out of
// the workspace is refused, as the same import with its extension written is.
import { realpath, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { z } from "zod";

import { readRegularFile } from "../regularFile.js";
import { parsedJson } from "./inputs.js";
import { isWorkspaceModule, isWorkspacePath } from "./spec.js";

/** The extensions an import without one is tried with, in this order (one list for every kind of import). */
export const resolveExtensions: readonly string[] = [
  ".js",
  ".json",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".jsx",
];

/** The TypeScript source a JavaScript extension may name, as TypeScript resolves it (node16, nodenext, bundler). */
const typeScriptOf: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/** A relative import resolved: a file the rule allows, nothing there (the path as written), or a refusal. */
type Resolved =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "refused" };

const refused: Resolved = { kind: "refused" };

/** A folder's package.json, of which only `main` is read; it is read as a regular file only, like every file. */
const FolderManifest = z.looseObject({ main: z.string().optional() });

const kindOf = (path: string): Promise<"file" | "folder" | undefined> =>
  stat(path).then(
    (stats) => (stats.isFile() ? "file" : stats.isDirectory() ? "folder" : undefined),
    () => undefined, // nothing there
  );

/** The first file among `base` as written, its TypeScript source and `base` with each extension. */
async function fileAt(base: string): Promise<string | undefined> {
  const ext = extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length);
  const candidates = [
    base,
    ...(typeScriptOf[ext] ?? []).map((source) => `${stem}${source}`),
    ...resolveExtensions.map((extension) => `${base}${extension}`),
  ];
  for (const candidate of candidates) if ((await kindOf(candidate)) === "file") return candidate;
  return undefined;
}

/** The `main` of the folder's package.json, when it has one (a missing, unreadable or odd file names none). */
async function mainOf(folder: string): Promise<string | undefined> {
  const read = await readRegularFile(join(folder, "package.json"), 1024 * 1024);
  if (read.kind !== "read") return undefined;
  return FolderManifest.safeParse(parsedJson(read.text)).data?.main;
}

/** The file a folder resolves to: its package.json `main` (a file, or a folder's index), then its own `index`. */
async function folderFile(folder: string): Promise<string | undefined> {
  if ((await kindOf(folder)) !== "folder") return undefined;
  const main = await mainOf(folder);
  const fromMain =
    main === undefined
      ? undefined
      : ((await fileAt(resolve(folder, main))) ??
        (await fileAt(join(resolve(folder, main), "index"))));
  return fromMain ?? (await fileAt(join(folder, "index")));
}

/**
 * What the relative import `spec` of a module in `from` (its real folder) resolves to in the workspace `root` (its
 * real path), as Node and TypeScript resolve it, and whether the path rule allows that file.
 */
export async function resolveRelative(root: string, from: string, spec: string): Promise<Resolved> {
  const base = resolve(from, spec);
  if (!isWorkspacePath(root, base)) return refused; // outside the workspace, or a hidden or refused segment
  const file = (await fileAt(base)) ?? (await folderFile(base));
  if (file === undefined) return { kind: "missing", path: base };
  const real = await realpath(file).catch(() => undefined); // gone meanwhile: refused below
  const allowed =
    real !== undefined && isWorkspaceModule(root, file) && isWorkspaceModule(root, real);
  return allowed ? { kind: "file", path: file } : refused;
}
