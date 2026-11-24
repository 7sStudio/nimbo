// The diagnostics filter, one row of its table per case, over the real TypeScript
// service: what the generated lines cause is dropped, what the scope allows is not an error, messages are replaced.
import { expect, test } from "vitest";

import { client, messages, server, withProject } from "./fixtures/project.js";

// dropped
test("a half-typed cell's errors stay in it: the other cells see nothing wrong", async () => {
  const cells = [
    server("c_000001", "interface Item { amount: number }\nconst items: Item[] = [];"),
    server("c_000002", "export function total(items: Item[]) { return items.length }"),
    server("c_000003", "total(items, "),
    server("c_000004", "total(items);"),
  ];
  await withProject(cells, (p) => {
    const all = p.diagnostics();
    expect(all.map((c) => [c.cell, c.diagnostics.length > 0])).toEqual([
      ["c_000001", false],
      ["c_000002", false],
      ["c_000003", true],
      ["c_000004", false],
    ]);
    const end = { line: 0, character: "total(items, ".length };
    const half = all.find((c) => c.cell === "c_000003")?.diagnostics ?? [];
    expect(half.some((d) => d.range.start.line === end.line)).toBe(true);
  });
});

test("an unclosed brace is reported at the cell's end, and no other cell errs", async () => {
  const source = "function f() {\n  return 1;";
  const cells = [server("c_000001", source), server("c_000002", "const x = 1;\nx;")];
  await withProject(cells, (p) => {
    const [first, second] = p.diagnostics();
    expect(first?.diagnostics).toEqual([
      {
        range: { start: { line: 1, character: 11 }, end: { line: 1, character: 11 } },
        severity: "error",
        code: 1005,
        message: "'}' expected.",
        source: "ts",
      },
    ]);
    expect(second?.diagnostics).toEqual([]);
  });
});

test("assigning another cell's name is allowed (a free identifier write)", async () => {
  const cells = [server("c_000001", "let count = 0;"), server("c_000002", "count = 5;")];
  await withProject(cells, (p) => {
    expect(messages(p, "c_000002")).toEqual([]);
  });
});

test("reading another cell's value of the name a cell redeclares is allowed", async () => {
  const cells = [
    server("c_000001", "const data = [1, 2];\nconst clean = (d: number[]) => d;"),
    server("c_000002", "const data = clean(data);"),
  ];
  await withProject(cells, (p) => {
    expect(messages(p, "c_000002")).toEqual([]);
  });
});

test("a use before its declaration with no other definer is still an error", async () => {
  await withProject([server("c_000001", "x;\nconst x = 1;")], (p) => {
    expect(messages(p, "c_000001")).toEqual([
      "Block-scoped variable 'x' used before its declaration.",
      "Variable 'x' is used before being assigned.",
    ]);
  });
});

test("a cell that declares nothing and uses top-level await type-checks", async () => {
  await withProject([server("c_000001", "await Promise.resolve(1);")], (p) => {
    expect(messages(p, "c_000001")).toEqual([]);
  });
});

test("an untyped parameter is not an error", async () => {
  await withProject([server("c_000001", "function f(a) { return a; }")], (p) => {
    expect(messages(p, "c_000001")).toEqual([]);
  });
});

// replaced
test("a missing package says how to add it; a missing relative file keeps TypeScript's message", async () => {
  const source =
    'import Stripe from "stripe";\nimport { a } from "@scope/pkg/sub";\nimport { b } from "./nope.ts";';
  await withProject([server("c_000001", source)], (p) => {
    expect(messages(p, "c_000001")).toEqual([
      'Package "stripe" is not installed. Run: nimbo add stripe, or add it in the Packages panel.',
      'Package "@scope/pkg" is not installed. Run: nimbo add @scope/pkg, or add it in the Packages panel.',
      "Cannot find module './nope.ts' or its corresponding type declarations.",
    ]);
  });
});

test("a Node module in a client cell", async () => {
  await withProject([client("c_000001", 'import { join } from "node:path";')], (p) => {
    expect(messages(p, "c_000001")).toEqual(["node:path exists in server cells only."]);
  });
});

test("an unknown name keeps TypeScript's message", async () => {
  await withProject([server("c_000001", "undefinedThing;")], (p) => {
    expect(messages(p, "c_000001")).toEqual(["Cannot find name 'undefinedThing'."]);
  });
});

test("a fetched JSON body is untyped in a server cell, as in a client cell", async () => {
  const source =
    'const r = await fetch("https://x.test");\nconst data = await r.json();\ndata.items;';
  await withProject([server("c_000001", source), client("c_000002", source)], (p) => {
    expect(p.diagnostics().flatMap((c) => c.diagnostics)).toEqual([]);
  });
});
