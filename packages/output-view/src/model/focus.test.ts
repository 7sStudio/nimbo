// Tests focus.ts: the selected ids and their ancestors that flatten brings forward.
import { describe, expect, it } from "vitest";

import { focusOf } from "./focus.js";

describe("focusOf", () => {
  it("collects the selected ids and every ancestor of them", () => {
    const focus = focusOf(
      [
        ["data", 0, "id"],
        ["data", 7],
      ],
      true,
    );
    expect([...focus.ids]).toEqual(["$.data[0].id", "$.data[7]"]);
    expect([...focus.within]).toEqual(["$", "$.data", "$.data[0]"]);
    expect(focus.only).toBe(true);
  });
});
