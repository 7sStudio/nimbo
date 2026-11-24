import { expect, it } from "vitest";

import { textDiff } from "./textDiff.js";

it("counts an added and a removed text as all lines, and an empty one as none", () => {
  expect(textDiff(null, "a\nb")).toMatchObject({ added: 2, removed: 0 });
  expect(textDiff("a", null)).toMatchObject({ added: 0, removed: 1 });
  expect(textDiff("", "")).toEqual({ hunks: [], added: 0, removed: 0 });
});

it("keeps three lines of context around a change", () => {
  const before = Array.from({ length: 20 }, (_, at) => `line ${String(at)}`).join("\n");
  const after = before.replace("line 10", "line ten");
  const { hunks } = textDiff(before, after);
  expect(hunks).toHaveLength(1);
  expect(hunks[0]?.map((line) => line.kind)).toEqual([
    "same",
    "same",
    "same",
    "removed",
    "added",
    "same",
    "same",
    "same",
  ]);
});
