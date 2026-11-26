// The Kernel interface and the shapes of its messages, shared by both realms.
import { z } from "zod";

import type { Binding, BindingValue } from "./binding.js";
import { BindingKind } from "./binding.js";
import { SnapshotBinding } from "./bridge.js";
import { ExecStatus } from "./execution.js";
import { CellId, ExecutionId } from "./ids.js";
import { ErrorInfo, Output } from "./output.js";

export const ExecuteRequest = z
  .object({
    execution: ExecutionId,
    cell: CellId,
    code: z.string(),
    map: z.string(),
    bindings: z.record(z.string(), SnapshotBinding).optional(),
    /** The run's `analysis.defines`, so the kernel reports `Binding.definedBy` exactly. */
    defines: z.array(z.string()).readonly().optional(),
    /** The run's `analysis.kinds`, so the kernel reports `Binding.kind` (the kernel has no analyser). */
    kinds: z.record(z.string(), BindingKind).optional(),
  })
  .readonly();
export type ExecuteRequest = z.infer<typeof ExecuteRequest>;

/** The uncapped wire form of a truncated `value` output, for the daemon to retain. */
export const FullValue = z.object({ json: z.unknown(), truncated: z.boolean() }).readonly();
export type FullValue = z.infer<typeof FullValue>;

export const KernelEvent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("output"),
    execution: ExecutionId,
    output: Output,
    full: FullValue.optional(),
  }),
  z.object({
    kind: z.literal("status"),
    execution: ExecutionId,
    status: ExecStatus,
    error: ErrorInfo.optional(),
    durationMs: z.number(),
  }),
]);
export type KernelEvent = z.infer<typeof KernelEvent>;

/**
 * A forwarded HTTP request for a `route()` handler: `path` below the notebook's name in its route form (routePath),
 * `search` the query as the URL parser keeps it (`""` or `?a=1&a=2`, a repeated name and its order kept), `rawBody`
 * base64 so signatures still verify.
 */
export const RouteRequest = z
  .object({
    method: z.string(),
    path: z.string(),
    search: z.string(),
    headers: z.record(z.string(), z.string()),
    rawBody: z.string(),
  })
  .readonly();
export type RouteRequest = z.infer<typeof RouteRequest>;

/** A `route()` handler's answer; `body` is base64 so binary responses survive, and `set-cookie` may be a list. */
export const RouteResponse = z
  .object({
    status: z.number().int(),
    headers: z.record(z.string(), z.union([z.string(), z.array(z.string()).readonly()])),
    body: z.string(),
  })
  .readonly();
export type RouteResponse = z.infer<typeof RouteResponse>;

/** A bridge call's result: the wire form of the value and whether redaction changed it. */
export const CallResult = z.object({ value: z.unknown(), redacted: z.boolean() }).readonly();
export type CallResult = z.infer<typeof CallResult>;

export type BindingsOptions = { readonly names?: readonly string[]; readonly full?: boolean };

/** `bindings()` lists the scope (all names, or `names`); with `full: true` each binding carries its value. */
export type BindingsQuery = {
  (options: BindingsOptions & { readonly full: true }): Promise<readonly BindingValue[]>;
  (options?: BindingsOptions): Promise<readonly Binding[]>;
};

/**
 * A context Node enters from JavaScript: a timer's or an immediate's callback, process.nextTick's
 * TickObject, an AsyncResource scope, a promise job under an async hook. An interrupt does not stop user code there.
 */
export const InterruptContext = z.enum([
  "Immediate",
  "Timeout",
  "TickObject",
  "AsyncResource",
  "Promise",
]);
export type InterruptContext = z.infer<typeof InterruptContext>;

export type Kernel = {
  readonly start: () => Promise<{ readonly inspectorUrl?: string }>;
  readonly execute: (req: ExecuteRequest) => AsyncIterable<KernelEvent>;
  readonly call: (fn: string, args: readonly unknown[]) => Promise<CallResult>;
  readonly snapshot: (names: readonly string[]) => Promise<Record<string, SnapshotBinding>>;
  readonly bindings: BindingsQuery;
  readonly handleRoute: (req: RouteRequest) => Promise<RouteResponse>;
  /** Runs the disposers of a deleted cell: its routes, timers and listeners end; its scope stays. */
  readonly dispose: (cell: CellId) => Promise<void>;
  /**
   * Stops the user code that runs. A Node kernel rejects with InterruptRefused when that code runs in
   * an InterruptContext, where stopping it would end the kernel: it keeps running until a restart.
   */
  readonly interrupt: () => Promise<void>;
  readonly stop: () => Promise<void>;
};
