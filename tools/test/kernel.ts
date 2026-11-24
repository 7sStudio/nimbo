// The kernel helpers of 09-testing §8: compileCell turns cell source into the execute request the daemon sends
// (04-kernel §2.1) through @jsnb/transform, and kernelEntry runs the kernel child from source.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CellAnalysis } from "@jsnb/core";
import { cellUrl } from "@jsnb/core";
import { transform } from "@jsnb/transform";

export type CompileOptions = {
  readonly cell: string;
  readonly execution: string;
  /** The notebook ref in the cell's URL (core's cellUrl, `jsnb:///<notebook>/<cell>.ts`); default `test.jsnb`. */
  readonly notebook?: string;
};

/** An `execute` request without its `type`: the transform's code and map plus the analysis the kernel reports from. */
export type CompiledCell = {
  readonly execution: string;
  readonly cell: string;
  readonly code: string;
  readonly map: string;
  readonly defines: CellAnalysis["defines"];
  readonly kinds: CellAnalysis["kinds"];
};

/** Transforms `source` as `cell` of `notebook`, the way the daemon does before it sends `execute` (04-kernel §4). */
export function compileCell(source: string, options: CompileOptions): CompiledCell {
  const filename = cellUrl(options.notebook ?? "test.jsnb", options.cell);
  const { code, map, analysis } = transform(source, { filename });
  return {
    execution: options.execution,
    cell: options.cell,
    code,
    map,
    defines: analysis.defines,
    kinds: analysis.kinds,
  };
}

/** The nearest ancestor holding `pnpm-workspace.yaml`, so the paths hold from source and from `dist` alike. */
function repositoryRoot(from: string): string {
  let dir = from;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no pnpm-workspace.yaml above ${from}`);
    dir = parent;
  }
  return dir;
}

const root = repositoryRoot(dirname(fileURLToPath(import.meta.url)));

/** The kernel child from source: `main.ts` under the `development` condition with the `.js` → `.ts` resolve hook. */
export const kernelEntry = {
  path: join(root, "packages/kernel-node/src/main.ts"),
  execArgv: [
    "--conditions=development",
    "--import",
    pathToFileURL(join(root, "tools/test/resolve-ts.mjs")).href,
  ],
} as const;
