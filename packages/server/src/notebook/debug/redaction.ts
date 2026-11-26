// The debugger's answers and events through the daemon's redaction, as every other producer's: what a
// paused kernel shows can hold a secret's value.
import type { Breakpoint, DebugFrame, DebugPause, DebugScope, DebugVariable } from "@jsnb/core";

import type { Evaluated } from "./inspect.js";

export type Redact = (text: string) => string;

/** `value` redacted, or undefined. */
const maybe = (value: string | undefined, redact: Redact): string | undefined =>
  value === undefined ? undefined : redact(value);

export const cleanVariable =
  (redact: Redact) =>
  (variable: DebugVariable): DebugVariable => {
    const type = maybe(variable.type, redact);
    return {
      name: redact(variable.name),
      value: redact(variable.value),
      ref: variable.ref,
      ...(type === undefined ? {} : { type }),
    };
  };

export const cleanScope =
  (redact: Redact) =>
  (scope: DebugScope): DebugScope => ({
    ...scope,
    name: redact(scope.name),
    ...(scope.variables === undefined
      ? {}
      : { variables: scope.variables.map(cleanVariable(redact)) }),
  });

export const cleanFrame =
  (redact: Redact) =>
  (frame: DebugFrame): DebugFrame => {
    const fn = maybe(frame.fn, redact);
    const file = maybe(frame.file, redact);
    return {
      ...frame,
      ...(fn === undefined ? {} : { fn }),
      ...(file === undefined ? {} : { file }),
    };
  };

export function cleanPause(redact: Redact, pause: DebugPause): DebugPause {
  const description = maybe(pause.description, redact);
  const text = maybe(pause.text, redact);
  return {
    ...pause,
    ...(description === undefined ? {} : { description }),
    ...(text === undefined ? {} : { text }),
  };
}

export function cleanEvaluated(redact: Redact, answer: Evaluated): Evaluated {
  const type = maybe(answer.type, redact);
  return { repr: redact(answer.repr), ref: answer.ref, ...(type === undefined ? {} : { type }) };
}

export const cleanBreakpoint =
  (redact: Redact) =>
  (breakpoint: Breakpoint): Breakpoint => {
    const condition = maybe(breakpoint.condition, redact);
    const hitCondition = maybe(breakpoint.hitCondition, redact);
    const logMessage = maybe(breakpoint.logMessage, redact);
    const message = maybe(breakpoint.message, redact);
    return {
      ...breakpoint,
      ...(condition === undefined ? {} : { condition }),
      ...(hitCondition === undefined ? {} : { hitCondition }),
      ...(logMessage === undefined ? {} : { logMessage }),
      ...(message === undefined ? {} : { message }),
    };
  };
