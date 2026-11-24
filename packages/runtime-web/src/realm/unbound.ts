// The names the daemon could not bind (05-bridge §3, §7; realm.execute's `unbound`): the run fails with the first one
// this page does not hold itself, before it starts. The page holds the names its client cells define (the daemon may not
// have their report yet) and its built-ins (`document`, `window`, `console`, `env`, `display`, the timers and listeners);
// a server value under any other name of `window` (`status`, `name`, `find`) is NotExported, never the browser's by
// accident. A server cell's import (`crypto`) the daemon leaves to the page's own lookup and never sends here.
import type { ErrorInfo } from "@jsnb/core";

import { builtinNames } from "./builtins.js";

/** The error the run ends with, or undefined when the page holds every unbound name. */
export function refusalOf(
  record: Readonly<Record<string, unknown>>,
  unbound: Readonly<Record<string, ErrorInfo>> | undefined,
): ErrorInfo | undefined {
  for (const [name, error] of Object.entries(unbound ?? {})) {
    if (!Object.hasOwn(record, name) && !builtinNames.includes(name)) return error;
  }
  return undefined;
}
