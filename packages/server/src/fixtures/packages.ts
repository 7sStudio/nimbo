// Installed packages for the tests of /npm/ and the pre-flight: files written into a test
// workspace's node_modules as a package manager would leave them, ESM and CommonJS, scoped and not.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Workspace } from "@jsnb/test-tools/workspace";

/** Writes `files` (path → text) inside the workspace. */
export async function writeFiles(
  ws: Workspace,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(ws.path(path)), { recursive: true });
    await writeFile(ws.path(path), text);
  }
}

const json = (value: unknown): string => `${JSON.stringify(value)}\n`;

/** `@demo/lib` (ESM, a subpath export, an import of `dep-esm`), `dep-esm` (ESM) and `cjs-dep` (CommonJS). */
export const demoPackages: Readonly<Record<string, string>> = {
  "node_modules/@demo/lib/package.json": json({
    name: "@demo/lib",
    version: "1.2.3",
    type: "module",
    exports: { ".": "./index.js", "./sub": "./sub/index.js" },
  }),
  "node_modules/@demo/lib/index.js":
    'import { base } from "dep-esm";\nimport { local } from "./local.js";\nexport const lib = () => base + local;\n',
  "node_modules/@demo/lib/local.js": "export const local = 1;\n",
  "node_modules/@demo/lib/sub/index.js": 'export const sub = "sub";\n',
  "node_modules/dep-esm/package.json": json({
    name: "dep-esm",
    version: "0.1.0",
    type: "module",
    exports: "./index.js",
  }),
  "node_modules/dep-esm/index.js": "export const base = 41;\n",
  "node_modules/cjs-dep/package.json": json({
    name: "cjs-dep",
    version: "2.0.0",
    main: "index.js",
  }),
  "node_modules/cjs-dep/index.js": "exports.value = 7;\n",
};
