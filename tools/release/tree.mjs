// The package trees the release build walks: installed packages, Node's resolution, files and folders.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The packages under `modules`, nested ones included: [folder, manifest]. */
export function packagesIn(modules) {
  const found = [];
  if (!existsSync(modules)) return found;
  for (const entry of readdirSync(modules)) {
    if (entry.startsWith(".")) continue;
    const path = join(modules, entry);
    if (entry.startsWith("@")) {
      for (const inner of readdirSync(path)) found.push(...packageAt(join(path, inner)));
    } else {
      found.push(...packageAt(path));
    }
  }
  return found;
}

function packageAt(folder) {
  const manifest = join(folder, "package.json");
  if (!existsSync(manifest)) return [];
  return [
    [folder, JSON.parse(readFileSync(manifest, "utf8"))],
    ...packagesIn(join(folder, "node_modules")),
  ];
}

/** The folder `dep` resolves to from `folder`, Node's way: its own node_modules, then each parent's, up to `app`. */
export function resolveFrom(app, folder, dep) {
  for (let dir = folder; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", dep);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === app || dirname(dir) === dir) return undefined;
  }
}

/** The package folder holding `file`: the nearest parent with a package.json that has a name. */
export function packageOf(file) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (typeof parsed.name === "string") return [dir, parsed];
    }
  }
  return undefined;
}

/** Every file under `dir`, links not followed. */
export function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = lstatSync(path);
    if (info.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

export function walkDirs(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) found.push(path, ...walkDirs(path));
  }
  return found;
}
