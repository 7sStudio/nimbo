// Tests createIds: shapes from 03-api §2 and determinism per seed.
import { describe, expect, it } from "vitest";

import { createIds } from "./ids.js";

describe("createIds", () => {
  it("makes c_ ids of six base36 characters and x_ ids of eight", () => {
    const ids = createIds(1);
    expect(ids.cell()).toMatch(/^c_[0-9a-z]{6}$/);
    expect(ids.execution()).toMatch(/^x_[0-9a-z]{8}$/);
  });

  it("repeats the same sequence for the same seed", () => {
    const a = createIds(42);
    const b = createIds(42);
    expect([a.cell(), a.execution(), a.cell()]).toEqual([b.cell(), b.execution(), b.cell()]);
  });

  it("gives different sequences for different seeds", () => {
    expect(createIds(1).cell()).not.toBe(createIds(2).cell());
  });
});
