// The kernel's watchdog (04-kernel §2): a worker thread that kills the kernel once the daemon that started it is gone.
// The kernel also exits on its IPC disconnect, but that handler runs on the main thread's event loop, which a cell that
// spins never gives back: such kernels outlived their daemon at 100 % CPU (three test kernels, still spinning 10 h
// later). The worker has an event loop of its own, reads the parent pid twice a second and sends SIGKILL, which no
// cell can catch, delay or replace; its isolate shares nothing a cell can reach. It kills the kernel's process group, so
// what the kernel's cells started ends with it (the pid alone where the kernel leads no group). A parent pid can change
// while the daemon lives (on macOS a native debugger attaching with ptrace becomes the parent), so the watchdog kills
// only once the original parent is gone too, or the new parent is pid 1 (init or launchd took the orphan, which also
// covers an original parent pid reused by another process). A kernel whose worker cannot start runs without it and
// says so in its log.
import { Worker } from "node:worker_threads";

import { notice } from "./ipc/notice.js";

/** What `kill(pid, 0)` says of `pid`: gone only on ESRCH; EPERM (another user's process) or no error means it exists. */
export function pidGone(pid: number, kill: (pid: number, signal: number) => unknown): boolean {
  try {
    kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && Reflect.get(error, "code") === "ESRCH";
  }
}

/**
 * The watchdog's decision: the parent pid changed from `parent` to `now`, and either `now` is 1 (init or launchd took
 * the orphan) or `parent` itself is gone.
 */
export function daemonGone(parent: number, now: number, gone: (pid: number) => boolean): boolean {
  return now !== parent && (now === 1 || gone(parent));
}

/** SIGKILL to the kernel's process group, or to its pid when it leads none (`kill` is process.kill). */
export function killKernel(pid: number, kill: (pid: number, signal: string) => unknown): void {
  try {
    kill(-pid, "SIGKILL");
  } catch {
    kill(pid, "SIGKILL");
  }
}

/** The worker's whole body: the functions above, checked every `everyMs`. */
const body = `const { parent, pid, everyMs } = require("node:worker_threads").workerData;
const pidGone = ${pidGone.toString()};
const daemonGone = ${daemonGone.toString()};
const killKernel = ${killKernel.toString()};
const gone = (target) => pidGone(target, (p, s) => process.kill(p, s));
setInterval(() => { if (daemonGone(parent, process.ppid, gone)) killKernel(pid, (p, s) => process.kill(p, s)); }, everyMs);`;

const failed = (error: unknown): string =>
  notice(
    "the watchdog could not start: this kernel outlives a daemon that dies while a cell spins",
    {
      error: error instanceof Error ? error.message : String(error),
    },
  );

/**
 * Starts the watchdog of `proc`, the kernel's process, whose parent is its daemon; it never keeps the kernel alive. A
 * worker that cannot start (Node's permission model without --allow-worker, a thread limit) is one notice to `log`.
 */
export function startWatchdog(
  proc: { readonly pid: number; readonly ppid: number },
  log: (line: string) => void,
): void {
  const workerData = { parent: proc.ppid, pid: proc.pid, everyMs: 500 };
  try {
    const worker = new Worker(body, { eval: true, name: "nimbo kernel watchdog", workerData });
    worker.on("error", (error) => {
      log(failed(error));
    });
    worker.unref();
  } catch (error) {
    log(failed(error));
  }
}
