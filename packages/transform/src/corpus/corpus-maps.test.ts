// Case 17 of 04 §12, the map half: sources, sourcesContent, the inline map, and a generated position for every line.
import { beforeAll, describe, expect, it } from "vitest";

import { transform } from "../index.js";
import { toGenerated } from "./realm.js";

const filename = "jsnb:///corpus.jsnb/c_17_maps.ts";
const source = [
  "const a = 1",
  "debugger;",
  "function f(n: number) {",
  "  return n + a",
  "}",
  "f(2)",
].join("\n");

type MapShape = { file: string; sources: string[]; sourcesContent: string[]; sourceRoot?: string };

beforeAll(() => {
  // A representative cell, so the first test does not pay the compiler's warm-up (09 §2).
  transform(`import d from "p"\nconst { x } = o\n${source}\nclass C extends B {}`, { filename });
});

describe("transform source map", () => {
  it("names the cell as the file and its file form as the only source, with the TypeScript source as sourcesContent", () => {
    const { map } = transform(source, { filename });
    const parsed = JSON.parse(map) as MapShape;
    expect(parsed.file).toBe(filename);
    expect(parsed.sources).toEqual([filename.replace("jsnb:///", "file:///")]);
    expect(parsed.sourcesContent).toEqual([source]);
    expect(parsed).not.toHaveProperty("sourceRoot");
  });

  it("inlines the same map after the sourceURL comment", () => {
    const { code, map } = transform(source, { filename });
    const lines = code.trimEnd().split("\n");
    expect(lines.at(-2)).toBe(`//# sourceURL=${filename}`);
    const inline =
      lines.at(-1)?.replace("//# sourceMappingURL=data:application/json;base64,", "") ?? "";
    expect(JSON.parse(Buffer.from(inline, "base64").toString("utf8"))).toEqual(JSON.parse(map));
  });

  it("keeps debugger on its line and finds a generated position for every original line", () => {
    const { code, map } = transform(source, { filename });
    const generated = code.split("\n");
    const debuggerLine = toGenerated(map, 2);
    expect(debuggerLine).toBeDefined();
    expect(generated[(debuggerLine?.line ?? 0) - 1]).toContain("debugger;");
    for (let line = 1; line <= source.split("\n").length; line += 1) {
      expect(toGenerated(map, line), `line ${String(line)}`).toBeDefined();
    }
  });
});
