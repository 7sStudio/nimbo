// The repr of a value output: util.inspect at depth 3, redacted, then capped at 4 096 characters.
import { inspect } from "node:util";

import { cut } from "./cut.js";
import type { Redact } from "./redact.js";

const options = {
  depth: 3,
  maxArrayLength: 50,
  maxStringLength: 500,
  breakLength: 80,
  colors: false,
} as const;

/** The longest repr, `…` included. */
const reprLimit = 4096;

/** `util.inspect(value)` with the repr options, redacted before it is cut. */
export function repr(value: unknown, redact: Redact): string {
  return cut(redact(inspect(value, options)), reprLimit);
}
