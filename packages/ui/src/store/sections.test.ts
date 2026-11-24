// The heading sections of store/sections.ts: levels from the text, what a collapsed heading hides (nested sections
// included), and how a move or a drop takes a collapsed section along.
import type { Cell } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import {
  blockStep,
  dropAfter,
  headingLevel,
  headingOf,
  headingsOf,
  sectionsOf,
} from "./sections.js";

const cell = (
  id: string,
  source: string,
  type: Cell["type"] = "markdown",
  collapsed = false,
): Cell => ({
  id,
  type,
  source,
  index: 0,
  meta: collapsed ? { headingCollapsed: true } : {},
  status: "idle",
  stale: false,
  lastExecution: null,
});

describe("headingLevel", () => {
  it("takes the highest heading outside code fences, ATX or setext", () => {
    expect(headingLevel("## Two\n# One")).toBe(1);
    expect(headingLevel("```\n# not a heading\n```\n### Three")).toBe(3);
    expect(headingLevel("Title\n===")).toBe(1);
    expect(headingLevel("Sub\n---")).toBe(2);
    expect(headingLevel("text\n\n---\n#hashtag")).toBeNull();
    expect(headingLevel("~~~~\n# in\n~~~\n# still in")).toBeNull();
  });
});

describe("sectionsOf", () => {
  const cells = [
    cell("h1", "# A", "markdown", true),
    cell("a", "1", "server"),
    cell("h2", "## A.1"),
    cell("b", "2", "server"),
    cell("h3", "# B"),
    cell("c", "3", "client"),
  ];

  it("hides a collapsed heading's cells up to the next heading of its level, nested sections included", () => {
    const sections = sectionsOf(cells);
    expect([...sections.hiddenBy.keys()]).toEqual(["a", "h2", "b"]);
    expect(sections.heads.get("h1")).toEqual({ level: 1, size: 3 });
    expect(sections.heads.get("h2")).toEqual({ level: 2, size: 1 });
    expect(sections.heads.get("h3")).toEqual({ level: 1, size: 1 });
    expect(headingOf(cells, sections, "b")).toBe("h2");
    expect(headingOf(cells, sections, "c")).toBe("h3");
  });

  it("moves a collapsed section whole, and a cell past one", () => {
    // past the whole next section, never into it
    expect(blockStep(cells, "h1", 1)).toEqual({ ids: ["h1", "a", "h2", "b"], after: "c" });
    const swapped = [cells[4], cells[5], ...cells.slice(0, 4)].filter((each) => each !== undefined);
    // and back up before the section above of its level
    expect(blockStep(swapped, "h1", -1)).toEqual({ ids: ["h1", "a", "h2", "b"], after: null });
    expect(blockStep(cells, "h3", -1)).toEqual({ ids: ["h3"], after: null });
    expect(blockStep(cells, "h1", -1)).toBeUndefined();
    expect(dropAfter(cells, "c", "h1")).toEqual({ ids: ["c"], after: "b" });
    expect(dropAfter(cells, "h1", "h3")).toEqual({ ids: ["h1", "a", "h2", "b"], after: "h3" });
    expect(dropAfter(cells, "h3", "h1")).toBeUndefined();
  });
});

describe("headingsOf", () => {
  it("gives every heading with its plain text", () => {
    expect(headingsOf("# A `b` ##\ntext\nSub *c*\n---\n```\n# no\n```")).toEqual([
      { level: 1, text: "A b" },
      { level: 2, text: "Sub c" },
    ]);
  });
});
