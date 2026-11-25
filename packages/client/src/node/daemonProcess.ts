// The process of a daemon that server.json names but that does not answer (stopped with SIGSTOP, or hung), shared by
// the CLI and the MCP server: its pid is taken as the workspace's daemon only when `ps` shows a process with
// `--workspace <this folder>` on its command line that started before server.json's startedAt, so a pid the system
// gave to another process since is never signalled.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { ServerFile } from "@jsnb/core";

const run = promisify(execFile);

/** How much later than its process a daemon may write server.json's startedAt (its start takes well under that). */
const startSlackMs = 60_000;

async function psField(pid: number, field: "lstart" | "args"): Promise<string | undefined> {
  try {
    const { stdout } = await run("ps", ["-p", String(pid), "-o", `${field}=`], {
      env: { ...process.env, LC_ALL: "C" },
    });
    const value = stdout.trim();
    return value === "" ? undefined : value;
  } catch {
    // No such process, or no ps (Windows): nothing proves it is the daemon.
    return undefined;
  }
}

async function folders(workspace: string): Promise<readonly string[]> {
  const real = await realpath(workspace).catch(() => workspace);
  return [...new Set([workspace, real])];
}

/** Whether `file.pid` is the daemon `file` describes for `workspace`, not a process that took its pid since. */
export async function isOwnDaemon(
  file: Pick<ServerFile, "pid" | "startedAt">,
  workspace: string,
): Promise<boolean> {
  const [args, started] = await Promise.all([
    psField(file.pid, "args"),
    psField(file.pid, "lstart"),
  ]);
  if (args === undefined || started === undefined) return false;
  const named = (await folders(workspace)).some((folder) => args.includes(`--workspace ${folder}`));
  const startedAt = Date.parse(started);
  const wrote = Date.parse(file.startedAt);
  if (!named || Number.isNaN(startedAt) || Number.isNaN(wrote)) return false;
  return startedAt <= wrote + 1000 && wrote - startedAt <= startSlackMs;
}

/** Whether a process `pid` exists (EPERM: it does, and belongs to another user). */
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && Reflect.get(error, "code") === "EPERM";
  }
};

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function gone(pid: number, ms: number): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (!isAlive(pid)) return true;
    await pause(100);
  }
  return !isAlive(pid);
}

const signal = (pid: number, name: NodeJS.Signals): void => {
  try {
    process.kill(pid, name);
  } catch {
    // Ended meanwhile.
  }
};

/** Ends a silent daemon by its pid: SIGCONT (a stopped one acts on nothing else), SIGTERM, then SIGKILL after 5 s. */
export async function endSilent(pid: number): Promise<boolean> {
  signal(pid, "SIGCONT");
  signal(pid, "SIGTERM");
  if (await gone(pid, 5000)) return true;
  signal(pid, "SIGKILL");
  return gone(pid, 5000);
}
