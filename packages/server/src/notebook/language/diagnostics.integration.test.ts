// Diagnostics and rename over the daemon's real socket: notebook.diagnostics, the
// pushes of cell.diagnostics that follow the edits, the transform's refusals, and language.rename through the session.
import type { EventOf } from "@jsnb/core";
import { languageLsp, languageRename, notebookBridge } from "@jsnb/core";
import { expect, test } from "vitest";

import { startRegistry } from "@jsnb/test-tools/registry";

import { connect, messagesOf, notebook, withNotebook } from "../../fixtures/language.js";

test("notebook.diagnostics, then pushes that follow the edits, latest wins", async () => {
  await withNotebook(async (daemon, add) => {
    const a = await add("const total = (n: number) => n * 2;");
    const b = await add('total("two");');
    const { cells } = await daemon.client.notebook.diagnostics({ notebook });
    expect(messagesOf(cells, a)).toEqual([]);
    expect(messagesOf(cells, b)).toEqual([
      "Argument of type 'string' is not assignable to parameter of type 'number'.",
    ]);
    await daemon.client.cell.update({ notebook, cell: b, source: "total(2);" });
    const fixed = await daemon.events.until("cell.diagnostics", (e) => e.data.cell === b);
    expect(fixed.data.diagnostics).toEqual([]);
    const before = daemon.events.all().length;
    await daemon.client.cell.update({ notebook, cell: b, source: "total(3);" });
    await daemon.client.cell.update({ notebook, cell: b, source: "total(true);" });
    const last = await daemon.events.until(
      "cell.diagnostics",
      (e) => e.data.cell === b && e.data.diagnostics.length > 0,
    );
    expect(last.data.diagnostics[0]?.message).toContain("'boolean'");
    const pushed = daemon.events
      .all()
      .slice(before)
      .filter((e): e is EventOf<"cell.diagnostics"> => e.type === "cell.diagnostics");
    expect(pushed.map((e) => e.data.diagnostics.length)).toEqual([1]);
  });
});

test("a transform refusal is a nimbo diagnostic", async () => {
  await withNotebook(async (daemon, add) => {
    const cell = await add("export default 1;");
    const { cells } = await daemon.client.notebook.diagnostics({ notebook, cell });
    expect(cells[0]?.diagnostics.find((d) => d.source === "nimbo")).toMatchObject({
      code: "DefaultExport",
      range: { start: { line: 0, character: 0 } },
    });
  });
});

test("language.rename changes every cell, an unopened one too, and over HTTP language.lsp is -32601", async () => {
  await withNotebook(async (daemon, add) => {
    const a = await add("let count = 0;");
    const b = await add("count = count + 1;");
    await connect(daemon.client, { [a]: "let count = 0;" });
    const { cells } = await daemon.client.call(languageRename, {
      notebook,
      cell: a,
      position: { line: 0, character: 5 },
      newName: "total",
    });
    expect(cells).toEqual([a, b]);
    const updated = await daemon.events.until("cell.updated", (e) => e.data.cell.id === b);
    expect(updated.data.cell.source).toBe("total = total + 1;");
    await expect(
      daemon.client.call(languageRename, {
        notebook,
        cell: a,
        position: { line: 0, character: 5 },
        newName: "class",
      }),
    ).rejects.toMatchObject({ message: "class is not a valid name." });
    await expect(
      daemon.http().call(languageLsp, { notebook, message: "{}" }),
    ).rejects.toMatchObject({ code: -32601 });
  });
});

test("language.rename by name: the declaring cell's first real place, past a comment and a string", async () => {
  await withNotebook(async (daemon, add) => {
    const a = await add('// count starts at zero\nconst label = "count";\nlet count = 0;');
    const b = await add("count = count + 1;");
    const { cells } = await daemon.client.language.rename({
      notebook,
      name: "count",
      newName: "n",
    });
    expect(cells).toEqual([a, b]);
    const updated = await daemon.events.until("cell.updated", (e) => e.data.cell.id === a);
    // the comment and the string keep the word; only the binding and its uses change
    expect(updated.data.cell.source).toBe(
      '// count starts at zero\nconst label = "count";\nlet n = 0;',
    );
    await expect(
      daemon.client.language.rename({ notebook, name: "missing", newName: "x" }),
    ).rejects.toMatchObject({ message: "missing is not a name in any code cell." });
    await expect(daemon.client.language.rename({ notebook, newName: "x" })).rejects.toMatchObject({
      name: "InvalidParams",
    });
  });
});

const typed = {
  name: "typed-pkg",
  version: "1.0.0",
  files: {
    "package.json": JSON.stringify({
      name: "typed-pkg",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
    }),
    "index.js": "export const count = 1;\n",
    "index.d.ts": "export declare const count: number;\n",
  },
};

test("an install clears 'not installed' and the package's types apply", async () => {
  await withNotebook(async (daemon, add, ws) => {
    const cell = await add('import { count } from "typed-pkg";\nconst label: string = count;');
    const before = await daemon.client.notebook.diagnostics({ notebook, cell });
    expect(messagesOf(before.cells, cell)[0]).toContain('Package "typed-pkg" is not installed');
    const registry = await startRegistry(ws, [typed]);
    try {
      await daemon.client.settings.set({ key: "packages.manager", value: "npm" });
      await daemon.client.packages.add({ names: ["typed-pkg"] });
      const after = await daemon.events.until(
        "cell.diagnostics",
        (e) =>
          e.data.cell === cell &&
          !e.data.diagnostics.some((d) => d.message.includes("not installed")),
      );
      expect(after.data.diagnostics.map((d) => d.message)).toEqual([
        "Type 'number' is not assignable to type 'string'.",
      ]);
    } finally {
      await registry.close();
    }
  });
});

test("a cell switched to markdown gets an empty list, so a page drops its rows", async () => {
  await withNotebook(async (daemon, add) => {
    const cell = await add("undefinedThing;");
    await daemon.client.notebook.diagnostics({ notebook });
    await daemon.client.cell.update({ notebook, cell, type: "markdown" });
    const cleared = await daemon.events.until("cell.diagnostics", (e) => e.data.cell === cell);
    expect(cleared.data.diagnostics).toEqual([]);
  });
});

test("notebook.bridge: each export once with TypeScript's signature, its JSDoc and its client callers", async () => {
  await withNotebook(async (daemon, add) => {
    const server = await add(
      "/** Doubles it. */\nexport async function twice(n: number) {\n  return { value: n * 2 };\n}\nexport const label = 'x';",
    );
    await add("export function twice() {}");
    const page = await add("await twice(2);", "client");
    await add("const twice = 1;", "client");
    const { exports } = await daemon.client.call(notebookBridge, { notebook });
    expect(exports).toEqual([
      {
        name: "twice",
        cell: server,
        signature: "function twice(n: number): Promise<{\n    value: number;\n}>",
        documentation: "Doubles it.",
        callers: [page],
      },
      expect.objectContaining({ name: "label", cell: server, callers: [] }),
    ]);
  });
});
