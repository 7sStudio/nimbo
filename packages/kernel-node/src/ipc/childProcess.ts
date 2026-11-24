// Forking a kernel child (04-kernel §2): the entry under --inspect=127.0.0.1:0 with the child config as argv[2], IPC
// with advanced serialization, stdout and stderr lines to the log, kernel messages validated with Zod (a failure is a
// log notice), and the start settled by `ready`, an exit before it, or the start timeout. On POSIX the kernel leads a
// process group of its own, which every kill of it signals and which is signalled again when it exits, so the
// processes its cells started (a dev server, execSync's child) end with it rather than outliving it with their ports;
// once its exit was seen, no kill signals anything, since its pid may then name another process.
import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { createInterface } from "node:readline";

import { KernelDead } from "@jsnb/core";

import { KernelStartTimeout } from "./errors.js";
import type { ChildConfig } from "./messages.js";
import { KernelMessage } from "./messages.js";
import { notice } from "./notice.js";

type Ready = Extract<KernelMessage, { type: "ready" }>;
export type Exit = { readonly exitCode?: number; readonly signal?: string };

/** The script a kernel runs and the Node flags it needs besides --inspect. */
export type KernelEntry = { readonly path: string; readonly execArgv?: readonly string[] };

export type ForkOptions = {
  readonly workspace: string;
  readonly execPath: string;
  readonly entry: KernelEntry;
  readonly config: ChildConfig;
  readonly timeoutMs: number;
  /** Every line the child writes to stdout or stderr, and the notices of this side. */
  readonly onLog: (line: string) => void;
  /** Before each chunk the child writes to stdout or stderr (the log's redactor may rebuild). */
  readonly onChunk: () => void;
  /** Every valid message but the first `ready`. */
  readonly onMessage: (message: KernelMessage) => void;
};

export type Forked = {
  readonly child: ChildProcess;
  /** The `ready` message; KernelDead when the child exits first, KernelStartTimeout (once it is killed) on timeout. */
  readonly ready: Promise<Ready>;
  /** The child's exit, also when it could not be spawned; never rejects. */
  readonly exited: Promise<Exit>;
};

/** POSIX only: Windows has no process group a kill can name, so a kernel there is forked and killed by its pid alone. */
const ownGroup = process.platform !== "win32";

/** True once Node saw the child exit (its exit code or signal is set): from then on its pid can be reused. */
const exitSeen = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

/** SIGKILL to the group the kernel `pid` leads, which outlives it; false where there is none (Windows, none left). */
function signalGroup(pid: number | undefined): boolean {
  if (!ownGroup || pid === undefined) return false;
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch {
    // No group left: the group's last process is gone.
    return false;
  }
}

/**
 * SIGKILL to the kernel's process group: the kernel and whatever its cells started that stayed in the group (a process
 * that left it, `detached` or `setsid`, is the user's choice). The kernel's pid alone where it has no group (Windows),
 * or none is left. Nothing once the kernel's exit was seen: the exit handler signalled the group then, and the pid may
 * since name another process (a kill() or a restart after the kernel died on its own would have signalled it).
 */
export function killGroup(child: ChildProcess): void {
  if (exitSeen(child)) return;
  if (!signalGroup(child.pid)) child.kill("SIGKILL");
}

const exitOf = (code: number | null, signal: string | null): Exit => ({
  ...(code === null ? {} : { exitCode: code }),
  ...(signal === null ? {} : { signal }),
});

function spawn(options: ForkOptions): ChildProcess {
  const child = fork(options.entry.path, [JSON.stringify(options.config)], {
    cwd: options.workspace,
    execPath: options.execPath,
    execArgv: ["--inspect=127.0.0.1:0", ...(options.entry.execArgv ?? [])],
    serialization: "advanced",
    detached: ownGroup,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    stream.on("data", options.onChunk); // registered first: it runs before readline cuts the chunk into lines
    createInterface({ input: stream }).on("line", options.onLog);
  }
  return child;
}

/** The exit, or the spawn failure (Node then emits `error` and no `exit`) with its cause. */
function exitedOf(child: ChildProcess, onLog: (line: string) => void) {
  let cause: Error | undefined;
  const exited = new Promise<Exit>((resolve) => {
    child.on("exit", (code, signal) => {
      // The group outlives its leader: what the kernel's cells started ends with the kernel, whatever ended it. At this
      // moment the pid names that group or nothing: none of its processes is gone yet, or the group is.
      signalGroup(child.pid);
      resolve(exitOf(code, signal));
    });
    child.on("error", (error) => {
      if (child.pid !== undefined)
        onLog(notice("the kernel process failed", { error: error.message }));
      else {
        cause = error;
        resolve({});
      }
    });
  });
  return { exited, cause: () => cause };
}

/** Forks the kernel; `ready` settles the start. */
export function forkKernel(options: ForkOptions): Forked {
  const child = spawn(options);
  const { exited, cause } = exitedOf(child, options.onLog);
  const ready = new Promise<Ready>((resolve, reject) => {
    let started = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, options.timeoutMs);
    child.on("message", (raw) => {
      const parsed = KernelMessage.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(({ path, message }) => ({ path, message }));
        options.onLog(notice("a kernel message failed validation and was ignored", { issues }));
      } else if (started || parsed.data.type !== "ready") options.onMessage(parsed.data);
      else {
        started = true;
        clearTimeout(timer);
        resolve(parsed.data);
      }
    });
    void exited.then((exit) => {
      clearTimeout(timer);
      const error = cause();
      if (timedOut) reject(new KernelStartTimeout({ timeoutMs: options.timeoutMs }));
      else reject(new KernelDead(exit, error === undefined ? {} : { cause: error }));
    }); // a no-op once ready resolved: the exit after it is the caller's to handle
  });
  return { child, ready, exited };
}
