// The package manager packages.add and packages.remove run (03-api §4.6, the packages.manager setting): auto picks the
// one whose lockfile the workspace has, else the first of pnpm, npm, yarn and bun found on PATH; each adds and removes
// with its own verb. A name that would read as an option (a leading `-`) never reaches it, and no shell does: the names
// are arguments.
import { existsSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

import { InvalidParams } from "@jsnb/core";

export type Manager = "pnpm" | "npm" | "yarn" | "bun";

const lockfiles: readonly (readonly [string, Manager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

const order: readonly Manager[] = ["pnpm", "npm", "yarn", "bun"];

/** Whether `command` is an executable file in a PATH folder. */
function onPath(command: string, path: string): boolean {
  return path.split(delimiter).some((folder) => {
    const candidate = join(folder, command);
    return folder !== "" && existsSync(candidate) && statSync(candidate).isFile();
  });
}

/**
 * The PATH the manager is looked up and run with: the daemon's own, then the folder of the Node running it. A daemon
 * started from a GUI or with an absolute path to an nvm Node may lack that folder, which holds npm (and corepack's
 * pnpm) and the `node` that npm's `#!/usr/bin/env node` needs.
 */
export function managerPath(path = process.env.PATH ?? ""): string {
  const own = dirname(process.execPath);
  const folders = path.split(delimiter).filter((folder) => folder !== "");
  return folders.includes(own) ? folders.join(delimiter) : [...folders, own].join(delimiter);
}

/** The manager for `root`: the setting's, or the lockfile's, or the first on PATH (npm, which ships with Node, last). */
export function managerFor(root: string, setting: Manager | "auto", path = managerPath()): Manager {
  if (setting !== "auto") return setting;
  const locked = lockfiles.find(([file]) => existsSync(join(root, file)));
  if (locked) return locked[1];
  return order.find((manager) => onPath(manager, path)) ?? "npm";
}

/**
 * The arguments that add `names` with `manager`. A workspace may be a pnpm workspace's root, where pnpm refuses
 * `add` without being told the root is meant (ERR_PNPM_ADDING_TO_ROOT); the nimbo workspace is that root, and the flag
 * changes nothing elsewhere.
 */
export const addArgs = (manager: Manager, names: readonly string[]): string[] =>
  manager === "npm"
    ? ["install", ...names]
    : manager === "pnpm"
      ? ["add", "--ignore-workspace-root-check", ...names]
      : ["add", ...names];

/** The arguments that remove `names` with `manager`. */
export const removeArgs = (manager: Manager, names: readonly string[]): string[] => [
  manager === "npm" ? "uninstall" : "remove",
  ...names,
];

const spec = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*(?:@[^\s@][^\s]*)?$/;

/** The package name of a spec (`zod@^4` → `zod`, `@scope/x@1` → `@scope/x`). */
export const nameOf = (value: string): string => {
  const at = value.indexOf("@", 1);
  return at < 0 ? value : value.slice(0, at);
};

/** Checks the specs packages.add got: a package name with an optional version or tag each. */
export function checkSpecs(names: readonly string[]): void {
  const issues = names.flatMap((name, index) =>
    spec.test(name)
      ? []
      : [
          {
            path: ["names", index],
            message: `${name} is not a package name with an optional @version`,
          },
        ],
  );
  if (issues.length > 0) throw new InvalidParams({ issues });
}
