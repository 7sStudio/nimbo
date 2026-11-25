// Fixture packages and probes for the tests of a package's split bundle at /npm/ (04-kernel §8.1): /npm/ over a test
// workspace with its builds counted from the log, packages of each shape the bundler meets, and the CPU the builds
// spend, to tell a cancelled build from one left running.
import { execFileSync } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import type { Workspace } from "@jsnb/test-tools/workspace";

import type { NpmModule } from "../files/npm/npmModules.js";
import { createNpmModules } from "../files/npm/npmModules.js";

const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

type Logged = { readonly fields: Readonly<Record<string, unknown>>; readonly message: string };

/** /npm/ over the workspace, with the daemon's cache folder, its builds counted from the log. */
export async function modulesOf(
  ws: Workspace,
  options: { readonly timeoutMs?: number; readonly concurrency?: number } = {},
) {
  const root = await realpath(ws.dir);
  await mkdir(join(root, ".jsnb/cache/npm"), { recursive: true }); // as the daemon makes it at its start
  const logged: Logged[] = [];
  const note = (fields: Readonly<Record<string, unknown>>, message: string): void => {
    logged.push({ fields, message });
  };
  const npm = createNpmModules(
    { root, cacheDir: join(root, ".jsnb/cache/npm") },
    {
      timeoutMs: options.timeoutMs ?? 30_000,
      concurrency: options.concurrency,
      log: { info: note, warn: note },
    },
  );
  const get = (rest: string): Promise<NpmModule> => npm(rest, new AbortController().signal);
  const noted = (part: string): number =>
    logged.filter(({ message }) => message.includes(part)).length;
  return { npm, get, builds: () => noted("bundling"), noted, root };
}

/** A module's text; throws the failure of a module that could not be made. */
export const body = (answer: NpmModule): string => {
  if (!answer.ok) throw answer.error ?? new Error(`status ${String(answer.status)}`);
  return answer.body;
};

const esm = (name: string, version: string, exports: unknown): string =>
  json({ name, version, type: "module", exports });

/** `many`: an entry that re-exports `count` modules, each also a subpath export, all sharing one module with state. */
export function manyModules(count: number, version = "1.0.0"): Record<string, string> {
  const names = Array.from({ length: count }, (_, at) => `m${String(at)}`);
  const files: Record<string, string> = {
    "node_modules/many/package.json": esm("many", version, {
      ".": "./index.js",
      ...Object.fromEntries(names.map((name) => [`./${name}`, `./${name}.js`])),
    }),
    "node_modules/many/shared.js": "export const calls = { count: 0 };\n",
    "node_modules/many/index.js": `${names.map((name) => `export * from "./${name}.js";`).join("\n")}\n`,
  };
  for (const name of names) {
    files[`node_modules/many/${name}.js`] =
      `import { calls } from "./shared.js";\nexport const ${name} = () => ++calls.count;\n`;
  }
  return files;
}

/**
 * `cjs-pair` (CommonJS, two entries sharing a module, a literal require of `cjs-dep` and of itself), and `lib-a` and
 * `lib-b`, which both import `counter`, a module with state.
 */
export const sharingPackages: Readonly<Record<string, string>> = {
  "node_modules/counter/package.json": esm("counter", "2.0.0", "./index.js"),
  "node_modules/counter/index.js":
    "export const state = { n: 0 };\nexport const bump = () => ++state.n;\n",
  "node_modules/cjs-pair/package.json": json({
    name: "cjs-pair",
    version: "1.0.0",
    exports: { ".": "./index.js", "./extra": "./extra.js" },
  }),
  "node_modules/cjs-pair/shared.js": "module.exports = { hits: 0 };\n",
  "node_modules/cjs-pair/index.js":
    'const shared = require("./shared.js");\nconst dep = require("cjs-dep");\nexports.hit = () => ++shared.hits;\nexports.dep = dep.value;\n',
  "node_modules/cjs-pair/extra.js":
    'const shared = require("./shared.js");\nexports.hits = () => shared.hits;\nexports.self = require("cjs-pair").hit;\n',
  "node_modules/cjs-dep/package.json": json({
    name: "cjs-dep",
    version: "1.0.0",
    main: "index.js",
  }),
  "node_modules/cjs-dep/index.js": "exports.value = 7;\n",
  "node_modules/lib-a/package.json": esm("lib-a", "1.0.0", "./index.js"),
  "node_modules/lib-a/index.js":
    'import { bump } from "counter";\nexport const a = () => bump();\n',
  "node_modules/lib-b/package.json": esm("lib-b", "1.0.0", "./index.js"),
  "node_modules/lib-b/index.js":
    'import { bump } from "counter";\nexport const b = () => bump();\n',
};

