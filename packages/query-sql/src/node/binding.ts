// Where the daemon's engine finds `@duckdb/node-api` (11-query §3): the package's own dependency when it is installed
// beside it (a checkout), else a folder the host names, which holds `node_modules/@duckdb/…` (an install made on
// demand outside the app). A resolve hook sends the `@duckdb/node-*` imports Node cannot find to that folder; it asks
// the file system first, so a lookup made before the folder existed is never what Node remembers.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const folders: string[] = [];
let hooked = false;

const isBinding = (specifier: string): boolean =>
  /^@duckdb\/node-(api|bindings)(-[\w-]+)?(\/|$)/u.test(specifier);

/** The package name of a specifier: `@duckdb/node-api/lib/x.js` → `@duckdb/node-api`. */
const packageOf = (specifier: string): string => specifier.split("/").slice(0, 2).join("/");

/** The folder whose node_modules holds `specifier`'s package, the first of the named ones that does. */
function folderFor(specifier: string): string | undefined {
  return folders.find((folder) =>
    existsSync(join(folder, "node_modules", packageOf(specifier), "package.json")),
  );
}

/** Lets the engine load DuckDB from `folder/node_modules` when the package itself has none; idempotent. */
export function useDuckdbFolder(folder: string): void {
  if (!folders.includes(folder)) folders.push(folder);
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (error) {
        const folder = isBinding(specifier) ? folderFor(specifier) : undefined;
        if (folder === undefined) throw error;
        return next(specifier, {
          ...context,
          parentURL: pathToFileURL(join(folder, "index.js")).href,
        });
      }
    },
  });
}

/** Where `@duckdb/node-api` loads from now (its entry's URL), or undefined when it is installed nowhere it is looked for. */
export function findDuckdb(): string | undefined {
  try {
    return import.meta.resolve("@duckdb/node-api");
  } catch {
    // Not installed beside the package nor in a named folder: the engine answers `missing`.
    return undefined;
  }
}
