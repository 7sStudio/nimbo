// The server `env` built-in: a read-only Proxy over the workspace .env values, replaced in place
// before every run; a name with no value throws core's EnvNotSet, whose message says how to set it.
import { EnvNotSet } from "@jsnb/core";

export type EnvBuiltin = {
  /** What cells see as `env`. */
  readonly env: Readonly<Record<string, unknown>>;
  /** Swaps in the values of a fresh read of `.env`. */
  readonly replace: (values: Readonly<Record<string, string>>) => void;
};

/**
 * `env.X` is the value or throws; `env.has("X")` asks; symbols and `then` read as undefined, so `await env`
 * and a cell returning `env` work. The values live on the Proxy's target, so `Object.keys(env)` and
 * util.inspect see the names (and repr redacts the values like any other string).
 */
export function createEnv(): EnvBuiltin {
  const values: Record<string, string> = {};
  Reflect.setPrototypeOf(values, null);
  const has = (name: unknown): boolean => typeof name === "string" && Object.hasOwn(values, name);
  const env = new Proxy(values, {
    get(target, name) {
      if (typeof name === "symbol" || name === "then") return undefined;
      if (name === "has") return has;
      if (!Object.hasOwn(target, name)) throw new EnvNotSet({ name });
      return target[name];
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  return {
    env,
    replace: (next) => {
      for (const name of Object.keys(values)) Reflect.deleteProperty(values, name);
      Object.assign(values, next);
    },
  };
}