/** `cond`: entries under conditions, a types-only entry, a style one, and a pattern subpath that imports the main. */
export const conditionalPackage: Readonly<Record<string, string>> = {
  "node_modules/cond/package.json": json({
    name: "cond",
    version: "1.0.0",
    exports: {
      ".": { browser: "./browser.js", import: "./esm.js", default: "./cjs.js" },
      "./feature": { import: "./feature.mjs", require: "./feature.cjs" },
      "./types": { types: "./types.d.ts" },
      "./style.css": "./style.css",
      "./lib/*": "./lib/*.js",
    },
  }),
  "node_modules/cond/browser.js": 'export const where = "browser";\n',
  "node_modules/cond/esm.js": 'export const where = "esm";\n',
  "node_modules/cond/cjs.js": 'exports.where = "cjs";\n',
  "node_modules/cond/feature.mjs": 'export const feature = "import";\n',
  "node_modules/cond/feature.cjs": 'exports.feature = "require";\n',
  "node_modules/cond/types.d.ts": "export declare const x: number;\n",
  "node_modules/cond/style.css": "body { color: red; }\n",
  "node_modules/cond/lib/deep.js": 'import { where } from "cond";\nexport const deep = where;\n',
};

/** `own`, a linked package (its folder outside node_modules, a link to it inside), whose two entries share `v.js`. */
export const linkedPackage: Readonly<Record<string, string>> = {
  "libs/own/package.json": esm("own", "0.0.1", { ".": "./a.js", "./b": "./b.js" }),
  "libs/own/a.js": 'import { v } from "./v.js";\nexport const a = v;\n',
  "libs/own/b.js": 'import { v } from "./v.js";\nexport const b = v;\n',
  "libs/own/v.js": "export const v = 1;\n",
};

/** `uses-path`, which imports two Node built-ins, and `half`, one of whose entries does not parse. */
export const awkwardPackages: Readonly<Record<string, string>> = {
  "node_modules/uses-path/package.json": esm("uses-path", "1.0.0", "./index.js"),
  "node_modules/uses-path/index.js":
    'import { join } from "path";\nimport fs from "node:fs";\nexport const loaded = true;\nexport const joined = () => join("a", "b");\nexport const read = () => fs.readFileSync;\n',
  "node_modules/half/package.json": esm("half", "1.0.0", {
    ".": "./index.js",
    "./broken": "./broken.js",
  }),
  "node_modules/half/index.js": "export const fine = 1;\n",
  "node_modules/half/broken.js": "export const = ;\n",
};

/** `slow`: an entry over `count` modules, each importing a package that is not installed (a lookup each). */
export function slowPackage(count: number): Record<string, string> {
  const names = Array.from({ length: count }, (_, at) => `m${String(at)}`);
  const files: Record<string, string> = {
    "node_modules/slow/package.json": esm("slow", "1.0.0", "./index.js"),
    "node_modules/slow/index.js": `${names.map((name) => `export * from "./${name}.js";`).join("\n")}\n`,
  };
  for (const name of names) {
    files[`node_modules/slow/${name}.js`] = `import "absent-${name}";\nexport const ${name} = 1;\n`;
  }
  return files;
}

/** Resolves once `holds()` is true, checked every 10 ms. */
export async function until(holds: () => boolean): Promise<void> {
  while (!holds()) await pause(10);
}

export const pause = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

/** The CPU seconds of esbuild's service, this process's child. */
function esbuildCpu(): number {
  const lines = execFileSync("ps", ["-A", "-o", "ppid=,time=,command="]).toString().split("\n");
  return lines
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([ppid, , command]) => Number(ppid) === process.pid && command?.includes("esbuild") === true,
    )
    .reduce((total, [, time = "0:0"]) => {
      const [minutes = "0", seconds = "0"] = time.split(":");
      return total + Number(minutes) * 60 + Number(seconds);
    }, 0);
}

/** This process's CPU seconds, where esbuild calls the bundler's plugin. */
function ownCpu(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1e6;
}

/** The CPU seconds the builds spend (esbuild's service and this process, which runs the plugin) until `done`. */
export async function buildCpuUntil(done: Promise<unknown>): Promise<number> {
  const before = esbuildCpu() + ownCpu();
  await done;
  return esbuildCpu() + ownCpu() - before;
}
