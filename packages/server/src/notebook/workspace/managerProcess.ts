// The package manager's process for packages.add: run without a shell in the workspace, each output line
// handed on, in a process group of its own on POSIX, so a kill (the install timeout, the daemon's stop) reaches the
// lifecycle scripts it started too, as kernel-node does for kernels. Windows has no
// process group a kill can name: there the manager alone is killed, and a script it started may outlive it. A manager
// that exited while a process it left still holds its pipes is waited for until the run aborts; the abort then kills
// that group and rejects at once.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { managerPath } from "../../files/packages/manager.js";

const ownGroup = process.platform !== "win32";

/** What the run has seen of the manager: its exit, and the close of its pipes. */
type Seen = { exited: boolean; closed: boolean };

/**
 * SIGKILL to the manager's group (it and its scripts), else to it alone. Once its pipes closed, nothing: its pid may
 * name another process by then. While a process of the group still holds a pipe, the group (and so its id) exists,
 * so it is signalled even after the manager's own exit.
 */
function killManager(child: ChildProcess, seen: Seen): void {
  if (seen.closed) return;
  if (ownGroup && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // No group left to signal: the manager alone, below.
    }
  }
  if (!seen.exited) child.kill("SIGKILL");
}

export type ManagerRun = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Aborts the run: the timeout or the daemon's stop. */
  readonly signal: AbortSignal;
  readonly onLine: (line: string) => void;
};

/** The abort's reason as an Error. */
const reasonOf = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error("aborted");

/**
 * Runs the manager; resolves its exit code once its output is read. Once `signal` aborts, its group is killed and the
 * call rejects with the signal's reason as soon as the manager exited, at once when it had already: never waiting for
 * a pipe that a process it left behind still holds.
 */
export function runManager(run: ManagerRun): Promise<number | null> {
  const child = spawn(run.command, [...run.args], {
    cwd: run.cwd,
    detached: ownGroup,
    stdio: ["ignore", "pipe", "pipe"],
    // Windows names it Path, and a copy holding both is ambiguous
    env: {
      ...process.env,
      ...(process.platform === "win32" ? {} : { PATH: managerPath() }),
      CI: "1",
    },
  });
  for (const stream of [child.stdout, child.stderr])
    createInterface({ input: stream }).on("line", run.onLine);
  const seen: Seen = { exited: false, closed: false };
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      killManager(child, seen);
      if (seen.exited) reject(reasonOf(run.signal)); // its pipes may stay open: no wait for them
    };
    run.signal.addEventListener("abort", abort, { once: true });
    if (run.signal.aborted) abort();
    child.once("error", reject);
    child.once("exit", () => {
      seen.exited = true;
      if (run.signal.aborted) reject(reasonOf(run.signal)); // a manager that ended on its own resolves at `close`
    });
    child.once("close", (code) => {
      seen.closed = true;
      run.signal.removeEventListener("abort", abort);
      resolve(code);
    });
  });
}
