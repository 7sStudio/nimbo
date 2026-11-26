// Tests the search query rule: package words and one scope go to the registry, a path or a URL never does.
import { describe, expect, it } from "vitest";

import { packagesSearch } from "../commands/packages.js";
import { isPackageQuery } from "./packageQuery.js";

describe("isPackageQuery", () => {
  it("takes package words and one scope, never a path or a URL", () => {
    for (const query of ["date-fns", "@stripe/stripe-js", "react dom", "lodash.get", "x_y", "café"])
      expect(isPackageQuery(query), query).toBe(true);
    const bs = String.fromCharCode(92);
    for (const query of [
      "",
      " ",
      "file:x",
      "~/a",
      `C:${bs}x`,
      "./x",
      "../x",
      "/x",
      "a/b",
      "@a/b/c",
      "zod@4",
      "https://example.com",
    ])
      expect(isPackageQuery(query), query).toBe(false);
  });

  it("is the rule packages.search's input keeps", () => {
    expect(packagesSearch.input.safeParse({ query: "date fns" }).success).toBe(true);
    expect(packagesSearch.input.safeParse({ query: "~/x" }).success).toBe(false);
  });
});
