// The debugger's state: breakpoints on cells' lines, where a paused realm (the server kernel or the
// headless page) stopped, a frame's scopes and their variables, as the `debug.*` commands and events carry them.
import { z } from "zod";

import { CellId } from "./ids.js";
import { frameShape } from "./output.js";

/** Where code stops: the server kernel, or the daemon's headless page running the client cells. */
export const DebugRealm = z.enum(["server", "client"]);
export type DebugRealm = z.infer<typeof DebugRealm>;

/** The shape behind Breakpoint; `debug.setBreakpoint` returns it as its output object. */
export const breakpointShape = {
  breakpointId: z.string(),
  cell: CellId,
  /** 1-based line of the cell's TypeScript. */
  line: z.number().int().positive(),
  /** Pause only when this expression is truthy. */
  condition: z.string().optional(),
  /** Pause only on the hits it allows (`5`, `>= 3`, `% 2`). */
  hitCondition: z.string().optional(),
  /** A logpoint: print this message (`{expr}` interpolated) and go on, never pausing. */
  logMessage: z.string().optional(),
  /** The realm its cell runs in: the server kernel, or the client realm (the headless page). */
  realm: DebugRealm,
  /** Bound to the cell's code: false before the cell's code is loaded, or on a line with none. */
  verified: z.boolean(),
  /** Why it does not work as set: its condition or a logpoint's expression does not parse, or threw when hit. */
  message: z.string().optional(),
  /** Why nimbo cannot bind it now (a client cell's while a tab holds the client realm); it binds once that changes. */
  reason: z.string().optional(),
};

export const Breakpoint = z.object(breakpointShape).readonly();
export type Breakpoint = z.infer<typeof Breakpoint>;

/** Where and why a realm paused. */
export const DebugPause = z
  .object({
    realm: DebugRealm,
    /** breakpoint, step, pause, exception, debugger statement, entry, … (DAP's stopped reasons). */
    reason: z.string(),
    description: z.string().optional(),
    /** The innermost cell frame, when one is on the stack. */
    cell: CellId.optional(),
    line: z.number().int().positive().optional(),
    /** An exception's text, when it paused on one. */
    text: z.string().optional(),
    /** The cell was edited since this code ran: `line` is in its code from before the edit, not in its source now. */
    stale: z.boolean().optional(),
  })
  .readonly();
export type DebugPause = z.infer<typeof DebugPause>;

export const DebugStatus = z.enum(["off", "running", "paused"]);
export type DebugStatus = z.infer<typeof DebugStatus>;

/** `off`: no debugger attached to either realm; `running`: attached; `paused`: one is stopped, and `paused` says where:
 * the pause the commands act on (the latest), `pauses` every one, latest first; `realms` each realm's own state. */
export const debugStateShape = {
  state: DebugStatus,
  paused: DebugPause.nullable(),
  pauses: z.array(DebugPause).readonly(),
  realms: z.object({ server: DebugStatus, client: DebugStatus }).readonly(),
  breakpoints: z.array(Breakpoint).readonly(),
};

export const DebugState = z.object(debugStateShape).readonly();
export type DebugState = z.infer<typeof DebugState>;

/** A stack frame with the id `debug.scope` and `debug.evaluate` address it by. */
export const DebugFrame = z
  .object({
    ...frameShape,
    frameId: z.string(),
    /** Its cell was edited since this code ran: `line` is in the code from before the edit. */
    stale: z.boolean().optional(),
  })
  .readonly();
export type DebugFrame = z.infer<typeof DebugFrame>;

/** A variable or property; `ref` > 0 names its children for `debug.variables`, valid while the kernel stays paused. */
export const DebugVariable = z
  .object({
    name: z.string(),
    value: z.string(),
    type: z.string().optional(),
    ref: z.number().int().nonnegative(),
  })
  .readonly();
export type DebugVariable = z.infer<typeof DebugVariable>;

/** A frame's scope: Local, Block, Closure, the notebook's cell names (Notebook), Global. An expensive scope's
 * variables are left out; `debug.variables` with its `ref` reads them. */
export const DebugScope = z
  .object({
    name: z.string(),
    ref: z.number().int().nonnegative(),
    expensive: z.boolean(),
    variables: z.array(DebugVariable).readonly().optional(),
  })
  .readonly();
export type DebugScope = z.infer<typeof DebugScope>;

/** What `debug.paused`, `debug.resumed` and `debug.breakpoints` make of a debugger's state. */
export type DebugChange =
  | { readonly type: "debug.paused"; readonly data: DebugPause }
  | {
      readonly type: "debug.resumed";
      readonly data: { readonly realm: DebugRealm; readonly state: "off" | "running" };
    }
  | {
      readonly type: "debug.breakpoints";
      readonly data: { readonly breakpoints: readonly Breakpoint[] };
    };

/** The state after `change`, as the daemon's own `debug.state` then answers. */
export function debugAfter(state: DebugState, change: DebugChange): DebugState {
  if (change.type === "debug.breakpoints")
    return { ...state, breakpoints: change.data.breakpoints };
  const realm = change.data.realm;
  const others = state.pauses.filter((each) => each.realm !== realm);
  const pauses = change.type === "debug.paused" ? [change.data, ...others] : others;
  const realms = {
    ...state.realms,
    [realm]: change.type === "debug.paused" ? "paused" : change.data.state,
  } as const;
  const attached = realms.server !== "off" || realms.client !== "off";
  return {
    state: pauses.length > 0 ? "paused" : attached ? "running" : "off",
    paused: pauses[0] ?? null,
    pauses,
    realms,
    breakpoints: state.breakpoints,
  };
}

/** The registry keys of the symbols under which a client realm's page holds the cells' names for a debugger: the scope
 * a cell reads (the latest run's) and the record of the names cells defined. */
export const pageScopeKey = "jsnb.realm.scope";
export const pageRecordKey = "jsnb.realm.record";
