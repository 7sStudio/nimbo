// Tests engines.ts without an engine: no modes and no default then, and what jq and SQL download on first use (11-query
// §1, §4). Which modes the real engines allow is tested with them in tests/output-view (modes.integration.test.ts).
import { describe, expect, it } from "vitest";

import {
  availableModes,
  defaultMode,
  firstUseNotes,
  firstUseSizes,
  queryModes,
} from "./engines.js";

describe("without engines", () => {
  it("allows no mode and opens none", () => {
    expect(availableModes({})).toEqual([]);
    expect([defaultMode({}, "tree"), defaultMode({}, "grid")]).toEqual([undefined, undefined]);
    expect(queryModes).toEqual(["filter", "jsonpath", "jq", "sql"]);
  });
});

describe("first use", () => {
  it("names what jq and SQL download on first use", () => {
    expect(firstUseSizes).toEqual({ jq: "1.5 MB", sql: "6 MB" });
    expect(firstUseNotes).toEqual({
      jq: "loads 1.5 MB on first use",
      sql: "loads 6 MB on first use",
    });
  });
});
