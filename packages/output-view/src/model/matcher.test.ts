// Tests matcher.ts: find's substring and /re/ queries, their ranges and their errors.
import { describe, expect, it } from "vitest";

import type { Matcher } from "./matcher.js";
import { matcherOf } from "./matcher.js";

const compile = (query: string): Matcher => {
  const result = matcherOf(query);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe("matcherOf substring", () => {
  it("matches case-insensitively and gives every range", () => {
    const matcher = compile("Cus");
    expect([matcher.test("customer"), matcher.test("pi_1")]).toEqual([true, false]);
    expect(matcher.ranges("cus_1 CUS_2")).toEqual([
      [0, 3],
      [6, 9],
    ]);
  });

  it("takes regular expression characters literally", () => {
    expect([
      compile("a.b").test("axb"),
      compile("a.b").test("a.b"),
      compile("[x]").test("[x]"),
    ]).toEqual([false, true, true]);
  });

  it("says whether a number's text could match", () => {
    expect([compile("12.5").numeric, compile("1e3").numeric, compile("pi").numeric]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("matcherOf /re/", () => {
  it("compiles a regular expression with its flags", () => {
    const matcher = compile("/^pi_\\d+$/i");
    expect([matcher.test("PI_12"), matcher.test("xpi_1"), matcher.numeric]).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("does not loop on empty matches and caps the ranges", () => {
    expect(compile("/x*/").ranges("ab")).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(compile("a").ranges("a".repeat(500))).toHaveLength(100);
  });

  it("returns the engine's message for an invalid pattern or flag", () => {
    expect(matcherOf("/(/")).toMatchObject({ ok: false, error: { position: 1 } });
    expect(matcherOf("/a/q")).toEqual({
      ok: false,
      error: { message: 'Unknown regular expression flag "q"; use i, m, s, u or v.', position: 3 },
    });
  });
});
