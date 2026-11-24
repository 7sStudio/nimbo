// Real git repositories for the Source Control tests: made in the test's temp workspace with the
// real `git`, the user's and the system's config left out and a fixed identity, so a commit is the same on any machine.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterAll, beforeAll } from "vitest";

const isolated: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** Sets the isolated git environment for the file's tests (the daemon runs in the same process). */
export function isolateGit(): void {
  const saved = new Map<string, string | undefined>();
  beforeAll(() => {
    for (const [key, value] of Object.entries(isolated)) {
      saved.set(key, process.env[key]);
      process.env[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });
}

/** Runs git in `cwd` and answers its stdout. */
export const sh = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...isolated },
  });

/** A .jsnb file's text with `cells` (a server cell unless a type is given). */
export const notebookText = (
  cells: readonly { id: string; type?: string; source: string }[],
): string =>
  `${JSON.stringify(
    {
      version: 1,
      cells: cells.map((cell) => ({ type: "server", ...cell, source: cell.source.split("\n") })),
    },
    null,
    2,
  )}\n`;

/** A repository at `dir` on branch main with `.gitignore` (the harness's user config, .jsnb/) and `files` committed. */
export async function makeRepo(
  dir: string,
  files: Readonly<Record<string, string>> = {},
): Promise<void> {
  sh(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, ".gitignore"), ".user-config/\n.jsnb/\n");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "first");
}

/** Waits until `check` holds, polling; throws after `ms`. */
export async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("the condition did not hold in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
