// A cell's own title and the cells.titleFromFirstLine naming: the title first, the first line without its
// comment marks only when the setting asks, and a summary named the same way.
import { describe, expect, it } from "vitest";

import { cellName, titleLine } from "./cellName.js";
import { summarize } from "./summary.js";

const facts = (defines: string[]) => ({ defines, exports: [] });
const none = { packages: [] };
const cell = (source: string, title?: string) => ({
  type: "server" as const,
  source,
  lastEdit: undefined,
  facts: facts([]),
  title,
});

describe("cell titles", () => {
  it("puts the cell's own title first, and its first line before its names only when asked", () => {
    const code = {
      type: "server" as const,
      source: "// get a user\nconst user = await getUser();",
    };
    expect(cellName(code, facts(["user"]), [])).toBe("user");
    expect(cellName(code, facts(["user"]), [], { firstLine: true })).toBe("get a user");
    const titled = { ...code, meta: { title: "  Load the user " } };
    expect(cellName(titled, facts(["user"]), [], { firstLine: true })).toBe("Load the user");
    expect(cellName({ ...titled, type: "markdown" }, undefined, [])).toBe("Load the user");
    // a blank title is no title; a code cell nothing names stays unnamed, the first line no longer filling in
    expect(cellName({ ...code, meta: { title: " " } }, facts(["user"]), [])).toBe("user");
    expect(cellName({ type: "client", source: "await fetch(url)" }, facts([]), [])).toBe("");
  });

  it("reads a first line without its comment marks", () => {
    expect(titleLine("//get a user")).toBe("get a user");
    expect(titleLine("/* load rows */\nselect 1")).toBe("load rows");
    expect(titleLine("/**\n * Charge the card.\n */")).toBe("Charge the card.");
    expect(titleLine("# Notes\n")).toBe("Notes");
    expect(titleLine("-- totals by day")).toBe("totals by day");
    expect(titleLine("<!-- hidden -->")).toBe("hidden");
    expect(titleLine("\n  const a = 1")).toBe("const a = 1");
    expect(titleLine("//\n")).toBe("");
  });

  it("names a summary's cells by their titles and, when the setting asks, their first lines", () => {
    const cells = [
      cell("// get a user\nawait getUser()", "Fetch"),
      cell("// get a user\nawait getUser()"),
    ];
    expect(summarize("a.jsnb", cells, none).cells.map((each) => each.name)).toEqual(["Fetch", ""]);
    expect(
      summarize("a.jsnb", cells, { ...none, firstLine: true }).cells.map((each) => each.name),
    ).toEqual(["Fetch", "get a user"]);
  });
});
