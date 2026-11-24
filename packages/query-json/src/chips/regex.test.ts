// Tests of regex.ts: literal text as an I-Regexp for search(), and back.
import { describe, expect, it } from "vitest";

import { escapeLiteral, unescapeLiteral } from "./regex.ts";

describe("escapeLiteral", () => {
  it.each([
    ["plain text-1/2", "plain text-1/2"],
    [".?*+", "\\.\\?\\*\\+"],
    ["{}()|[]", "\\{\\}\\(\\)\\|\\[\\]"],
    ["^a\\b", "\\^a\\\\b"],
    ["$1.00", "[$]1\\.00"],
    ["é😀\n", "é😀\n"],
  ])("escapes %j as %j", (text, pattern) => {
    expect(escapeLiteral(text)).toBe(pattern);
  });

  it("matches the text and only it when used as a JavaScript pattern", () => {
    const text = "a.b$^(x)|[y]{2}*+?\\";
    expect(new RegExp(`^${escapeLiteral(text)}$`, "u").test(text)).toBe(true);
    expect(new RegExp(escapeLiteral("a.b"), "u").test("axb")).toBe(false);
  });
});

describe("unescapeLiteral", () => {
  it("reads back what escapeLiteral writes", () => {
    const text = "a.b$^(x)|[y]{2}*+?\\ é";
    expect(unescapeLiteral(escapeLiteral(text))).toBe(text);
  });

  it.each(["a.b", "a$", "^a", "a*", "[ab]", "\\d", "\\n", "a\\"])(
    "rejects the pattern %j",
    (pattern) => {
      expect(unescapeLiteral(pattern)).toBeUndefined();
    },
  );
});
