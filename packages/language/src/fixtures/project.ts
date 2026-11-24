// A language project over real cells in a temporary workspace: the real TypeScript
// service, the repository's own @types/node as the daemon's fallback, files written as a package manager leaves them.
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import type { CellId, CellPosition } from "@jsnb/core";
import { withWorkspace } from "@jsnb/test-tools/workspace";

import type { EnvNames, LanguageProject } from "../project.js";
import { createLanguageProject } from "../project.js";
import type { LanguageCell } from "../types.js";

const nodeTypes = dirname(
  dirname(createRequire(import.meta.url).resolve("@types/node/package.json")),
);

export const server = (id: string, source: string): LanguageCell => ({
  id,
  type: "server",
  source,
});
export const client = (id: string, source: string): LanguageCell => ({
  id,
  type: "client",
  source,
});

export type TestProject = LanguageProject & {
  readonly root: string;
  /** Writes `text` at `path` inside the workspace. */
  readonly write: (path: string, text: string) => Promise<void>;
};

type Options = {
  readonly files?: Readonly<Record<string, string>>;
  readonly env?: EnvNames;
  /** Leaves out the fallback @types/node, as a daemon whose own copy could not be found. */
  readonly noFallback?: boolean;
};

/** Runs `fn` with a project over `cells` in a fresh workspace, disposed and removed afterwards. */
export async function withProject<T>(
  cells: readonly LanguageCell[],
  fn: (project: TestProject) => Promise<T> | T,
  options: Options = {},
): Promise<T> {
  return withWorkspace(async (ws) => {
    const root = await realpath(ws.dir);
    const write = async (path: string, text: string): Promise<void> => {
      await mkdir(dirname(`${root}/${path}`), { recursive: true });
      await writeFile(`${root}/${path}`, text);
    };
    for (const [path, text] of Object.entries(options.files ?? {})) await write(path, text);
    const project = createLanguageProject({
      root,
      notebook: "demo.jsnb",
      fallbackTypeRoots: options.noFallback ? [] : [nodeTypes],
    });
    project.sync(cells, options.env);
    try {
      return await fn({ ...project, root, write });
    } finally {
      project.dispose();
    }
  });
}

/** The position in `source` right after the first `needle` (or `offset` characters into it). */
export function after(source: string, needle: string, offset = needle.length): CellPosition {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`${needle} not in the source`);
  const before = source.slice(0, index + offset).split("\n");
  return { line: before.length - 1, character: (before.at(-1) ?? "").length };
}

/** The messages of a cell's diagnostics. */
export const messages = (project: LanguageProject, cell: CellId): string[] =>
  project.diagnostics(cell).flatMap((entry) => entry.diagnostics.map((d) => d.message));
