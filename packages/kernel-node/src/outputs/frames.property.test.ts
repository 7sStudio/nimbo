// Property test (09-testing §3): the stack-frame parser and the frame and stack rewriting around it never throw, on
// arbitrary text and on frame-shaped lines with arbitrary function names, files and positions, a real compiled cell's
// URL among them (its source map answers positions outside its mappings with nothing).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { realCell } from "../fixtures/compiledCell.js";
import { parseStack, rewritePositions, toFrame } from "./frames.js";

const cell = realCell("const a = 1\nthrow new Error('two')", { notebook: "My Notes/a (1).jsnb" });

const runs = { numRuns: 50 };

const text = fc.string({ unit: "binary", maxLength: 80 });
const file = fc.oneof(
  text,
  fc.constantFrom(
    cell.url,
    "jsnb:///demo.jsnb/c_abc123.ts",
    "file:///work/lib/prices.ts",
    "file://remote-host/share/x.js",
    "file:///%E0%A4%A",
    "node:internal/modules/esm/loader",
    "/kernel/dist/run.js",
  ),
);
const frameLine = fc
  .tuple(fc.option(text), file, fc.integer(), fc.integer(), fc.boolean())
  .map(([fn, at, line, col, isAsync]) => {
    const where = `${at}:${String(line)}:${String(col)}`;
    return `    at ${isAsync ? "async " : ""}${fn === null ? where : `${fn} (${where})`}`;
  });
const stack = fc
  .array(fc.oneof(text, frameLine), { maxLength: 8 })
  .map((lines) => lines.join("\n"));

const context = { ...cell.context, internal: ["/kernel/dist"] };

describe("the stack-frame parser as a property", () => {
  it("never throws, and every frame it keeps has numbers for its position", () => {
    fc.assert(
      fc.property(stack, (input) => {
        for (const raw of parseStack(input)) {
          const frame = toFrame(raw, context);
          if (frame)
            expect([Number.isFinite(frame.line), Number.isFinite(frame.col)]).toEqual([true, true]);
        }
        expect(typeof rewritePositions(input, context)).toBe("string");
      }),
      runs,
    );
  });
});
