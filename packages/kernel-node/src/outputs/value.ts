// The value output of 04-kernel §5.2 and §5.4: core's encode under the output limits, the repr, and the uncapped
// full form the daemon retains when the capped one is truncated (03-api §7.5).
import type { FullValue, Output } from "@jsnb/core";
import { encode } from "@jsnb/core";

import type { Redact } from "./redact.js";
import { repr } from "./repr.js";

export type ValueLimits = {
  readonly maxValueBytes: number;
  readonly retainFullValue: boolean;
  readonly retainMaxBytes: number;
};

export type SerializedValue = {
  readonly json: unknown;
  readonly repr: string;
  readonly truncated: boolean;
};

const bytesPreview = 65_536;

/** `json`, `repr` and `truncated` the way a `value` output carries them (also `cell.bindings`). */
export function serializeValue(
  value: unknown,
  limits: ValueLimits,
  redact: Redact,
): SerializedValue {
  const { json, truncated } = encode(value, {
    maxDepth: 10,
    maxNodes: 10_000,
    maxBytes: limits.maxValueBytes,
    bytesPreview,
    redact,
  });
  return { json, repr: repr(value, redact), truncated };
}

/** The uncapped form, or undefined when a pathological graph overflows the stack while it is walked. */
function fullForm(value: unknown, limits: ValueLimits, redact: Redact): FullValue | undefined {
  try {
    return encode(value, {
      maxDepth: 1_000,
      maxNodes: Number.POSITIVE_INFINITY,
      maxBytes: limits.retainMaxBytes,
      bytesPreview,
      redact,
    });
  } catch (error) {
    // A RangeError means the walk itself failed (stack overflow); the capped output still stands without `full`.
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

export type ValueOutput = { readonly output: Output; readonly full?: FullValue };

/** The `value` output of a run, with `full` when the capped form is truncated and full values are retained. */
export function valueOutput(value: unknown, limits: ValueLimits, redact: Redact): ValueOutput {
  const serialized = serializeValue(value, limits, redact);
  const output: Output = { kind: "value", ...serialized };
  if (!serialized.truncated || !limits.retainFullValue) return { output };
  const full = fullForm(value, limits, redact);
  return full ? { output, full } : { output };
}
