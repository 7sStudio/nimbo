// The ErrorInfo of a run that failed before the kernel ran: a syntax error's frame on the cell and the
// excerpt of its source with a caret, from core's real InvalidSyntax; an error with no place has neither.
import { InvalidSyntax, MissingPackage } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { excerptOf, runError } from "./errors.js";

describe("excerptOf", () => {
  it("numbers the line before and the line, the caret under the column", () => {
    expect(excerptOf("const a = 1;\nconst x = ;", 2, 11)).toBe(
      "  1 | const a = 1;\n> 2 | const x = ;\n    |           ^",
    );
    expect(excerptOf("x = ;", 1, 5)).toBe("> 1 | x = ;\n    |     ^");
  });

  it("keeps the line's tabs under the caret, so it lands under the column", () => {
    expect(excerptOf("\tconst x = ;", 1, 12)).toBe("> 1 | \tconst x = ;\n    | \t          ^");
  });

  it("finds the line TypeScript counts with a lone \\r, U+2028 or U+2029 as a break", () => {
    expect(excerptOf("a\rb\u2028c\u2029const x = ;", 4, 11)).toBe(
      "  3 | c\n> 4 | const x = ;\n    |           ^",
    );
  });

  it("cuts a long line to a window around the column, the caret still under it", () => {
    const long = `${"a".repeat(200)};${"b".repeat(200)}`;
    const excerpt = excerptOf(long, 1, 201) ?? "";
    const [shown = "", caret = ""] = excerpt.split("\n");
    expect(shown.length).toBeLessThan(140);
    expect(shown.startsWith("> 1 | …")).toBe(true);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.charAt(caret.indexOf("^"))).toBe(";");
  });

  it("puts the caret under the column after emoji, and shows a short line before a long one whole", () => {
    expect(excerptOf("const s = '🎉🎉'; const x = ;", 1, 29)).toBe(
      "> 1 | const s = '🎉🎉'; const x = ;\n    |                             ^",
    );
    const [before = ""] = (excerptOf(`const a = 1\n${"x".repeat(300)};`, 2, 301) ?? "").split("\n");
    expect(before).toBe("  1 | const a = 1");
  });

  it("pads the numbers to the widest one shown, and has nothing for a line past the end", () => {
    const source = Array.from({ length: 10 }, (_, i) => `l${String(i + 1)}`).join("\r\n");
    expect(excerptOf(source, 10, 1)).toBe("   9 | l9\n> 10 | l10\n     | ^");
    expect(excerptOf("x", 3, 1)).toBeUndefined();
  });
});

describe("runError", () => {
  it("gives a syntax error its frame on the cell and the excerpt of the source", () => {
    const error = new InvalidSyntax({ detail: "Expression expected.", line: 1, col: 11 });
    const info = runError(error, "c_1", "const x = ;");
    expect(info).toMatchObject({
      name: "SyntaxError",
      frames: [{ cell: "c_1", line: 1, col: 11 }],
      raw: `SyntaxError: ${info.message}`,
      data: { line: 1, col: 11, excerpt: "> 1 | const x = ;\n    |           ^" },
    });
  });

  it("adds no excerpt without a source or a place", () => {
    const syntax = new InvalidSyntax({ detail: "Expression expected.", line: 1, col: 11 });
    expect(runError(syntax, "c_1").data).not.toHaveProperty("excerpt");
    const missing = runError(
      new MissingPackage({ names: ["left-pad"] }),
      "c_1",
      "import 'left-pad'",
    );
    expect(missing.frames).toEqual([]);
    expect(missing.data).not.toHaveProperty("excerpt");
  });
});
