// Tests the path helpers the nimbo rules share.
import { describe, expect, it } from "vitest";

import { isUnder, posix } from "./paths.js";

describe("posix", () => {
  it("turns backslashes into slashes", () => {
    expect(posix("a\\b\\c.ts")).toBe("a/b/c.ts");
  });
});

describe("isUnder", () => {
  it("matches a file inside one of the prefixes", () => {
    expect(isUnder("/r/packages/ui/src/cells/CellCard.vue", ["packages/ui/src/cells"])).toBe(true);
  });

  it("rejects a file outside every prefix", () => {
    expect(isUnder("/r/packages/ui/src/store/notebook.ts", ["packages/ui/src/cells"])).toBe(false);
  });
});
