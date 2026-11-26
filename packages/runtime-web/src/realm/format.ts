// util.format for the captured console: `%s %d %i %f %j %o %O %c %%`, the rest appended; never throws.
import { consoleInspect, inspect } from "./inspect.js";
import { safe } from "./inspect.js";

const deep = { ...consoleInspect, depth: 4 };
const shallow = { ...consoleInspect, depth: 0 };

/** A number the way Node prints it: `-0` keeps its sign. */
const numberText = (value: number): string => (Object.is(value, -0) ? "-0" : String(value));

/** `%s`: primitives as `String` gives them (a BigInt with its `n`), objects inspected at depth 0. */
function asString(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "bigint":
      return `${value.toString()}n`;
    case "number":
      return numberText(value);
    case "symbol":
      return value.toString();
    case "boolean":
      return String(value);
    case "undefined":
      return "undefined";
    default:
      return inspect(value, shallow);
  }
}

/** `%d`, `%i`, `%f`: a BigInt keeps its `n`, a Symbol is NaN, anything that cannot convert is NaN. */
function asNumber(value: unknown, convert: (value: unknown) => number): string {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "symbol") return "NaN";
  return numberText(safe(() => convert(value), Number.NaN));
}

function asJson(value: unknown): string {
  try {
    // JSON.stringify answers undefined for undefined, a function or a symbol, though its type says string.
    const text: unknown = Reflect.apply(JSON.stringify, JSON, [value]);
    return typeof text === "string" ? text : "undefined";
  } catch {
    // Node prints a cycle (and anything else JSON refuses) as `[Circular]` rather than throwing from console.log.
    return "[Circular]";
  }
}

const specifiers: Readonly<Record<string, (value: unknown) => string>> = {
  "%s": asString,
  "%d": (value) => asNumber(value, Number),
  "%i": (value) => asNumber(value, (v) => Number.parseInt(String(v), 10)),
  "%f": (value) => asNumber(value, (v) => Number.parseFloat(String(v))),
  "%j": asJson,
  "%o": (value) => inspect(value, deep),
  "%O": (value) => inspect(value, consoleInspect),
  "%c": () => "",
};

/** One argument after the format string: a string as it is, anything else inspected at depth 2. */
const show = (value: unknown): string =>
  typeof value === "string" ? value : inspect(value, consoleInspect);

/** Node's `util.format(...args)`. */
export function formatArgs(args: readonly unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first !== "string") return args.map(show).join(" ");
  // Node returns a lone format string unchanged: logging "100%%" alone prints "100%%".
  if (rest.length === 0) return first;
  let used = 0;
  const text = first.replace(/%[sdifjoOc%]/g, (token) => {
    if (token === "%%") return "%";
    const convert = specifiers[token];
    if (convert === undefined || used >= rest.length) return token;
    used += 1;
    return safe(() => convert(rest[used - 1]), "");
  });
  return [text, ...rest.slice(used).map(show)].join(" ");
}
