// The client `env`: a Proxy over the public values the daemon sends with realm.execute.
import { EnvNotPublic, EnvNotSet } from "@jsnb/core";

import { looksSecret } from "./redact.js";

/** Only `PUBLIC_*` and `*_PUBLISHABLE_KEY` reach the browser. */
const isPublicName = (name: string): boolean =>
  name.startsWith("PUBLIC_") || name.endsWith("_PUBLISHABLE_KEY");

export type ClientEnv = {
  /** The one `env` every run's scope shows; its values change, its identity does not. */
  readonly env: Readonly<Record<string, unknown>>;
  /** The public env of the latest realm.execute that carried one; a secret-looking value is dropped. */
  readonly replace: (values: Readonly<Record<string, string>>) => void;
};

/** Names that read as undefined, so `await env`, `JSON.stringify(env)` and inspection never throw. */
const quiet = new Set(["then", "toJSON", "constructor", "valueOf"]);

/** A plain object's string, so `"env: " + env` and `String(env)` give `[object Object]` instead of throwing. */
const coercion: Readonly<Record<string, unknown>> = { toString: () => "[object Object]" };

export function createEnv(): ClientEnv {
  // The Proxy's target holds the current values, so ownKeys and descriptors list exactly what the page sees.
  const values: Record<string, unknown> = { __proto__: null };
  const has = (name: unknown): boolean => typeof name === "string" && Object.hasOwn(values, name);
  const env = new Proxy(values, {
    get(target, name) {
      if (typeof name !== "string" || quiet.has(name)) return undefined;
      if (name === "has") return has;
      if (Object.hasOwn(coercion, name)) return coercion[name];
      if (Object.hasOwn(target, name)) return target[name];
      throw isPublicName(name) ? new EnvNotSet({ name }) : new EnvNotPublic({ name });
    },
    set: () => false,
    deleteProperty: () => false,
    defineProperty: () => false,
  });
  const replace = (next: Readonly<Record<string, string>>): void => {
    for (const name of Object.keys(values)) Reflect.deleteProperty(values, name);
    for (const [name, value] of Object.entries(next)) {
      if (isPublicName(name) && !looksSecret(value)) values[name] = value;
    }
  };
  return { env, replace };
}
