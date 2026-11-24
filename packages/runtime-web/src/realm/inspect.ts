// The realm's inspector, Node `util.inspect` style (04-kernel §5.1, §5.2): one value to one line; it never throws.
import { formatObject } from "./inspect-objects.js";
import type { InspectContext, InspectOptions } from "./inspect-text.js";
import { formatFunction, formatString, safe } from "./inspect-text.js";

export type { InspectOptions } from "./inspect-text.js";

/** What `console.log` shows of an object: depth 2, as `util.format` does. */
export const consoleInspect: InspectOptions = {
  depth: 2,
  maxArrayLength: 100,
  maxStringLength: 10_000,
  maxLength: Number.POSITIVE_INFINITY,
};

/** A value output's `repr` (04-kernel §5.2): depth 3, 50 items, 500-character strings, 4 KB in all. */
export const reprInspect: InspectOptions = {
  depth: 3,
  maxArrayLength: 50,
  maxStringLength: 500,
  maxLength: 4096,
};

function formatValue(value: unknown, context: InspectContext): string {
  switch (typeof value) {
    case "string":
      return formatString(value, context.options);
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "bigint":
      return `${value.toString()}n`;
    case "symbol":
      return value.toString();
    case "function":
      return formatFunction(value);
    case "object":
      return value === null ? "null" : formatObject(value, context, formatNested);
    default:
      return String(value);
  }
}

/** A nested value: whatever cannot be read shows as `[Inaccessible]` and the rest of the value still prints. */
function formatNested(value: unknown, context: InspectContext): string {
  return safe(() => formatValue(value, context), "[Inaccessible]");
}

/** Node's `util.inspect` for one value: never throws, on Proxies, throwing getters and revoked proxies alike. */
export function inspect(value: unknown, options: InspectOptions): string {
  const text = formatNested(value, { options, depth: 0, seen: [] });
  return text.length > options.maxLength ? `${text.slice(0, options.maxLength - 1)}…` : text;
}
