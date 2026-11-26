// The workspace directory `.jsnb/`: created with its .gitignore when missing, with logs/,
// recovery/, cache/npm/ and cache/sql/, each a real folder (a symbolic link among them, as `.jsnb` itself, is
// WorkspaceUnusable: a workspace from someone else could point it elsewhere); the paths of everything the daemon keeps
// there.
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { JsnbError, keybindingsFileName, settingsFileName } from "@jsnb/core";

/** Everything but the shared settings and keybindings stays out of git. */
const jsnbGitignore = `*\n!.gitignore\n!${settingsFileName}\n!${keybindingsFileName}\n`;
/** The .gitignore nimbo wrote before keybindings.json: replaced by the current one, never a user's own. */
const formerGitignore = `*\n!.gitignore\n!${settingsFileName}\n`;

/** The paths of a workspace's `.jsnb/` folder. */
export type JsnbDir = {
  readonly root: string;
  readonly dir: string;
  readonly serverFile: string;
  readonly settingsFile: string;
  readonly logs: string;
  readonly recovery: string;
  readonly npmCache: string;
  readonly sqlCache: string;
};

/** The paths of `<root>/.jsnb/`. */
function jsnbDirOf(root: string): JsnbDir {
  const dir = join(root, ".jsnb");
  return {
    root,
    dir,
    serverFile: join(dir, "server.json"),
    settingsFile: join(dir, settingsFileName),
    logs: join(dir, "logs"),
    recovery: join(dir, "recovery"),
    npmCache: join(dir, "cache", "npm"),
    sqlCache: join(dir, "cache", "sql"),
  };
}

type Where = { readonly path: string; readonly reason: string; readonly remedy?: string };
const unusableMessage = ({ path, reason, remedy = "Remove it" }: Where): string =>
  `The workspace folder ${path} cannot be used: ${reason}. ${remedy} or start nimbo in another folder.`;

/** `.jsnb` exists but is not a folder the daemon may write into (a file, a symbolic link, a folder it may not write). */
export class WorkspaceUnusable extends JsnbError {
  declare readonly data: Where;
  constructor(data: Where, options: { readonly cause?: unknown } = {}) {
    super({ name: "WorkspaceUnusable", message: unusableMessage(data), data, ...options });
  }
}

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The workspace folder given to the daemon does not exist or is not a folder. */
export class WorkspaceMissing extends JsnbError {
  declare readonly data: { readonly path: string };
  constructor(data: { readonly path: string }, options: { readonly cause?: unknown } = {}) {
    super({
      name: "WorkspaceMissing",
      message: `The workspace folder ${data.path} does not exist or is not a folder. Create it, or start nimbo in an existing folder.`,
      data,
      ...options,
    });
  }
}

/** The real path of the workspace folder `path`; WorkspaceMissing when there is no folder there. */
export async function resolveWorkspace(path: string): Promise<string> {
  try {
    const real = await realpath(path);
    if ((await stat(real)).isDirectory()) return real;
  } catch (error) {
    throw new WorkspaceMissing({ path }, { cause: error });
  }
  throw new WorkspaceMissing({ path });
}

/**
 * A folder of `.jsnb` (itself included): a real folder, never a symbolic link. Made first and checked after, so two
 * daemons starting at the same moment both find the folder one of them made.
 */
async function ensureFolder(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error; // there already, or made by a daemon starting beside this one
  }
  const stats = await lstat(path);
  if (stats.isSymbolicLink())
    throw new WorkspaceUnusable({ path, reason: "it is a symbolic link" });
  if (!stats.isDirectory()) throw new WorkspaceUnusable({ path, reason: "it is not a folder" });
}

/** The .gitignore when it is missing (it keeps server.json's token out of git); an existing one stays, unless it is
 * the one an earlier nimbo wrote, word for word. */
async function ensureGitignore(dir: string): Promise<void> {
  const path = join(dir, ".gitignore");
  try {
    await writeFile(path, jsnbGitignore, { flag: "wx" });
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error;
    if ((await readFile(path, "utf8").catch(() => "")) === formerGitignore)
      await writeFile(path, jsnbGitignore);
  }
}

/** The file system's refusals of a write: the folder (or the disk) is not the daemon's to write into. */
const refusals = new Set(["EACCES", "EPERM", "EROFS"]);

/** Creates what is missing of `<root>/.jsnb/`; a folder the daemon may not write into is WorkspaceUnusable with what
 * to do about it, never a bare EACCES. */
export async function prepareJsnbDir(root: string): Promise<JsnbDir> {
  const paths = jsnbDirOf(root);
  try {
    await ensureFolder(paths.dir);
    await ensureGitignore(paths.dir);
    for (const folder of [
      paths.logs,
      paths.recovery,
      join(paths.dir, "cache"),
      paths.npmCache,
      paths.sqlCache,
    ]) {
      await ensureFolder(folder);
    }
  } catch (error) {
    const code = codeOf(error);
    if (typeof code !== "string" || !refusals.has(code)) throw error;
    const reason = `nimbo may not write into it (${code})`;
    const remedy = "Make it writable (and the folder that holds it)";
    throw new WorkspaceUnusable({ path: paths.dir, reason, remedy }, { cause: error });
  }
  return paths;
}
