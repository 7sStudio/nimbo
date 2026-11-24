// A project across changes: edits, deletions, moves, a cell switched to the other
// realm, and a workspace file the cells import, edited on disk.
import { utimes } from "node:fs/promises";

import { expect, test } from "vitest";

import { client, messages, server, withProject } from "./fixtures/project.js";
import type { LanguageProject } from "./project.js";

const typeOf = (p: LanguageProject, cell: string): string | undefined =>
  p.hover(cell, { line: 0, character: 1 })?.signature;

// sync
test("an edit, a deletion and a move change what the other cells see", async () => {
  const a = server("c_000001", "const value = 1;");
  const b = server("c_000002", "value;");
  const c = server("c_000003", 'const value = "s";');
  await withProject([a, b, c], (p) => {
    expect(typeOf(p, "c_000002")).toBe("const value: 1");
    p.sync([{ ...a, source: "const value = true;" }, b, c]);
    expect(typeOf(p, "c_000002")).toBe("const value: true");
    p.sync([b, c]);
    expect(typeOf(p, "c_000002")).toBe('const value: "s"');
    p.sync([a, b, c]);
    expect(typeOf(p, "c_000002")).toBe("const value: 1");
    p.sync([a, c, b]);
    expect(typeOf(p, "c_000002")).toBe('const value: "s"');
    p.sync([b]);
    expect(messages(p, "c_000002")).toEqual(["Cannot find name 'value'."]);
  });
});

test("a cell switched from server to client moves to the client realm", async () => {
  const source = "document.title;";
  await withProject([server("c_000001", source)], (p) => {
    expect(messages(p, "c_000001")).toEqual(["document exists in client cells only."]);
    p.sync([client("c_000001", source)]);
    expect(messages(p, "c_000001")).toEqual([]);
    expect(p.diagnostics().map((c) => c.cell)).toEqual(["c_000001"]);
  });
});

test("a relative import of a workspace file is read again after the file changes", async () => {
  const source = 'import { rate } from "./lib/prices.ts";\nrate;';
  await withProject(
    [server("c_000001", source)],
    async (p) => {
      const at = { line: 1, character: 1 };
      expect(p.hover("c_000001", at)?.signature).toBe("const rate: 2");
      await p.write("lib/prices.ts", "export const rate = 3;\n");
      const later = new Date(Date.now() + 5000);
      await utimes(`${p.root}/lib/prices.ts`, later, later);
      expect(p.hover("c_000001", at)?.signature).toBe("const rate: 3");
    },
    { files: { "lib/prices.ts": "export const rate = 2;\n" } },
  );
});

test("an empty project and an unknown cell answer empty", async () => {
  await withProject([], (p) => {
    expect(p.diagnostics()).toEqual([]);
    expect(p.completions("c_000009", { line: 0, character: 0 })).toEqual([]);
    expect(p.hover("c_000009", { line: 0, character: 0 })).toBeNull();
    expect(p.definition("c_000009", { line: 0, character: 0 })).toEqual([]);
  });
});
