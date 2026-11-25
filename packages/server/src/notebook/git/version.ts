// The oldest git the Source Control commands run on: 2.24, for --end-of-options (switch and restore came in 2.23).
// Asked once per daemon; an older git answers every call with a message that says so. No git at all is not this
// check's business: the status reads it as no repository.
import { GitFailed } from "@jsnb/core";

import type { GitOptions } from "./exec.js";
import { git } from "./exec.js";

const minimum = [2, 24] as const;

let checked: Promise<void> | undefined;

/** git's version as [major, minor], or undefined when git does not run. */
async function versionOf(options: GitOptions): Promise<readonly number[] | undefined> {
  const run = await git(process.cwd(), ["version"], {
    ...options,
    read: true,
    allowFailure: true,
  }).catch(() => undefined);
  if (run?.code !== 0) return undefined;
  const found = /(\d+)\.(\d+)/u.exec(run.stdout.toString("utf8"));
  return found === null ? undefined : found.slice(1).map(Number);
}

async function check(options: GitOptions): Promise<void> {
  const [major = 0, minor = 0] = (await versionOf(options)) ?? [...minimum];
  if (major > minimum[0] || (major === minimum[0] && minor >= minimum[1])) return;
  throw new GitFailed({
    command: "version",
    code: null,
    message: `git ${String(major)}.${String(minor)} is too old: Source Control needs git ${minimum.join(".")} or later`,
  });
}

export function checkVersion(options: GitOptions): Promise<void> {
  checked ??= check(options);
  return checked;
}
