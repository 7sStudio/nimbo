// Tests the V8 stack parser, the frame mapping and the position rewrite: the parser over every V8
// line shape, then a real cell (the transform and the kernel's compiler) of a notebook whose ref holds spaces and
// parentheses: its frames mapped to its own lines by its exact URL, the kernel's own frames dropped, and its positions
// rewritten in stack text; a cell URL the kernel did not compile is left alone.
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { RealCell } from "../fixtures/compiledCell.js";
import { realCell } from "../fixtures/compiledCell.js";
import { parseStack, rewritePositions, toFrame } from "./frames.js";

const cellFile = "jsnb:///sub/demo.jsnb/c_abc123.ts";

const stack = [
  "TypeError: bad",
  `    at total (${cellFile}:7:5)`,
  `    at ${cellFile}:9:1`,
  "    at async run (/opt/kernel/src/run.ts:10:2)",
  "    at new Client (/app/node_modules/pkg/index.js:3:4)",
  "    at JSON.parse (<anonymous>)",
  "    at async Promise.all (index 0)",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
].join("\n");

describe("parseStack", () => {
  it("reads the located frames of every V8 line shape and skips the rest", () => {
    expect(parseStack(stack)).toEqual([
      { fn: "total", file: cellFile, line: 7, col: 5 },
      { file: cellFile, line: 9, col: 1 },
      { fn: "run", file: "/opt/kernel/src/run.ts", line: 10, col: 2 },
      { fn: "Client", file: "/app/node_modules/pkg/index.js", line: 3, col: 4 },
      {
        fn: "process.processTicksAndRejections",
        file: "node:internal/process/task_queues",
        line: 105,
        col: 5,
      },
    ]);
  });
});

describe("toFrame over a real cell", () => {
  let failing: RealCell;
  let stack = "";
  beforeAll(async () => {
    const source = "const a = 1\nconst b = 2\nthrow new Error('three')";
    // This test file's own frames count as the kernel's, so the stack below the cell is dropped.
    const internal = [dirname(fileURLToPath(import.meta.url))];
    failing = realCell(source, { notebook: "My Notes/a (1).jsnb", internal });
    const thrown = await failing.run();
    stack = thrown instanceof Error ? (thrown.stack ?? "") : "";
  });

  it("maps the cell's frame to its own line by the exact URL and drops the kernel's frames", () => {
    expect(failing.url).toBe("jsnb:///My%20Notes/a%20%281%29.jsnb/c_abc123.ts");
    const frames = parseStack(stack).flatMap((raw) => toFrame(raw, failing.context) ?? []);
    expect(frames[0]).toMatchObject({ cell: "c_abc123", line: 3 });
    expect(frames.some((frame) => frame.file?.endsWith("frames.test.ts") === true)).toBe(false);
  });

  it("rewrites the cell's positions in stack text, and leaves a URL it did not compile", () => {
    const rewritten = rewritePositions(stack, failing.context);
    expect(rewritten).toContain(`${failing.url}:3:`);
    const other = "    at jsnb:///other.jsnb/c_abc123.ts:9:1";
    expect(rewritePositions(other, failing.context)).toBe(other);
    expect(
      toFrame({ file: "jsnb:///other.jsnb/c_abc123.ts", line: 9, col: 1 }, failing.context),
    ).toEqual({
      file: "jsnb:///other.jsnb/c_abc123.ts",
      line: 9,
      col: 1,
    });
  });
});

describe("toFrame for files", () => {
  const context = realCell("1").context;

  it("turns file: URLs into paths and keeps a URL that is not a local path", () => {
    const local = pathToFileURL("/app/node_modules/pkg/index.js").href;
    expect(toFrame({ file: local, line: 1, col: 2 }, context)).toEqual({
      file: "/app/node_modules/pkg/index.js",
      line: 1,
      col: 2,
    });
    expect(toFrame({ file: "file://remote-host/share/x.js", line: 1, col: 1 }, context)).toEqual({
      file: "file://remote-host/share/x.js",
      line: 1,
      col: 1,
    });
    expect(toFrame({ file: "node:internal/x", line: 1, col: 1 }, context)).toBeUndefined();
  });
});
