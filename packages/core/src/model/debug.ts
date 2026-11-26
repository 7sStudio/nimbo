// The debugger's state: breakpoints on server cells' lines, where a paused kernel stopped, a frame's
// scopes and their variables, as the `debug.*` commands and events carry them.
import { z } from "zod";

import { CellId } from "./ids.js";
import { frameShape } from "./output.js";

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
  /** Bound to the cell's code in the kernel: false before the cell's code is loaded, or on a line with none. */
  verified: z.boolean(),
  /** Why it does not work as set: its condition or a logpoint's expression does not parse, or threw when hit. */
  message: z.string().optional(),
};

export const Breakpoint = z.object(breakpointShape).readonly();
export type Breakpoint = z.infer<typeof Breakpoint>;

/** Where and why a kernel paused. */
export const DebugPause = z
  .object({
    /** breakpoint, step, pause, exception, debugger statement, entry, … (DAP's stopped reasons). */
    reason: z.string(),
    description: z.string().optional(),
    /** The innermost cell frame, when one is on the stack. */
    cell: CellId.optional(),
    line: z.number().int().positive().optional(),
    /** An exception's text, when it paused on one. */
    text: z.string().optional(),
  })
  .readonly();
export type DebugPause = z.infer<typeof DebugPause>;

export const DebugStatus = z.enum(["off", "running", "paused"]);
export type DebugStatus = z.infer<typeof DebugStatus>;

/** `off`: no debugger attached to the kernel; `running`: attached; `paused`: stopped, `paused` says where. */
export const debugStateShape = {
  state: DebugStatus,
  paused: DebugPause.nullable(),
  breakpoints: z.array(Breakpoint).readonly(),
};

export const DebugState = z.object(debugStateShape).readonly();
export type DebugState = z.infer<typeof DebugState>;

/** A stack frame with the id `debug.scope` and `debug.evaluate` address it by. */
export const DebugFrame = z.object({ ...frameShape, frameId: z.string() }).readonly();
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
