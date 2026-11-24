// Rename within a cell, across cells and across the bridge, and its refusals.
import { expect, test } from "vitest";

import { after, client, server, withProject } from "./fixtures/project.js";

// rename
test("within a cell", async () => {
  const source = "const a = 1;\nconst b = a + a;";
  await withProject([server("c_000001", source)], (p) => {
    expect(p.rename("c_000001", { line: 0, character: 6 }, "first")).toEqual({
      edits: [{ cell: "c_000001", source: "const first = 1;\nconst b = first + first;" }],
    });
  });
});

test("across cells from a use, leaving a cell below that redeclares the name alone", async () => {
  const cells = [
    server("c_000001", "let total = 0;"),
    server("c_000002", "total = total + 1;"),
    server("c_000004", "console.log(total);"),
    server("c_000003", "const total = 'own';\ntotal;"),
  ];
  await withProject(cells, (p) => {
    expect(p.rename("c_000004", after("console.log(total", "total", 1), "sum")).toEqual({
      edits: [
        { cell: "c_000001", source: "let sum = 0;" },
        { cell: "c_000002", source: "sum = sum + 1;" },
        { cell: "c_000004", source: "console.log(sum);" },
      ],
    });
  });
});

const bridged = [
  server("c_000001", "export async function createIntent(amount: number) { return amount; }"),
  server("c_000002", "await createIntent(5);"),
  client("c_000003", "const a = await createIntent(1);"),
  client("c_000004", "createIntent(2);\ncreateIntent(3);"),
];
const renamed = {
  edits: [
    {
      cell: "c_000001",
      source: "export async function makeIntent(amount: number) { return amount; }",
    },
    { cell: "c_000002", source: "await makeIntent(5);" },
    { cell: "c_000003", source: "const a = await makeIntent(1);" },
    { cell: "c_000004", source: "makeIntent(2);\nmakeIntent(3);" },
  ],
};

test("from a server export into every client use", async () => {
  await withProject(bridged, (p) => {
    expect(
      p.rename("c_000001", after(bridged[0]?.source ?? "", "function c", 0), "makeIntent"),
    ).toEqual(renamed);
  });
});

test("from a client use back to the server cells", async () => {
  await withProject(bridged, (p) => {
    expect(p.rename("c_000004", { line: 1, character: 3 }, "makeIntent")).toEqual(renamed);
  });
});

test.each<[string, string, string]>([
  ["a package symbol", 'import { join } from "node:path";\njoin("a");', "join("],
  ["a built-in", "display.json(1);", "display"],
  ["a global", "console.log(1);", "console"],
])("refuses %s", async (_, source, marker) => {
  await withProject([server("c_000001", source)], (p) => {
    const result = p.rename("c_000001", after(source, marker, 1), "other");
    expect(result).toHaveProperty("refused");
  });
});

test.each<[string, string]>([
  ["__scope", "__scope is reserved for the notebook's own use."],
  ["class", "class is not a valid name."],
  ["a b", "a b is not a valid name."],
])("refuses the new name %s", async (to, reason) => {
  await withProject([server("c_000001", "const a = 1;")], (p) => {
    expect(p.rename("c_000001", { line: 0, character: 6 }, to)).toEqual({ refused: reason });
  });
});

test.each<[string, string, string, string]>([
  [
    "a shorthand property keeps its key",
    "const total = 5;\nconst o = { total };\ndisplay.json({ total });",
    "const sum = 5;\nconst o = { total: sum };\ndisplay.json({ total: sum });",
    "sum",
  ],
  [
    "a destructured name keeps the property it reads",
    "const obj = { a: 1 };\nconst { a } = obj;\na;",
    "const obj = { a: 1 };\nconst { a: b } = obj;\nb;",
    "b",
  ],
])("rename: %s", async (_, source, renamed, to) => {
  await withProject([server("c_000001", source)], (p) => {
    const at = source.includes("total") ? { line: 0, character: 6 } : after(source, "{ a }", 2);
    expect(p.rename("c_000001", at, to)).toEqual({
      edits: [{ cell: "c_000001", source: renamed }],
    });
  });
});

test("rename of a property through a shorthand keeps the local value", async () => {
  const source = "const total = 1;\nconst o = { total };\no.total;";
  await withProject([server("c_000001", source)], (p) => {
    expect(p.rename("c_000001", after(source, "o.total", 2), "sum")).toEqual({
      edits: [{ cell: "c_000001", source: "const total = 1;\nconst o = { sum: total };\no.sum;" }],
    });
  });
});
