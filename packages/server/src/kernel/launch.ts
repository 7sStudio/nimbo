// One kernel of a notebook as the supervisor creates it (04-kernel §2): its options from the supervisor's and the
// settings of the moment (`kernel.nodePath`, the output limits), its callbacks passed on only while it is the
// supervisor's current kernel, so a replaced kernel's late messages reach nobody.
import type { KernelStatus, Route } from "@jsnb/core";
import type {
  Exit,
  ExportEntry,
  KernelEntry,
  KernelLimits,
  LateOutput,
  NodeKernel,
} from "@jsnb/kernel-node";
import { createNodeKernel } from "@jsnb/kernel-node";

import type { Log } from "../events/log.js";

type KernelSink = {
  readonly status: (status: KernelStatus) => void;
  readonly output: (late: LateOutput) => void;
  readonly exports: (names: readonly ExportEntry[]) => void;
  readonly routes: (routes: readonly Route[]) => void;
  /** The kernel is gone (it died, or a restart killed it): its exports and routes with it. */
  readonly ended: () => void;
  readonly log: (line: string) => void;
};

export type SupervisorOptions = {
  readonly workspace: string;
  readonly notebook: string;
  readonly port: () => number;
  readonly entry: KernelEntry | undefined;
  /** `kernel.nodePath` and the output limits, read at each kernel's creation. */
  readonly config: () => { readonly nodePath: string | null; readonly limits: KernelLimits };
  readonly now: () => Date;
  readonly sink: KernelSink;
  readonly log: Log;
};

/** What the supervisor hears from the kernel it launches. */
export type LaunchHooks = {
  /** Whether this kernel is still the supervisor's current one. */
  readonly current: () => boolean;
  readonly paused: (paused: boolean) => void;
  readonly exit: (exit: Exit) => void;
};

/** A new kernel, not started. */
export function launchKernel(options: SupervisorOptions, hooks: LaunchHooks): NodeKernel {
  const { nodePath, limits } = options.config();
  const { sink } = options;
  const whileCurrent =
    <T>(pass: (value: T) => void) =>
    (value: T): void => {
      if (hooks.current()) pass(value);
    };
  return createNodeKernel({
    ...{ workspace: options.workspace, notebook: options.notebook, nodePath, limits },
    port: options.port(),
    ...(options.entry === undefined ? {} : { entry: options.entry }),
    onOutput: whileCurrent(sink.output),
    onExports: whileCurrent(sink.exports),
    onRoutes: whileCurrent(sink.routes),
    onPause: whileCurrent(hooks.paused),
    onExit: hooks.exit,
    onLog: sink.log,
  });
}
