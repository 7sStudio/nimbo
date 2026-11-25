// The daemon ↔ kernel messages of 04-kernel §2.1 as Zod schemas, both directions, and the child's start config.
import {
  BridgeEvent,
  CellId,
  ErrorInfo,
  ExecStatus,
  ExecuteRequest,
  ExecutionId,
  FullValue,
  InvalidParams,
  Output,
  Route,
  RouteRequest,
  settingsDefaults,
} from "@jsnb/core";
import { z } from "zod";

/** The output limits of 03-api §4.10 the kernel applies (04-kernel §5). */
export const KernelLimits = z
  .object({
    maxValueBytes: z.number().int().positive(),
    maxStreamBytes: z.number().int().positive(),
    maxBytesPerValue: z.number().int().positive(),
    retainFullValue: z.boolean(),
    retainMaxBytes: z.number().int().positive(),
  })
  .readonly();
export type KernelLimits = z.infer<typeof KernelLimits>;

/** The limits from core's settings defaults. */
export function defaultLimits(): KernelLimits {
  const settings = settingsDefaults();
  return {
    maxValueBytes: settings["outputs.maxValueBytes"],
    maxStreamBytes: settings["outputs.maxStreamBytes"],
    maxBytesPerValue: settings["bridge.maxBytesPerValue"],
    retainFullValue: settings["outputs.retainFullValue"],
    retainMaxBytes: settings["outputs.retainMaxBytes"],
  };
}

/** What the daemon passes to the child as `argv[2]` JSON (04-kernel §2). */
export const ChildConfig = z
  .object({ notebook: z.string().min(1), routeBase: z.string().min(1), limits: KernelLimits })
  .readonly();
export type ChildConfig = z.infer<typeof ChildConfig>;

const RequestId = z.number().int().nonnegative();
/** A per-request byte limit for the bridge (05-bridge §2): bytes cross whole up to it. */
const BytesLimit = z.number().int().positive();
const Names = z.array(z.string()).readonly();

/**
 * Daemon → kernel. `call.args` is the wire form of the whole argument array (05-bridge §9), itself an array: the
 * kernel decodes its elements.
 */
export const DaemonMessage = z.discriminatedUnion("type", [
  ExecuteRequest.unwrap().extend({ type: z.literal("execute") }),
  z.object({
    type: z.literal("call"),
    id: RequestId,
    fn: z.string(),
    args: z.array(z.unknown()).readonly(),
    /** The notebook's `bridge.maxBytesPerValue` now, which wins over the one the kernel was launched with. */
    maxBytesPerValue: BytesLimit.optional(),
  }),
  z.object({
    type: z.literal("snapshot"),
    id: RequestId,
    names: Names,
    maxBytesPerValue: BytesLimit.optional(),
  }),
  z.object({
    type: z.literal("bindings"),
    id: RequestId,
    names: Names.optional(),
    full: z.boolean().optional(),
  }),
  RouteRequest.unwrap().extend({ type: z.literal("route"), id: RequestId }),
  /** The cell was deleted: its disposers run now (its routes, timers and listeners end), its scope stays. */
  z.object({ type: z.literal("dispose"), id: RequestId, cell: CellId }),
  /** Whether a page holds the client realm: without one, `emit` counts and drops at once (05-bridge §6). */
  z.object({ type: z.literal("page"), listening: z.boolean() }),
  /** Requests whose signal aborted before their result: the kernel starts none of them (04-kernel §2.1). */
  z.object({ type: z.literal("cancel"), ids: z.array(RequestId).readonly() }),
  z.object({ type: z.literal("shutdown") }),
]);
export type DaemonMessage = z.infer<typeof DaemonMessage>;

export type ExecuteMessage = Extract<DaemonMessage, { type: "execute" }>;
export type CallMessage = Extract<DaemonMessage, { type: "call" }>;
export type SnapshotMessage = Extract<DaemonMessage, { type: "snapshot" }>;
export type BindingsMessage = Extract<DaemonMessage, { type: "bindings" }>;
export type RouteMessage = Extract<DaemonMessage, { type: "route" }>;
export type DisposeMessage = Extract<DaemonMessage, { type: "dispose" }>;

/**
 * `message` checked on the daemon side with the schema the kernel reads it with (04-kernel §11): a caller's bad
 * argument is InvalidParams at once, with Zod's issues, rather than a message the kernel ignores and a request that
 * never settles.
 */
export function checkedMessage(message: unknown): DaemonMessage {
  const parsed = DaemonMessage.safeParse(message);
  if (parsed.success) return parsed.data;
  throw new InvalidParams({
    issues: parsed.error.issues.map(({ path, message: text }) => ({ path, message: text })),
  });
}

/** One entry of the export table: the exported name and the cell that exported it. */
export const ExportEntry = z.object({ name: z.string(), cell: CellId }).readonly();
export type ExportEntry = z.infer<typeof ExportEntry>;

/** Why the kernel refused a `call` before running anything: no current export of that name (`missing`: its cell runs
 * again and has not made it yet, or its run ended before reaching it), or an export that is no function (`value`). */
export const CallRefusal = z.enum(["missing", "value"]);
export type CallRefusal = z.infer<typeof CallRefusal>;

/** Events the kernel dropped since its last flush, by name (null: names past the flush's name budget), with why
 * (`overflow`: a burst past the queue; `noPage`: no page was listening) and the last one's time and cell. */
export const DroppedEvents = z
  .object({
    name: z.string().nullable(),
    count: z.number().int().positive(),
    why: z.enum(["overflow", "noPage"]),
    at: z.string(),
    cell: CellId.optional(),
  })
  .readonly();
export type DroppedEvents = z.infer<typeof DroppedEvents>;

/** Kernel → daemon. `result.redacted` flags a call result that redaction changed (04-kernel §10); `result.refused` says
 * why the kernel refused a call before running anything (04-kernel §2.1). */
export const KernelMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    pid: z.number().int(),
    inspectorUrl: z.string().optional(),
  }),
  z.object({
    type: z.literal("output"),
    execution: ExecutionId,
    output: Output,
    full: FullValue.optional(),
  }),
  z.object({
    type: z.literal("status"),
    execution: ExecutionId,
    status: ExecStatus,
    error: ErrorInfo.optional(),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal("result"),
    id: RequestId,
    value: z.unknown().optional(),
    error: ErrorInfo.optional(),
    redacted: z.boolean().optional(),
    refused: CallRefusal.optional(),
  }),
  z.object({ type: z.literal("exports"), names: z.array(ExportEntry).readonly() }),
  z.object({ type: z.literal("routes"), routes: z.array(Route).readonly() }),
  /** `emit(name, data)` calls since the last flush, and those the kernel dropped (05-bridge §6). */
  z.object({
    type: z.literal("events"),
    events: z.array(BridgeEvent).readonly(),
    dropped: z.array(DroppedEvents).readonly(),
  }),
]);
export type KernelMessage = z.infer<typeof KernelMessage>;
