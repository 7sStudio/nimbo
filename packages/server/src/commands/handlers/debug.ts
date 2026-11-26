// The debug commands over the notebook's debugger (debug/session.ts).
import {
  debugEvaluate,
  debugPause,
  debugRemoveBreakpoint,
  debugResume,
  debugScope,
  debugSetBreakpoint,
  debugStack,
  debugState,
  debugStepInto,
  debugStepOut,
  debugStepOver,
  debugVariables,
  InvalidParams,
} from "@jsnb/core";

import type { Bound } from "../bind.js";
import { bind } from "../bind.js";
import type { Services } from "../services.js";

const noTarget = (): InvalidParams =>
  new InvalidParams({
    issues: [
      { path: ["breakpointId"], message: "give breakpointId, cell (with line or not), or all" },
    ],
  });

export function debugHandlers({ workspace }: Services): readonly Bound[] {
  const debug = async (notebook: string) => (await workspace.notebooks.require(notebook)).debug;
  const control =
    (verb: "pause" | "resume" | "stepOver" | "stepInto" | "stepOut") =>
    async ({ notebook, realm }: { notebook: string; realm?: "server" | "client" | undefined }) => {
      await (await debug(notebook)).control(verb, realm);
      return {};
    };
  return [
    bind(debugState, async ({ notebook }) => (await debug(notebook)).state()),
    bind(debugSetBreakpoint, async ({ notebook, cell, line, ...options }) =>
      (await debug(notebook)).setBreakpoint(cell, line, options),
    ),
    bind(debugRemoveBreakpoint, async ({ notebook, ...which }) => {
      if (which.breakpointId === undefined && which.cell === undefined && which.all !== true)
        throw noTarget();
      return { removed: await (await debug(notebook)).removeBreakpoints(which) };
    }),
    bind(debugPause, control("pause")),
    bind(debugResume, control("resume")),
    bind(debugStepOver, control("stepOver")),
    bind(debugStepInto, control("stepInto")),
    bind(debugStepOut, control("stepOut")),
    bind(debugStack, async ({ notebook, realm }) => (await debug(notebook)).stack(realm)),
    bind(debugScope, async ({ notebook, frameId, realm }) =>
      (await debug(notebook)).scopes(frameId, realm),
    ),
    bind(debugVariables, async ({ notebook, ref, realm }) =>
      (await debug(notebook)).variables(ref, realm),
    ),
    bind(debugEvaluate, async ({ notebook, expression, frameId, realm }) =>
      (await debug(notebook)).evaluate(expression, frameId, realm),
    ),
  ];
}
