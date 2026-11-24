// Tests examples.ts: the cheat sheet has ten examples for every mode, and the Filter ones parse.
import { describe, expect, it } from "vitest";

import { examples } from "./examples.js";
import { parseFilter } from "./filter.js";

describe("examples", () => {
  it("gives ten examples per mode", () => {
    expect(Object.values(examples).map((list) => list.length)).toEqual([10, 10, 10, 10]);
  });

  it("writes Filter examples the Filter parser reads", () => {
    expect(examples.filter.filter((e) => !parseFilter(e.query).ok)).toEqual([]);
  });
});
