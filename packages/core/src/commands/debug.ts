// The debug commands of 03-api §4.9: breakpoints, the kernel paused, stepped and resumed, the stack, scopes, variables
// and evaluations of a paused server kernel, over the daemon's debugger (js-debug).
import { z } from "zod";

import {
  breakpointShape,
  DebugFrame,
  DebugScope,
  debugStateShape,
  DebugVariable,
} from "../model/debug.js";
import { CellId, NotebookRef } from "../model/ids.js";
import { defineCommand } from "./define.js";

const notebook = z.object({ notebook: NotebookRef });
const mutating = { mutating: true };

export const debugState = defineCommand({
  name: "debug.state",
  description:
    "Whether the debugger is attached to the kernel, where a paused kernel stopped, and every breakpoint.",
  input: notebook,
  output: z.object(debugStateShape),
});

export const debugSetBreakpoint = defineCommand({
  name: "debug.setBreakpoint",
  description:
    "Set a breakpoint on a line of a server cell, or change the one there; attaches the debugger. A condition, a hit condition or a log message (a logpoint, which never pauses) are optional; an empty string removes one. A condition or a logpoint's {expression} reads the frame's names and the cells' names; one that does not parse or throws is reported once in the breakpoint's message.",
  input: z.object({
    notebook: NotebookRef,
    cell: CellId,
    line: z.number().int().positive(),
    condition: z.string().optional(),
    hitCondition: z.string().optional(),
    logMessage: z.string().optional(),
  }),
  output: z.object(breakpointShape),
  tags: mutating,
});

export const debugRemoveBreakpoint = defineCommand({
  name: "debug.removeBreakpoint",
  description:
    "Remove a breakpoint by its id, the one on a cell's line, every one of a cell (cell without line), or all of them (all).",
  input: z.object({
    notebook: NotebookRef,
    breakpointId: z.string().optional(),
    cell: CellId.optional(),
    line: z.number().int().positive().optional(),
    all: z.boolean().optional(),
  }),
  output: z.object({ removed: z.number().int().nonnegative() }),
  tags: mutating,
});

const control = (verb: string, description: string) =>
  defineCommand({
    name: `debug.${verb}`,
    description,
    input: notebook,
    output: z.object({}),
    tags: mutating,
  });

export const debugPause = control("pause", "Pause the kernel at its next statement.");
export const debugResume = control("resume", "Resume a paused kernel.");
export const debugStepOver = control(
  "stepOver",
  "Run the current line of a paused kernel and pause on the next.",
);
export const debugStepInto = control(
  "stepInto",
  "Step into the call on the current line of a paused kernel.",
);
export const debugStepOut = control(
  "stepOut",
  "Run to the end of the current function and pause in its caller.",
);

export const debugStack = defineCommand({
  name: "debug.stack",
  description:
    "The call stack of a paused kernel, innermost first: cell frames as cell and line, the kernel's own frames left out.",
  input: notebook,
  output: z.object({ frames: z.array(DebugFrame) }),
});

export const debugScope = defineCommand({
  name: "debug.scope",
  description:
    "The scopes of one frame of a paused kernel (the innermost by default) with their variables (Local, Block, Closure, Notebook for the cells' names, Global); an expensive scope's variables need debug.variables.",
  input: z.object({ notebook: NotebookRef, frameId: z.string().optional() }),
  output: z.object({ scopes: z.array(DebugScope) }),
});

export const debugVariables = defineCommand({
  name: "debug.variables",
  description:
    "The children of a scope, a variable or an evaluation result by its ref, while the kernel stays paused.",
  input: z.object({ notebook: NotebookRef, ref: z.number().int().positive() }),
  output: z.object({ variables: z.array(DebugVariable) }),
});

export const debugEvaluate = defineCommand({
  name: "debug.evaluate",
  description:
    "Evaluate an expression in a frame of a paused kernel (the innermost by default), or in the notebook's scope when it is not paused. The cells' names read and write as in a cell (x = 5 changes x).",
  input: z.object({
    notebook: NotebookRef,
    expression: z.string().min(1),
    frameId: z.string().optional(),
  }),
  output: z.object({
    repr: z.string(),
    type: z.string().optional(),
    ref: z.number().int().nonnegative(),
  }),
  tags: mutating,
});
