// What a kernel does once its daemon is gone (04-kernel §2), on its main thread: the IPC disconnect handler, which an
// idle or awaiting kernel runs at once (a spinning one never does; its watchdog thread acts instead, watchdog.ts). On
// POSIX it sends SIGKILL to the process group the kernel leads, itself included, so what its cells started (a dev
// server, a `sleep`) ends with it, as the daemon's kill would have ended it. It exits alone on Windows, which has no
// group a kill can name, and where the kernel leads none (a parent forked it into the parent's own group).

/** The slice of `process` the handler reads when it is made, at start, before any cell can replace process.kill. */
export type DepartingProcess = {
  readonly pid: number;
  readonly platform: string;
  kill(pid: number, signal: string): unknown;
};

/** The disconnect handler of `proc`, over the process.kill captured now and the kernel's own `exit`. */
export function departure(proc: DepartingProcess, exit: (code: number) => void): () => void {
  const kill = proc.kill.bind(proc);
  const { pid, platform } = proc;
  return () => {
    if (platform !== "win32") {
      try {
        kill(-pid, "SIGKILL");
        return;
      } catch {
        // No group of its own to end: the kernel exits alone.
      }
    }
    exit(0);
  };
}
