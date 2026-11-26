// `__import` and `require`: a relative or absolute path resolves from the workspace folder
// and is cache-busted by its mtime so an edited file reloads; a file: URL imports as it is; every other specifier
// goes through the workspace loader, so packages resolve from the workspace's node_modules and load once.
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { LoaderInvalid } from "./errors.js";

export type ImportOptions = {
  /** The workspace folder (the kernel's cwd). */
  readonly workspace: string;
  /** The kernel's own `import()`, so the loader and files load in the kernel's realm. */
  readonly load: (url: string) => Promise<unknown>;
};

type Load = (specifier: string) => Promise<unknown>;

const isLoad = (value: unknown): value is Load => typeof value === "function";

const isPath = (specifier: string): boolean =>
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../") ||
  specifier.startsWith("/");

/** The modification time of `path`, or undefined when there is no file (Node then reports the import itself). */
function mtimeOf(path: string): number | undefined {
  return statSync(path, { throwIfNoEntry: false })?.mtimeMs;
}

/** The URL a path specifier imports: the workspace file, with `?v=<mtime>` when it exists. */
export function pathUrl(workspace: string, specifier: string): string {
  const path = resolve(workspace, specifier);
  const mtime = mtimeOf(path);
  const url = pathToFileURL(path).href;
  return mtime === undefined ? url : `${url}?v=${String(mtime)}`;
}

/** `__scope.__import(specifier)`. */
export function createImport(options: ImportOptions): (specifier: string) => Promise<unknown> {
  const loaderPath = join(options.workspace, ".jsnb", "loader.mjs");
  let loader: Load | undefined;
  const loadLoader = async (): Promise<Load> => {
    const module: unknown = await options.load(pathToFileURL(loaderPath).href);
    const load: unknown =
      typeof module === "object" && module !== null ? Reflect.get(module, "load") : undefined;
    if (!isLoad(load)) throw new LoaderInvalid({ path: loaderPath });
    return load;
  };
  return async (specifier) => {
    if (isPath(specifier)) return options.load(pathUrl(options.workspace, specifier));
    if (specifier.startsWith("file:")) return options.load(specifier);
    // Kept once loaded; until then every import asks again (Node caches the module), so a load that failed, or that an
    // interrupt cut short and left pending, leaves nothing behind for the next import to wait on.
    const load = loader ?? (await loadLoader());
    loader = load;
    return load(specifier);
  };
}

/** `require` for CommonJS packages, resolved from the workspace's package.json. */
export function createWorkspaceRequire(workspace: string): NodeJS.Require {
  return createRequire(join(workspace, "package.json"));
}
