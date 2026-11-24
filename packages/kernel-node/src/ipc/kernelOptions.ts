// What the daemon passes to createNodeKernel (04-kernel §2, §11) and the settings a kernel derives from it: the
// validated notebook ref, the route base of /n/<name>, the output limits over core's defaults, the Node and the entry.
import { fileURLToPath } from "node:url";

import type { BridgeEvent, ExecutionId, FullValue, Output, Route } from "@jsnb/core";
import { InvalidParams } from "@jsnb/core";
import { z } from "zod";

import type { ChildConfig, ExportEntry, KernelLimits as KernelLimitsType } from "./messages.js";
import { defaultLimits, KernelLimits } from "./messages.js";
import type { Exit, KernelEntry } from "./childProcess.js";
import { routeName, validateNotebookRef } from "./notebookRef.js";

/** An output that arrived while no execute() iteration was taking its execution's events. */
export type LateOutput = {
  readonly execution: ExecutionId;
  readonly output: Output;
  readonly full?: FullValue;
};

/** One flush of the kernel's `emit` queue: the events in order, and per name how many a burst dropped. */
export type EventBatch = {
  readonly events: readonly BridgeEvent[];
  readonly dropped: Readonly<Record<string, number>>;
};

export type NodeKernelOptions = {
  /** The workspace folder, absolute: the kernel's cwd. */
  readonly workspace: string;
  /** The notebook ref (03-api §2), validated: relative, no `..`, a .jsnb file. */
  readonly notebook: string;
  /** The daemon's port, for routeUrl() and route URLs. */
  readonly port: number;
  /** kernel.nodePath; null or absent runs the daemon's own Node. */
  readonly nodePath?: string | null;
  readonly limits?: Partial<KernelLimitsType>;
  /** The kernel script; default the built main.js of this package. */
  readonly entry?: KernelEntry;
  /** How long start() waits for `ready`; default 10 000 ms. */
  readonly startTimeoutMs?: number;
  /** How long stop() waits for the exit after `shutdown` before SIGKILL; default 2 000 ms. */
  readonly stopTimeoutMs?: number;
  readonly onOutput?: (late: LateOutput) => void;
  readonly onExports?: (names: readonly ExportEntry[]) => void;
  readonly onRoutes?: (routes: readonly Route[]) => void;
  /** A flush of `emit(name, data)` calls (05-bridge §6). */
  readonly onEvents?: (batch: EventBatch) => void;
  /** Debugger.paused (true) and Debugger.resumed (false) from the kernel's inspector. */
  readonly onPause?: (paused: boolean) => void;
  /** The child died without stop() or kill(). */
  readonly onExit?: (exit: Exit) => void;
  /** The child's stdout and stderr lines and this side's notices: the kernel log. */
  readonly onLog?: (line: string) => void;
};

export type ResolvedOptions = {
  readonly workspace: string;
  readonly nodePath: string | undefined;
  readonly execPath: string;
  readonly entry: KernelEntry;
  readonly config: ChildConfig;
  readonly startTimeoutMs: number;
  readonly stopTimeoutMs: number;
};

const defaultEntry = (): KernelEntry => ({
  path: fileURLToPath(new URL("../main.js", import.meta.url)),
});

/** The plain-data options (the callbacks are functions the type already checks). */
const PlainOptions = z.object({
  workspace: z.string().min(1),
  notebook: z.string(),
  port: z.number().int().min(0).max(65_535),
  nodePath: z.string().nullable().optional(),
  limits: KernelLimits.unwrap().partial().optional(),
  entry: z
    .object({ path: z.string().min(1), execArgv: z.array(z.string()).readonly().optional() })
    .optional(),
  startTimeoutMs: z.number().int().positive().optional(),
  stopTimeoutMs: z.number().int().nonnegative().optional(),
});

/** The settings of a kernel for `options`; InvalidParams for options that are not valid or a ref that names no notebook. */
export function resolveOptions(options: NodeKernelOptions): ResolvedOptions {
  const parsed = PlainOptions.safeParse(options);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ path, message }) => ({ path, message }));
    throw new InvalidParams({ issues });
  }
  const notebook = validateNotebookRef(options.notebook);
  const limits = { ...defaultLimits(), ...options.limits };
  const routeBase = `http://127.0.0.1:${String(options.port)}/n/${routeName(notebook)}`;
  return {
    workspace: options.workspace,
    nodePath: options.nodePath ?? undefined,
    execPath: options.nodePath ?? process.execPath,
    entry: options.entry ?? defaultEntry(),
    config: { notebook, routeBase, limits },
    startTimeoutMs: options.startTimeoutMs ?? 10_000,
    stopTimeoutMs: options.stopTimeoutMs ?? 2000,
  };
}
