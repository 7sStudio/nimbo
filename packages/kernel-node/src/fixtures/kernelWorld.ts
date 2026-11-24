// A real kernel for the integration tests (09-testing §3): createNodeKernel over a fresh withWorkspace folder with the
// child from source (kernelEntry), every callback recorded, and the kernel killed when the test ends, failed, passed or
// timed out (a test Vitest's timeout abandoned never reaches its finally, and its kernel would spin on).
import { chmod, writeFile } from "node:fs/promises";

import type { KernelEvent, Route } from "@jsnb/core";
import type { CompiledCell } from "@jsnb/test-tools/kernel";
import { kernelEntry } from "@jsnb/test-tools/kernel";
import type { Workspace, WorkspaceOptions } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { onTestFinished } from "vitest";

import type { Exit } from "../ipc/childProcess.js";
import type { LateOutput, NodeKernelOptions } from "../ipc/kernelOptions.js";
import type { ExportEntry } from "../ipc/messages.js";
import type { NodeKernel } from "../ipc/nodeKernel.js";
import { createNodeKernel } from "../nodeKernel.js";

/** Everything the kernel's callbacks reported, in order. */
type Seen = {
  readonly logs: string[];
  readonly late: LateOutput[];
  readonly exits: Exit[];
  readonly pauses: boolean[];
  readonly exports: (readonly ExportEntry[])[];
  readonly routes: (readonly Route[])[];
};

export type KernelWorld = {
  readonly kernel: NodeKernel;
  readonly ws: Workspace;
  readonly seen: Seen;
  /** Resolves once `accept` holds, checked now and after every callback. */
  readonly until: (accept: (seen: Seen) => boolean) => Promise<void>;
  /** Runs a compiled cell to its terminal status and returns its events. */
  readonly run: (cell: CompiledCell) => Promise<readonly KernelEvent[]>;
  /** Writes an executable file into the workspace and returns its path (a fake entry or a fake node). */
  readonly script: (name: string, text: string) => Promise<string>;
};

export type WorldOptions = WorkspaceOptions & {
  /** Kernel options over the defaults; a function gets the workspace (for entries and Nodes written into it). */
  readonly kernel?: Partial<NodeKernelOptions> | ((ws: Workspace) => Partial<NodeKernelOptions>);
  /** False leaves start() to the test. */
  readonly start?: boolean;
};

function recorder() {
  const seen: Seen = { logs: [], late: [], exits: [], pauses: [], exports: [], routes: [] };
  let waiters: (() => void)[] = [];
  const record =
    <T>(list: T[]) =>
    (item: T): void => {
      list.push(item);
      for (const wake of waiters.splice(0)) wake();
    };
  const until = (accept: (seen: Seen) => boolean): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (accept(seen)) resolve();
        else waiters.push(check);
      };
      check();
    });
  const callbacks = {
    onLog: record(seen.logs),
    onOutput: record(seen.late),
    onExit: record(seen.exits),
    onPause: record(seen.pauses),
    onExports: record(seen.exports),
    onRoutes: record(seen.routes),
  };
  return { seen, until, callbacks, forget: () => (waiters = []) };
}

/** Runs `fn` with a kernel over a fresh workspace (started unless `start: false`), killed afterwards. */
export function withKernel<T>(
  fn: (world: KernelWorld) => Promise<T>,
  options: WorldOptions = {},
): Promise<T> {
  return withWorkspace(async (ws) => {
    const { seen, until, callbacks, forget } = recorder();
    const kernel = createNodeKernel({
      ...{ workspace: ws.dir, notebook: "test.jsnb", port: 4321, entry: kernelEntry },
      ...callbacks,
      ...(typeof options.kernel === "function" ? options.kernel(ws) : options.kernel),
    });
    onTestFinished(() => kernel.kill());
    const run = async (cell: CompiledCell): Promise<readonly KernelEvent[]> => {
      const events: KernelEvent[] = [];
      for await (const event of kernel.execute(cell)) events.push(event);
      return events;
    };
    const script = async (name: string, text: string): Promise<string> => {
      await writeFile(ws.path(name), text);
      await chmod(ws.path(name), 0o755);
      return ws.path(name);
    };
    try {
      if (options.start !== false) await kernel.start();
      return await fn({ kernel, ws, seen, until, run, script });
    } finally {
      forget();
      await kernel.kill();
    }
  }, options);
}
