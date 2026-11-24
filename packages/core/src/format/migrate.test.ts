// Tests the migration mechanism with a fake step list; version 1 has no steps of its own.
import { describe, expect, it } from "vitest";

import type { Migration } from "./migrate.js";
import { migrate, migrations } from "./migrate.js";

const steps: readonly Migration[] = [
  { from: 1, to: 2, run: (raw) => ({ ...raw, title: "untitled" }) },
  { from: 2, to: 3, run: (raw) => ({ ...raw, title: String(raw.title).toUpperCase() }) },
];

describe("migrate", () => {
  it("has no steps for the current version", () => {
    expect(migrations).toEqual([]);
    expect(migrate({ version: 1, cells: [] })).toEqual({
      raw: { version: 1, cells: [] },
      migrated: false,
    });
  });

  it("runs every step from the document's version in order and sets the version", () => {
    expect(migrate({ version: 1, cells: [] }, steps)).toEqual({
      raw: { version: 3, cells: [], title: "UNTITLED" },
      migrated: true,
    });
  });

  it("starts from the middle and leaves a current document alone", () => {
    expect(migrate({ version: 2, title: "t" }, steps).raw).toEqual({ version: 3, title: "T" });
    expect(migrate({ version: 3 }, steps)).toEqual({ raw: { version: 3 }, migrated: false });
  });
});
