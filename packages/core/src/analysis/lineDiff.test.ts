// Tests the line diff of an agent edit's review (03-api §5): the kept, removed and added lines, the changed ranges of
// the source now (a deletion marks the line after the gap), the hunks with their context, and the cap on big diffs.
import { describe, expect, it } from "vitest";

import { changedLines, diffHunks, lineDiff } from "./lineDiff.js";

const kinds = (before: string, after: string) =>
  lineDiff(before, after).map((line) => `${line.kind[0] ?? ""} ${line.text}`);

describe("lineDiff", () => {
  it("keeps the common lines and puts removed lines before the lines added in their place", () => {
    expect(kinds("a\nb\nc\nd", "a\nB\nc\nd\ne")).toEqual([
      "s a",
      "r b",
      "a B",
      "s c",
      "s d",
      "a e",
    ]);
    expect(lineDiff("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a", before: 1, after: 1 },
      { kind: "same", text: "b", before: 2, after: 2 },
    ]);
  });

  it("numbers each line before and after, across a moved block", () => {
    const diff = lineDiff("x\na\nb\ny", "a\nb\nx\ny");
    expect(diff).toEqual([
      { kind: "removed", text: "x", before: 1 },
      { kind: "same", text: "a", before: 2, after: 1 },
      { kind: "same", text: "b", before: 3, after: 2 },
      { kind: "added", text: "x", after: 3 },
      { kind: "same", text: "y", before: 4, after: 4 },
    ]);
  });
});

describe("lineDiff at its edges", () => {
  it("treats an empty text as one empty line", () => {
    expect(kinds("", "a\nb")).toEqual(["r ", "a a", "a b"]);
    expect(kinds("a", "")).toEqual(["r a", "a "]);
  });

  it("counts a part too big to compare as replaced whole, still keeping its common start and end", () => {
    const many = (prefix: string) =>
      Array.from({ length: 1100 }, (_, i) => `${prefix}${String(i)}`);
    const before = ["head", ...many("a"), "tail"].join("\n");
    const after = ["head", ...many("b"), "tail"].join("\n");
    const diff = lineDiff(before, after);
    expect(diff[0]).toEqual({ kind: "same", text: "head", before: 1, after: 1 });
    expect(diff.at(-1)).toEqual({ kind: "same", text: "tail", before: 1102, after: 1102 });
    expect(diff.filter((line) => line.kind === "removed")).toHaveLength(1100);
    expect(diff.filter((line) => line.kind === "added")).toHaveLength(1100);
    expect(changedLines(before, after)).toEqual([{ from: 2, to: 1101 }]);
  });
});

describe("changedLines", () => {
  it("is empty for the same text and the added lines of the text now otherwise, as ranges", () => {
    expect(changedLines("a\nb", "a\nb")).toEqual([]);
    expect(changedLines("a\nb\nc\nd\ne", "a\nB\nC\nd\nE")).toEqual([
      { from: 2, to: 3 },
      { from: 5, to: 5 },
    ]);
    expect(changedLines("", "x\ny\nz")).toEqual([{ from: 1, to: 3 }]);
  });

  it("marks the line after lines removed with nothing in their place, the last line when they were at the end", () => {
    expect(changedLines("a\nb\nc\nd", "a\nd")).toEqual([{ from: 2, to: 2 }]);
    expect(changedLines("a\nb\nc", "a\nb")).toEqual([{ from: 2, to: 2 }]);
    expect(changedLines("a\nb\nc", "c")).toEqual([{ from: 1, to: 1 }]);
    expect(changedLines("a\nb", "")).toEqual([{ from: 1, to: 1 }]);
  });

  it("marks a replace by its added lines only", () => {
    expect(changedLines("a\nb\nc\nd", "a\nX\nd")).toEqual([{ from: 2, to: 2 }]);
  });
});

describe("diffHunks", () => {
  const text = (hunk: readonly { readonly text: string }[]) => hunk.map((line) => line.text);

  it("shows each change with its context, and joins changes whose context meets", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n");
    const after = ["1", "two", "3", "4", "5", "6", "7", "8", "nine"].join("\n");
    const hunks = diffHunks(lineDiff(before, after), 1);
    expect(hunks.map(text)).toEqual([
      ["1", "2", "two", "3"],
      ["8", "9", "nine"],
    ]);
    const near = diffHunks(lineDiff("a\nb\nc\nd\ne", "a\nB\nc\nD\ne"), 1);
    expect(near.map(text)).toEqual([["a", "b", "B", "c", "d", "D", "e"]]);
  });

  it("is empty when nothing changed, and context 0 shows the changed lines alone", () => {
    expect(diffHunks(lineDiff("a\nb", "a\nb"), 2)).toEqual([]);
    expect(diffHunks(lineDiff("a\nb\nc", "a\nB\nc"), 0).map(text)).toEqual([["b", "B"]]);
  });
});
