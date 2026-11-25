// The events of 03-api §6 as one envelope union, so `type` and `data` stay paired per event.
import { z } from "zod";

import { Route } from "./binding.js";
import { Cell } from "./cell.js";
import { ExecStatus } from "./execution.js";
import { Breakpoint, DebugPause, DebugStatus } from "./debug.js";
import { CellId, ExecutionId } from "./ids.js";
import { keybindingFilesSchema } from "./keybinding.js";
import { CellDiagnostics } from "./language.js";
import { KernelStatus, RealmStatus } from "./notebook.js";
import { Output } from "./output.js";
import { resolvedValueSchema } from "./settings.js";
import { NotebookList } from "./workspace.js";

const path = z.object({ path: z.string() }).readonly();
const names = z.array(z.string()).readonly();

/** Every event type of 03-api §6, in the order of its table. */
export const eventTypes = [
  "notebook.opened",
  "notebook.closed",
  "notebook.moved",
  "notebook.saved",
  "notebook.saveFailed",
  "notebook.conflict",
  "notebook.reconciled",
  "notebook.conflictEnded",
  "cell.added",
  "cell.updated",
  "cell.moved",
  "cell.deleted",
  "cell.status",
  "cell.output",
  "cells.stale",
  "cells.autoRun",
  "cell.diagnostics",
  "routes.changed",
  "kernel.status",
  "realm.status",
  "debug.paused",
  "debug.resumed",
  "debug.breakpoints",
  "packages.progress",
  "packages.done",
  "sql.progress",
  "settings.changed",
  "keybindings.changed",
  "notebooks.changed",
  "git.changed",
] as const;
export type EventType = (typeof eventTypes)[number];

/** What a packages.progress or packages.done is about: a packages.add or a packages.remove. */
const packageAction = z.enum(["add", "remove"]);

