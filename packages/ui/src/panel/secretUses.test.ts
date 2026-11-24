// Which cells read a secret, as the Secrets section says it: env.NAME, env["NAME"] and env.has("NAME") count, a bare
// word does not; the readers are the code cells' numbers in notebook order.
import { describe, expect, it } from "vitest";

import { readersOf, readsSecret } from "./secretUses.js";

describe("secret uses", () => {
  it("counts the env proxy's three ways of naming a secret", () => {
    for (const source of [
      "new Stripe(env.STRIPE_KEY)",
      "env?.STRIPE_KEY",
      'env["STRIPE_KEY"]',
      "env['STRIPE_KEY']",
      "env[ `STRIPE_KEY` ]",
      'if (env.has("STRIPE_KEY")) {}',
    ])
      expect(readsSecret(source, "STRIPE_KEY"), source).toBe(true);
  });

  it("does not count a bare word, a longer name or another object", () => {
    for (const source of [
      "// set STRIPE_KEY in .env",
      'const s = "STRIPE_KEY"',
      "env.STRIPE_KEY_2",
      "process.env2.STRIPE_KEY",
      "myenv.STRIPE_KEY",
      "process.env.STRIPE_KEY",
    ])
      expect(readsSecret(source, "STRIPE_KEY"), source).toBe(false);
  });

  it("escapes a name's $ rather than read it as the pattern's own", () => {
    expect(readsSecret("env.PRICE$USD", "PRICE$USD")).toBe(true);
    expect(readsSecret("env.PRICE", "PRICE$")).toBe(false);
  });
});

describe("readersOf", () => {
  const cell = (type: string, source: string) => ({ type, source });

  it("numbers the code cells that read the secret, once each, in notebook order", () => {
    const cells = [
      cell("server", "env.PORT + env.PORT"),
      cell("server", "PORT"),
      cell("client", 'env["PORT"]'),
      cell("server", 'env.has("PORT")'),
    ];
    expect(readersOf(cells, "PORT")).toEqual([1, 3, 4]);
    expect(readersOf(cells, "OTHER")).toEqual([]);
    expect(readersOf([], "PORT")).toEqual([]);
  });

  it("passes over a markdown cell that names it, the numbers staying the notebook's", () => {
    const cells = [cell("markdown", "Set `env.PORT` first"), cell("server", "env.PORT")];
    expect(readersOf(cells, "PORT")).toEqual([2]);
  });
});
