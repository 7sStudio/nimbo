// launch() over a fresh workspace for the integration tests (09-testing §3): the workspace prepared and scripts
// written first (a stub Node, for the one failure no real Node produces on demand: a version older than 26), the real
// kernel otherwise, with Node flags of its own where a test needs them; the log recorded with waiters, and whatever
// child the start forked killed when the test ends. A daemon-side context over the started session sends interrupts.
import { chmod, writeFile } from "node:fs/promises";

import { kernelEntry } from "@jsnb/test-tools/kernel";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { onTestFinished } from "vitest";

import type { Forked } from "../ipc/childProcess.js";
import { createExecutions } from "../ipc/executions.js";
import type { NodeKernelOptions } from "../ipc/kernelOptions.js";
import { resolveOptions } from "../ipc/kernelOptions.js";
import type { Context, Session } from "../ipc/kernelState.js";
import { createContext } from "../ipc/kernelState.js";
import { launch } from "../ipc/launch.js";
import { createRequests } from "../ipc/requests.js";

type Start = {
  readonly session: Promise<Session>;
  readonly forked: () => Forked | undefined;
  /** Resolves with the first log line that matches, now or later. */
  readonly logged: (match: (line: string) => boolean) => Promise<string>;
};

type Case = {
  /** Executable files written into the workspace before the start: a stub Node. */
  readonly scripts?: Readonly<Record<string, string>>;
  /** What else the workspace holds before the start (a .env that is a directory, say). */
  readonly prepare?: (ws: Workspace) => void;
  readonly options?: (ws: Workspace) => Partial<NodeKernelOptions>;
  /** What `ended()` answers, given the fork so far. */
  readonly ended?: (forked: Forked | undefined) => boolean;
};

function logBook() {
  const logs: string[] = [];
  let wake: () => void = () => undefined;
  const onLog = (line: string): void => {
    logs.push(line);
    wake();
  };
  const logged = (match: (line: string) => boolean): Promise<string> =>
    new Promise((resolve) => {
      const check = (): void => {
        const found = logs.find(match);
        if (found === undefined) wake = check;
        else resolve(found);
      };
      check();
    });
  return { onLog, logged };
}

/** Runs `fn` with a launch over a fresh workspace; whatever child it forked is killed afterwards. */
export async function withLaunch(
  fn: (start: Start, ws: Workspace) => Promise<void>,
  given: Case = {},
) {
  await withWorkspace(async (ws) => {
    for (const [name, text] of Object.entries(given.scripts ?? {})) {
      await writeFile(ws.path(name), text);
      await chmod(ws.path(name), 0o755);
    }
    given.prepare?.(ws);
    const { onLog, logged } = logBook();
    let forked: Forked | undefined;
    const resolved = resolveOptions({
      workspace: ws.dir,
      notebook: "test.jsnb",
      port: 4321,
      entry: kernelEntry,
      ...given.options?.(ws),
    });
    onTestFinished(() => {
      forked?.child.kill("SIGKILL");
    });
    const session = launch(resolved, {
      onLog,
      onChunk: () => undefined,
      onMessage: () => undefined,
      onPause: () => undefined,
      onFork: (fork) => (forked = fork),
      ended: () => given.ended?.(forked) ?? false,
    });
    try {
      await fn({ session, forked: () => forked, logged }, ws);
    } finally {
      forked?.child.kill("SIGKILL");
      await forked?.exited;
    }
  });
}

/** A daemon-side context over the started `session` in `ws`, as a NodeKernel keeps one: interrupts go through it. */
export function daemonContext(session: Session, ws: Workspace): Context {
  const context = createContext(
    { workspace: ws.dir, notebook: "test.jsnb", port: 4321 },
    createExecutions(() => 0),
    createRequests(),
    { chunk: () => undefined, refresh: () => undefined, line: (text) => text },
  );
  context.state.session = session;
  return context;
}

/** True while a process with `pid` exists. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: no such process.
    return false;
  }
}

/** The real kernel entry with `flags` added to its Node flags. */
export const kernelWith = (...flags: string[]) => ({
  entry: { ...kernelEntry, execArgv: [...kernelEntry.execArgv, ...flags] },
});