/** The `data` schema per event type. */
export const eventData = {
  "notebook.opened": path,
  "notebook.closed": path,
  /** The open notebook's file moved (a rename outside nimbo, or notebook.rename): `path` was its ref, `to` is (07 §5). */
  "notebook.moved": z.object({ path: z.string(), to: z.string() }).readonly(),
  "notebook.saved": z.object({ savedAt: z.string() }).readonly(),
  "notebook.saveFailed": z
    .object({
      path: z.string(),
      error: z.object({ code: z.string(), message: z.string() }).readonly(),
    })
    .readonly(),
  /** The file changed on disk since the session's last write: `cells` are those both sides changed (none when the
   * conflict was found at a save, 07 §5). */
  "notebook.conflict": z
    .object({ path: z.string(), cells: z.array(CellId).readonly().optional() })
    .readonly(),
  /** An external edit of the file was merged into the session (07 §5): `merged` with the cells it changed, added or
   * removed and whether the session's unsaved edits stay on top (`kept`, a save follows); `conflict` when the same
   * cells changed on both sides (notebook.conflict follows); `unreadable` when the file did not parse (`error`). */
  /** The conflict is over: resolved by the user, or ended by itself when the file stopped differing (07 §5). */
  "notebook.conflictEnded": path,
  "notebook.reconciled": z
    .object({
      path: z.string(),
      outcome: z.enum(["merged", "conflict", "unreadable"]),
      changed: z.array(CellId).readonly(),
      added: z.array(CellId).readonly(),
      removed: z.array(CellId).readonly(),
      kept: z.boolean(),
      error: z.string().optional(),
    })
    .readonly(),
  "cell.added": z.object({ cell: Cell }).readonly(),
  "cell.updated": z.object({ cell: Cell }).readonly(),
  "cell.moved": z.object({ order: z.array(CellId).readonly() }).readonly(),
  "cell.deleted": z.object({ cell: CellId }).readonly(),
  "cell.status": z
    .object({
      cell: CellId,
      execution: ExecutionId,
      status: ExecStatus,
      /** The run's execution count, once it started (Execution.count). */
      count: z.number().int().positive().optional(),
    })
    .readonly(),
  "cell.output": z.object({ cell: CellId, execution: ExecutionId, output: Output }).readonly(),
  "cells.stale": z.object({ cells: z.array(CellId).readonly() }).readonly(),
  /** execution.autoRunDependents at work, as a change of NotebookState.autoRun: the dependent running now, and the
   * cells that started or stopped waiting. */
  "cells.autoRun": z
    .object({
      running: CellId.nullable(),
      added: z.array(CellId).readonly(),
      removed: z.array(CellId).readonly(),
    })
    .readonly(),
  "cell.diagnostics": CellDiagnostics,
  "routes.changed": z.object({ routes: z.array(Route).readonly() }).readonly(),
  "kernel.status": KernelStatus,
  "realm.status": RealmStatus,
  "debug.paused": DebugPause,
  /** Not paused any more: `running` with the debugger still attached, `off` once it left (the kernel ended); `notice`
   * when it left unexpectedly (js-debug exited) and the daemon resumed the kernel itself. */
  "debug.resumed": z
    .object({ state: DebugStatus.exclude(["paused"]), notice: z.string().optional() })
    .readonly(),
  "debug.breakpoints": z.object({ breakpoints: z.array(Breakpoint).readonly() }).readonly(),
  "packages.progress": z.object({ names, line: z.string(), action: packageAction }).readonly(),
  "packages.done": z
    .object({
      names,
      ok: z.boolean(),
      error: z.string().optional(),
      errorName: z.string().optional(),
      action: packageAction,
    })
    .readonly(),
  /** A step of sql.install: each package's download, check and unpack, then `ready`. */
  "sql.progress": z
    .object({
      step: z.enum(["download", "verify", "unpack", "ready"]),
      package: z.string(),
      index: z.number().int().nonnegative(),
      count: z.number().int().positive(),
    })
    .readonly(),
  "settings.changed": z.object({ key: z.string(), ...resolvedValueSchema.shape }).readonly(),
  "keybindings.changed": keybindingFilesSchema.readonly(),
  "notebooks.changed": z.object({ notebooks: NotebookList }).readonly(),
  "git.changed": z
    .object({
      branch: z.string().nullable(),
      counts: z
        .object({ staged: z.number(), changes: z.number(), conflicts: z.number() })
        .readonly(),
    })
    .readonly(),
} as const satisfies Record<EventType, z.ZodType>;

const envelope = <T extends EventType>(type: T) =>
  z
    .object({
      notebook: z.string(),
      seq: z.number().int().nonnegative(),
      ts: z.string(),
      type: z.literal(type),
      data: eventData[type],
    })
    .readonly();

/** `{ notebook, seq, ts, type, data }`; `notebook` is `""` for workspace-level events such as `settings.changed`. */
export const EventEnvelope = z.discriminatedUnion("type", [
  envelope("notebook.opened"),
  envelope("notebook.closed"),
  envelope("notebook.moved"),
  envelope("notebook.saved"),
  envelope("notebook.saveFailed"),
  envelope("notebook.conflict"),
  envelope("notebook.reconciled"),
  envelope("notebook.conflictEnded"),
  envelope("cell.added"),
  envelope("cell.updated"),
  envelope("cell.moved"),
  envelope("cell.deleted"),
  envelope("cell.status"),
  envelope("cell.output"),
  envelope("cells.stale"),
  envelope("cells.autoRun"),
  envelope("cell.diagnostics"),
  envelope("routes.changed"),
  envelope("kernel.status"),
  envelope("realm.status"),
  envelope("debug.paused"),
  envelope("debug.resumed"),
  envelope("debug.breakpoints"),
  envelope("packages.progress"),
  envelope("packages.done"),
  envelope("sql.progress"),
  envelope("settings.changed"),
  envelope("keybindings.changed"),
  envelope("notebooks.changed"),
  envelope("git.changed"),
]);
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/** The event schema of one type, for a consumer that already knows the type. */
export type EventOf<T extends EventType> = Extract<EventEnvelope, { readonly type: T }>;
