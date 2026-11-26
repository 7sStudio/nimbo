// KernelStatus, RealmStatus and NotebookState: the state `notebook.get` returns.
import { z } from "zod";

import { Cell } from "./cell.js";
import { DebugState } from "./debug.js";
import { CellId } from "./ids.js";

export const KernelState = z.enum(["starting", "idle", "busy", "paused", "dead"]);
export type KernelState = z.infer<typeof KernelState>;

/** The shape behind KernelStatus; `kernel.status` returns it as its output object. A `dead` kernel that exited on its
 * own carries its exit code or signal, so the page's "kernel exited" banner can name it. */
export const kernelStatusShape = {
  state: KernelState,
  pid: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  executing: CellId.nullable(),
  inspectorUrl: z.string().nullable(),
  exitCode: z.number().int().optional(),
  signal: z.string().optional(),
};

export const KernelStatus = z.object(kernelStatusShape).readonly();
export type KernelStatus = z.infer<typeof KernelStatus>;

/** The shape behind RealmStatus; `realm.status` returns it as its output object. */
export const realmStatusShape = {
  attached: z.boolean(),
  kind: z.enum(["tab", "headless"]).nullable(),
  attachedAt: z.string().nullable(),
};

export const RealmStatus = z.object(realmStatusShape).readonly();
export type RealmStatus = z.infer<typeof RealmStatus>;

export const NotebookState = z
  .object({
    path: z.string(),
    cells: z.array(Cell).readonly(),
    kernel: KernelStatus,
    realm: RealmStatus,
    savedAt: z.string().nullable(),
    dirty: z.boolean(),
    /** An open conflict between the file and the session: the cells held in it (none when a save
     * found the file changed with merging off); absent when there is none. */
    conflict: z
      .object({ cells: z.array(CellId).readonly() })
      .readonly()
      .optional(),
    /** The session took unsaved text from the recovery copy a previous session left: when it was
     * written. */
    recovered: z.string().optional(),
    /** The debugger's state: breakpoints, and where a paused kernel stopped. */
    debug: DebugState.optional(),
    /** execution.autoRunDependents at work: the dependent running and those waiting, in run order. */
    autoRun: z
      .object({ running: CellId.nullable(), pending: z.array(CellId).readonly() })
      .readonly()
      .optional(),
  })
  .readonly();
export type NotebookState = z.infer<typeof NotebookState>;
