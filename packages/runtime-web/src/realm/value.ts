// A run's `value` output: core's encode for `json`, the realm's inspector for `repr`.
import type { Output } from "@jsnb/core";
import { encode, truncatedMarker } from "@jsnb/core";

import { inspect, reprInspect } from "./inspect.js";
import { redact } from "./redact.js";

/** `json` within `maxValueBytes` (depth 10, 10 000 nodes, 64 KB of bytes: core's defaults), redacted as it is written. */
export function valueOutput(value: unknown, maxValueBytes: number): Output {
  const repr = inspect(value, reprInspect);
  try {
    const { json, truncated } = encode(value, { maxBytes: maxValueBytes, redact });
    return { kind: "value", json, repr, truncated };
  } catch {
    // A getter that throws or a revoked proxy stops the serializer: the repr still describes the value.
    return { kind: "value", json: truncatedMarker, repr, truncated: true };
  }
}
