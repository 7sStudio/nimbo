// withWorkspace: a temporary workspace folder with an optional package.json and .env, deleted afterwards,
// once what still writes into it has ended (beforeRemoval: a daemon started over it or over a folder inside it).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

export type Workspace = {
  /** Absolute path of the temporary folder. */
  readonly dir: string;
  /** A path inside the folder. */
  readonly path: (...parts: readonly string[]) => string;
};

export type WorkspaceOptions = {
  /** Written as `package.json` when given. */
  readonly packageJson?: Readonly<Record<string, unknown>>;
  /** Written as `.env` (`KEY=value` lines) when given. */
  readonly env?: Readonly<Record<string, string>>;
};

/** What must end before the folder at each path is removed, by path. */
const endings = new Map<string, (() => Promise<void>)[]>();

/**
 * Has `end` run before the workspace folder holding `dir` (or `dir` itself) is removed. A daemon a test started over
 * a folder and left to stop when the test ended (onTestFinished, after withWorkspace's removal) kept saving and
 * logging into the folder while it was removed: the removal failed ENOTEMPTY and left `nimbo-*` folders behind.
 */
export function beforeRemoval(dir: string, end: () => Promise<void>): void {
  endings.set(dir, [...(endings.get(dir) ?? []), end]);
}

/** Runs and forgets the endings registered for `dir` and every folder inside it; one that fails stops none of the rest. */
async function endWithin(dir: string): Promise<void> {
  const inside = [...endings.keys()].filter((path) => path === dir || path.startsWith(dir + sep));
  const ends = inside.flatMap((path) => endings.get(path) ?? []);
  for (const path of inside) endings.delete(path);
  await Promise.allSettled(ends.map((end) => end()));
}

/** Writes the files `options` gives into `ws`. */
export async function writeWorkspaceFiles(ws: Workspace, options: WorkspaceOptions): Promise<void> {
  if (options.packageJson) {
    await writeFile(ws.path("package.json"), `${JSON.stringify(options.packageJson, null, 2)}\n`);
  }
  if (options.env) {
    const lines = Object.entries(options.env).map(([key, value]) => `${key}=${value}`);
    await writeFile(ws.path(".env"), `${lines.join("\n")}\n`);
  }
}

/** Runs `fn` inside a fresh `mkdtemp` folder and removes the folder afterwards, also when `fn` throws. */
export async function withWorkspace<T>(
  fn: (ws: Workspace) => Promise<T>,
  options: WorkspaceOptions = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "nimbo-"));
  const ws: Workspace = { dir, path: (...parts) => join(dir, ...parts) };
  try {
    await writeWorkspaceFiles(ws, options);
    return await fn(ws);
  } finally {
    await endWithin(dir);
    await rm(dir, { recursive: true, force: true });
  }
}
