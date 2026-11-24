// The errors a cell's built-ins raise in either realm (04-kernel §7): a mistake the cell can make with them.
import { JsnbError } from "./jsnbError.js";

type Typed = { readonly type: string };

/** The type of a value as `data.type` carries it: `typeof`, with `null` and `array` told apart. */
export function typeName(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

/** "a number", "an object", "null", "undefined": the type as a sentence says it. */
const spoken = (type: string): string =>
  type === "null" || type === "undefined" ? type : `${/^[aeiou]/.test(type) ? "an" : "a"} ${type}`;

const invalidDisposerMessage = ({ type }: Typed): string =>
  `dispose() takes a function, not ${spoken(type)}. Register a cleanup such as dispose(() => server.close()).`;

/** `dispose(x)` with `x` not a function (04-kernel §7), in the server and the client realm alike. */
export class InvalidDisposer extends JsnbError {
  declare readonly data: Typed;
  constructor(data: Typed, options: { readonly cause?: unknown } = {}) {
    super({ name: "InvalidDisposer", message: invalidDisposerMessage(data), data, ...options });
  }
}
