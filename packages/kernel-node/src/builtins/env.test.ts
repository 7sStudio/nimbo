// Tests the env built-in: values, has, EnvNotSet, the safe reads, read-only, replace in place.
import { inspect } from "node:util";

import { EnvNotSet } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { createEnv } from "./env.js";

const make = (values: Record<string, string> = { STRIPE_KEY: "value-1" }) => {
  const builtin = createEnv();
  builtin.replace(values);
  return builtin;
};

describe("createEnv reads", () => {
  it("returns a set value and throws EnvNotSet for a missing one", () => {
    const { env } = make();
    expect(env.STRIPE_KEY).toBe("value-1");
    expect(() => env.NOPE).toThrow(new EnvNotSet({ name: "NOPE" }));
  });

  it("answers has() and reads symbols and then as undefined, so await env works", async () => {
    const { env } = make();
    const has = env.has as (name: string) => boolean;
    expect([has("STRIPE_KEY"), has("NOPE")]).toEqual([true, false]);
    expect(env[Symbol.iterator as unknown as string]).toBeUndefined();
    expect(await Promise.resolve(env)).toBe(env);
  });

  it("lists its names for Object.keys, the in operator and util.inspect", () => {
    const { env } = make({ A: "1", B: "2" });
    expect(Object.keys(env)).toEqual(["A", "B"]);
    expect("A" in env).toBe(true);
    expect(inspect(env)).toBe("Proxy([Object: null prototype] { A: '1', B: '2' })");
  });
});

describe("createEnv writes", () => {
  it("refuses writes, definitions and deletions from cells", () => {
    const { env } = make();
    expect(() => {
      (env as Record<string, unknown>).X = "1";
    }).toThrow(TypeError);
    expect(Reflect.defineProperty(env, "X", { value: "1" })).toBe(false);
    expect(Reflect.deleteProperty(env, "STRIPE_KEY")).toBe(false);
  });

  it("replaces the values in place, so a reference kept by a cell sees the new file", () => {
    const builtin = make({ OLD: "1" });
    const kept = builtin.env;
    builtin.replace({ NEW: "2" });
    expect(kept.NEW).toBe("2");
    expect(Object.keys(kept)).toEqual(["NEW"]);
  });
});
