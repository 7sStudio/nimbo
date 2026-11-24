// The bridge protocol shapes of 05-bridge §9 that travel over the page's WebSocket.
import { z } from "zod";

import { ExecStatus } from "./execution.js";
import { CellId, ExecutionId } from "./ids.js";
import { ErrorInfo, Output } from "./output.js";

export const SnapshotBinding = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fn") }),
  z.object({ kind: z.literal("value"), json: z.unknown() }),
  z.object({ kind: z.literal("error"), error: ErrorInfo }),
]);
export type SnapshotBinding = z.infer<typeof SnapshotBinding>;

const limit = z.number().int().positive();

/** The settings a client run applies in the page (03-api §4.10), read by the daemon for each run like the env. */
export const RealmLimits = z
  .object({
    /** `bridge.rpcTimeoutMs`: how long a stub waits for its server function (05-bridge §4.1). */
    rpcTimeoutMs: limit,
    /** `bridge.maxBytesPerValue`: bytes cross whole up to it, in both directions (05-bridge §2). */
    maxBytesPerValue: limit,
    /** `outputs.maxValueBytes`: a value output's json budget (04-kernel §5.4). */
    maxValueBytes: limit,
    /** `outputs.maxStreamBytes`: stream text per execution before `[output truncated]` (04-kernel §5.1). */
    maxStreamBytes: limit,
  })
  .readonly();
export type RealmLimits = z.infer<typeof RealmLimits>;

export const RealmExecute = z
  .object({
    execution: ExecutionId,
    cell: CellId,
    code: z.string(),
    map: z.string(),
    bindings: z.record(z.string(), SnapshotBinding),
    /** The client's public env (04-kernel §8: `PUBLIC_*`, `*_PUBLISHABLE_KEY`), re-read by the daemon per run. */
    env: z.record(z.string(), z.string()).optional(),
    /** The run's limits from the notebook's settings; absent, the page's own defaults (the 03-api §4.10 ones). */
    limits: RealmLimits.optional(),
    /**
     * The server names the daemon could not bind (NotExported, KernelRestarted, ExportNotRun; 05-bridge §3, §7), in
     * the order the cell uses them: the page fails the run with the first one it does not hold itself (one of its
     * built-ins, `document` and `window` among them, or a name a client cell defined) before it runs anything.
     */
    unbound: z.record(z.string(), ErrorInfo).optional(),
  })
  .readonly();
export type RealmExecute = z.infer<typeof RealmExecute>;

/** A kernel.interrupt while the page runs a client cell (02-architecture §5): the page ends that run `interrupted`. */
export const RealmInterrupt = z.object({ execution: ExecutionId }).readonly();
export type RealmInterrupt = z.infer<typeof RealmInterrupt>;

/** The page's answer: what the run it ended had defined (for the daemon's record) and, when it used its container, that
 * container's DOM (the run's `dom` output, so the container stays in its cell); nothing for a run it did not end. */
export const RealmInterruptAnswer = z
  .object({
    defines: z.array(z.string()).readonly().optional(),
    dom: z.object({ html: z.string(), text: z.string() }).readonly().optional(),
  })
  .readonly();
export type RealmInterruptAnswer = z.infer<typeof RealmInterruptAnswer>;

/** A name the bridge layer held before a kernel restart: its defining cell and 1-based index (05-bridge §7, §8). */
const RestartedName = z.object({ cell: CellId, index: z.number().int().positive() }).readonly();

/** Absent `bridge`: the full reset (`realm.restart`, `kernel.restart { all }`); present: a kernel restart clears only
 * the bridge layer, and each listed name fails with `KernelRestarted` until its client cell re-runs (05-bridge §8). */
/** realm.reset: everything (no key), the bridge layer only after a kernel restart (`bridge`), or this page lost the
 * notebook to a tab that took it over (`takenOver`: the full local reset, and the page turns view-only). */
export const RealmReset = z
  .object({
    bridge: z.record(z.string(), RestartedName).optional(),
    takenOver: z.literal(true).optional(),
  })
  .readonly();
export type RealmReset = z.infer<typeof RealmReset>;

export const RealmSnapshot = z.object({ cell: CellId }).readonly();
export type RealmSnapshot = z.infer<typeof RealmSnapshot>;

export const BridgeEvent = z.object({ name: z.string(), data: z.unknown() }).readonly();
export type BridgeEvent = z.infer<typeof BridgeEvent>;

/** The shape behind RealmReport; `realm.report` takes it as its input object. */
export const realmReportShape = {
  realmId: z.string(),
  execution: ExecutionId,
  output: Output.optional(),
  status: ExecStatus.optional(),
  /** A failed run's error and every run's duration, as the kernel's `status` message carries them (04-kernel §2.1). */
  error: ErrorInfo.optional(),
  durationMs: z.number().optional(),
  defines: z.array(z.string()).readonly().optional(),
};

export const RealmReport = z.object(realmReportShape).readonly();
export type RealmReport = z.infer<typeof RealmReport>;
