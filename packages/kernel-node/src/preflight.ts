// The pre-flight of 04-kernel §4 step 1: the packages a cell imports that neither the workspace folder nor an
// ancestor has in node_modules (Node's own resolution walk); the daemon then fails the run with MissingPackage.
import { existsSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";

const scheme = /^[A-Za-z][A-Za-z\d+.-]*:/;

const notPackages = ["", ".", ".."];
const pathPrefixes = ["./", "../", "/", "#"];

/** A specifier that names a package: not a path, a #subpath import, a URL (file:, data:, node:…) or a builtin. */
const isBare = (specifier: string): boolean =>
  !notPackages.includes(specifier) &&
  !pathPrefixes.some((prefix) => specifier.startsWith(prefix)) &&
  !scheme.test(specifier) &&
  !isBuiltin(specifier);

/** `@scope/name` or `name`, the folder under node_modules. */
const packageName = (specifier: string): string => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
};

function installed(workspace: string, name: string): boolean {
  let dir = resolve(workspace);
  for (;;) {
    if (existsSync(join(dir, "node_modules", name, "package.json"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** The package names `imports` name (no path, URL or Node built-in), deduplicated, in order. */
export const packageNames = (imports: readonly string[]): readonly string[] => [
  ...new Set(imports.filter(isBare).map(packageName)),
];

/** The package names of `imports` the workspace cannot resolve, deduplicated, in order. */
export function missingPackages(workspace: string, imports: readonly string[]): readonly string[] {
  return packageNames(imports).filter((name) => !installed(workspace, name));
}
