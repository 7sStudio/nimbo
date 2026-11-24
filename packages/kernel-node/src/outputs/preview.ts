// Binding.preview (03-api §5, kernel.scope): one line of util.inspect, redacted, capped at 120 characters.
import { inspect } from "node:util";

import { cut } from "./cut.js";
import type { Redact } from "./redact.js";

const options = {
  depth: 0,
  breakLength: Number.POSITIVE_INFINITY,
  maxArrayLength: 5,
  maxStringLength: 60,
  colors: false,
} as const;

/** The longest preview, `…` included. */
export const previewLimit = 120;

/** A one-line preview of `value`: redacted as inspected, then line breaks (an error's stack) fold into spaces. */
export function preview(value: unknown, redact: Redact): string {
  const line = redact(inspect(value, options)).replace(/\s*\n\s*/g, " ");
  return cut(line, previewLimit);
}
