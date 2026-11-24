// Tests the names a MissingPackage error carries, and their union over the notebook's cells; and the client cell a
// DefinedInClient error names.
import { describe, expect, it } from "vitest";

import { allMissing, inClientOf, missingNames } from "./missing.js";

const error = (name: string, data?: Record<string, unknown>) => ({
  name,
  message: "m",
  frames: [],
  raw: "",
  ...(data === undefined ? {} : { data }),
});

describe("missing packages", () => {
  it("reads the names of a MissingPackage error only", () => {
    expect(missingNames(error("MissingPackage", { names: ["dayjs", 3, "zod"] }))).toEqual([
      "dayjs",
      "zod",
    ]);
    expect(missingNames(error("MissingPackage"))).toEqual([]);
    expect(missingNames(error("MissingPackage", { names: "dayjs" }))).toEqual([]);
    expect(missingNames(error("TypeError", { names: ["x"] }))).toEqual([]);
    expect(missingNames(undefined)).toEqual([]);
  });

  it("lists every name once across cells", () => {
    expect(
      allMissing([
        error("MissingPackage", { names: ["dayjs"] }),
        undefined,
        error("MissingPackage", { names: ["zod", "dayjs"] }),
      ]),
    ).toEqual(["dayjs", "zod"]);
  });
});

describe("inClientOf", () => {
  it("reads a DefinedInClient error's name and place, and nothing of any other", () => {
    const data = { name: "format", cell: "c_1", index: 4 };
    expect(inClientOf(error("DefinedInClient", data))).toEqual({ name: "format", index: 4 });
    expect(inClientOf(error("NotExported", data))).toBeNull();
    expect(inClientOf(error("DefinedInClient", { name: "format" }))).toBeNull();
    expect(inClientOf(undefined)).toBeNull();
  });
});
