// External edits of an open notebook's file (07-file-format §5) through the daemon and real files: the session takes a
// change made on disk while nothing is unsaved (outputs kept where the code did not change, the change stamped as the
// file's), merges it with unsaved edits of other cells and writes the result, and keeps the conflict path for the same
// cell changed on both sides; the daemon's own writes, a file that does not parse, an atomic rename, a burst, a delete,
// a running cell and the setting that turns it off.
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { connectDaemon, withDaemon } from "../../fixtures/daemon.js";
import { createNotebook } from "../../fixtures/notebook.js";

type FileCell = { id: string; type: string; source: string[]; meta?: Record<string, unknown> };
type FileDoc = { version: number; cells: FileCell[]; [key: string]: unknown };

const lines = (source: string) => source.split("\n");

/** Reads the notebook's file, lets `change` edit it, and writes it back as an editor would (in place). */
async function edit(path: string, change: (doc: FileDoc) => void): Promise<string> {
  const doc = JSON.parse(await readFile(path, "utf8")) as FileDoc;
  change(doc);
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  await writeFile(path, text);
  return text;
}

const cellOf = (doc: FileDoc, id: string): FileCell => {
  const found = doc.cells.find((cell) => cell.id === id);
  if (found === undefined) throw new Error(`no cell ${id}`);
  return found;
};

/** The notebook's cells as the session has them: id and source. */
async function sessionCells(daemon: Daemon, notebook = "a.jsnb") {
  const { notebook: state } = await daemon.client.notebook.get({ notebook });
  return state.cells.map((cell) => ({ id: cell.id, source: cell.source }));
}

/** `cell` edited to "mine" here and to `theirs` on disk; resolves with the file's text once the conflict after `after`
 * came. */
async function conflictOn(
  daemon: Daemon,
  at: {
    readonly path: string;
    readonly cell: string;
    readonly theirs: string;
    readonly after?: number;
  },
) {
  await daemon.client.cell.update({ notebook: "a.jsnb", cell: at.cell, source: "mine" });
  const text = await edit(at.path, (doc) => {
    cellOf(doc, at.cell).source = [at.theirs];
  });
  const event = await daemon.events.until(
    "notebook.conflict",
    (e) => e.seq > (at.after ?? -1) && e.data.cells?.includes(at.cell) === true,
  );
  return { text, seq: event.seq };
}

/** Three server cells, the first run, all saved. */
async function threeSaved(daemon: Daemon) {
  const book = await createNotebook(daemon);
  const first = await book.ran("export const a = 1; a");
  const second = await book.add("export const b = 2");
  const third = await book.add("a + b");
  await daemon.client.notebook.save({ notebook: "a.jsnb" });
  return { book, ids: [first.cell, second, third] as const, ran: first.execution };
}

describe("an external edit with nothing unsaved", () => {
  it("is taken in place: kept cells keep their runs, changes are stamped as the file's, nothing is written", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids, ran } = await threeSaved(daemon);
      const [a, b, c] = ids;
      const path = ws.path("a.jsnb");
      const written = await edit(path, (doc) => {
        cellOf(doc, b).source = lines("export const b = 20");
        doc.cells = doc.cells.filter((cell) => cell.id !== c);
        doc.cells.push({ id: "c_zzzzzz", type: "markdown", source: ["# new"] });
      });
      const mtime = (await stat(path)).mtimeMs;
      const event = await daemon.events.until("notebook.reconciled");
      expect(event.data).toMatchObject({
        outcome: "merged",
        changed: [b],
        added: ["c_zzzzzz"],
        removed: [c],
        kept: false,
      });
      expect(await sessionCells(daemon)).toEqual([
        { id: a, source: "export const a = 1; a" },
        { id: b, source: "export const b = 20" },
        { id: "c_zzzzzz", source: "# new" },
      ]);
      const state = (await daemon.client.notebook.get({ notebook: "a.jsnb" })).notebook;
      expect(state.dirty).toBe(false);
      const [kept, changed] = state.cells;
      expect(kept?.lastExecution?.id).toBe(ran.id);
      expect(changed?.meta.lastEdit).toMatchObject({ by: "external", client: "file" });
      expect(changed?.meta.lastEdit?.review?.lines).toEqual([{ from: 1, to: 1 }]);
      await daemon.client.notebook.save({ notebook: "a.jsnb" });
      expect(await readFile(path, "utf8")).toBe(written);
      expect((await stat(path)).mtimeMs).toBe(mtime);
    });
  });
});

describe("an external edit with nothing unsaved", () => {
  it("never takes the daemon's own writes for external ones", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      for (const source of ["1", "2", "3"]) {
        await daemon.client.cell.update({ notebook: "a.jsnb", cell: ids[2], source });
        await daemon.client.notebook.save({ notebook: "a.jsnb" });
      }
      // the checks run one at a time in the order of the writes: this edit's reconcile is the first of all
      await edit(ws.path("a.jsnb"), (doc) => {
        cellOf(doc, ids[0]).source = ["export const a = 9; a"];
      });
      await daemon.events.until("notebook.reconciled");
      const reconciled = daemon.events.all().filter((e) => e.type === "notebook.reconciled");
      expect(reconciled.map((e) => e.data)).toMatchObject([{ changed: [ids[0]] }]);
    });
  });
});

describe("an external edit with nothing unsaved", () => {
  it("follows an editor's atomic save (a temp file renamed over the notebook)", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const path = ws.path("a.jsnb");
      const doc = JSON.parse(await readFile(path, "utf8")) as FileDoc;
      cellOf(doc, ids[2]).source = ["a * b"];
      await writeFile(`${path}.swp`, `${JSON.stringify(doc, null, 2)}\n`);
      await rename(`${path}.swp`, path);
      await daemon.events.until("notebook.reconciled");
      expect((await sessionCells(daemon))[2]?.source).toBe("a * b");
    });
  });
});

describe("an external edit with nothing unsaved", () => {
  it("takes the last of a burst of writes, in few reconciles", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const path = ws.path("a.jsnb");
      for (let n = 0; n < 20; n += 1)
        await edit(path, (doc) => {
          cellOf(doc, ids[2]).source = [`a + ${String(n)}`];
        });
      await daemon.events.until("notebook.reconciled", (e) => e.data.changed.includes(ids[2]));
      await expect
        .poll(async () => (await sessionCells(daemon))[2]?.source, { timeout: 5000 })
        .toBe("a + 19");
      const count = daemon.events.all().filter((e) => e.type === "notebook.reconciled").length;
      expect(count).toBeLessThan(10);
    });
  });
});

describe("an external edit with unsaved edits", () => {
  it("merges changes of different cells and writes the result through the normal save", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      const [a, b] = ids;
      await daemon.client.cell.update({
        notebook: "a.jsnb",
        cell: a,
        source: "export const a = 5; a",
      });
      const path = ws.path("a.jsnb");
      await edit(path, (doc) => {
        cellOf(doc, b).source = ["export const b = 7"];
      });
      const event = await daemon.events.until("notebook.reconciled");
      expect(event.data).toMatchObject({ outcome: "merged", changed: [b], kept: true });
      const state = (await daemon.client.notebook.get({ notebook: "a.jsnb" })).notebook;
      expect(state.dirty).toBe(true);
      await daemon.client.notebook.save({ notebook: "a.jsnb" });
      const doc = JSON.parse(await readFile(path, "utf8")) as FileDoc;
      expect(cellOf(doc, a).source).toEqual(["export const a = 5; a"]);
      expect(cellOf(doc, b).source).toEqual(["export const b = 7"]);
    });
  });
});

describe("an external edit with unsaved edits", () => {
  it("keeps the conflict path for the same cell changed on both sides, resolved by reload, overwrite or seen in a diff", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      const cell = ids[2];
      const path = ws.path("a.jsnb");
      const first = await conflictOn(daemon, { path, cell, theirs: "theirs" });
      const disk = first.text;
      const conflict = daemon.events.all().find((e) => e.type === "notebook.reconciled");
      expect(conflict?.data).toMatchObject({ outcome: "conflict", changed: [cell] });
      expect((await sessionCells(daemon))[2]?.source).toBe("mine");
      const diff = await daemon.client.notebook.compareDisk({ notebook: "a.jsnb", content: true });
      expect(diff).toMatchObject({ from: "disk", to: "session", kind: "notebook" });
      const rows = diff.notebook?.rows.filter((row) => row.status !== "unchanged");
      expect(rows?.map((row) => row.after?.id)).toEqual([cell]);
      await expect(daemon.client.notebook.save({ notebook: "a.jsnb" })).rejects.toMatchObject({
        code: 1007,
      });
      expect(await readFile(path, "utf8")).toBe(disk);
      // theirs: reload from disk
      await daemon.client.notebook.reload({ notebook: "a.jsnb" });
      expect((await sessionCells(daemon))[2]?.source).toBe("theirs");
      // ours: overwrite with mine
      await conflictOn(daemon, { path, cell, theirs: "theirs again", after: first.seq });
      await daemon.client.notebook.save({ notebook: "a.jsnb", force: true });
      expect(cellOf(JSON.parse(await readFile(path, "utf8")) as FileDoc, cell).source).toEqual([
        "mine",
      ]);
    });
  });
});

describe("an external edit with unsaved edits", () => {
  it("is a conflict for a cell the page edited a moment ago, even once saved", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const page = await connectDaemon(daemon, { client: "ui" });
      try {
        await page.client.cell.update({ notebook: "a.jsnb", cell: ids[1], source: "typed" });
        await daemon.client.notebook.save({ notebook: "a.jsnb" });
        await edit(ws.path("a.jsnb"), (doc) => {
          cellOf(doc, ids[1]).source = ["from disk"];
        });
        const event = await daemon.events.until("notebook.reconciled");
        expect(event.data).toMatchObject({ outcome: "conflict", changed: [ids[1]] });
        expect((await sessionCells(daemon))[1]?.source).toBe("typed");
      } finally {
        page.client.close();
      }
    });
  });
});

describe("a file that does not parse", () => {
  it("leaves the session as it is, says so, and is merged once it parses again", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const path = ws.path("a.jsnb");
      const before = await readFile(path, "utf8");
      await writeFile(path, `<<<<<<< HEAD\n${before}=======\n{}\n>>>>>>> branch\n`);
      const bad = await daemon.events.until("notebook.reconciled");
      expect(bad.data).toMatchObject({ outcome: "unreadable", kept: true });
      expect(bad.data.error).toBeTruthy();
      expect(await sessionCells(daemon)).toHaveLength(3);
      await writeFile(path, before.replace('"a + b"', '"a - b"'));
      await daemon.events.until("notebook.reconciled", (e) => e.data.outcome === "merged");
      expect((await sessionCells(daemon))[2]).toEqual({ id: ids[2], source: "a - b" });
    });
  });
});

describe("a deleted notebook file", () => {
  it("changes nothing until it comes back, then the restored file is merged", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const path = ws.path("a.jsnb");
      const before = await readFile(path, "utf8");
      await rm(path);
      await writeFile(path, before.replace('"a + b"', '"b + a"'));
      await daemon.events.until("notebook.reconciled");
      expect((await sessionCells(daemon))[2]).toEqual({ id: ids[2], source: "b + a" });
      expect(daemon.events.all().some((e) => e.type === "notebook.conflict")).toBe(false);
    });
  });
});

describe("a running cell", () => {
  it("runs on when its source changes on disk, and ends when the file removes it", async () => {
    await withDaemon(async (daemon, ws) => {
      const book = await createNotebook(daemon);
      const slow = await book.add("await new Promise(() => {})");
      await daemon.client.notebook.save({ notebook: "a.jsnb" });
      const run = await book.start(slow);
      await book.reaches(run.id, "running");
      const path = ws.path("a.jsnb");
      await edit(path, (doc) => {
        cellOf(doc, slow).source = ["await new Promise(() => {}) // edited"];
      });
      await daemon.events.until("notebook.reconciled");
      const cell = (await daemon.client.cell.get({ notebook: "a.jsnb", cell: slow })).cell;
      expect(cell.status).toBe("running");
      expect(cell.source).toContain("// edited");
      await edit(path, (doc) => {
        doc.cells = [];
      });
      await daemon.events.until("notebook.reconciled", (e) => e.data.removed.includes(slow));
      expect(await sessionCells(daemon)).toEqual([]);
      // the run ended: the kernel takes the next one
      expect((await book.ran("1 + 1")).execution.status).toBe("ok");
    });
  });
});

describe("files.mergeExternalChanges off", () => {
  it("leaves the session alone, and the next save finds the conflict", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.mergeExternalChanges", value: false });
      const { ids } = await threeSaved(daemon);
      await edit(ws.path("a.jsnb"), (doc) => {
        cellOf(doc, ids[2]).source = ["from disk"];
      });
      await daemon.client.cell.update({ notebook: "a.jsnb", cell: ids[0], source: "1" });
      await daemon.events.until("notebook.conflict");
      expect((await sessionCells(daemon))[2]?.source).toBe("a + b");
      expect(daemon.events.all().some((e) => e.type === "notebook.reconciled")).toBe(false);
    });
  });
});

describe("the notebook list", () => {
  it("is announced when a notebook is created or deleted outside nimbo", async () => {
    await withDaemon(async (daemon, ws) => {
      await createNotebook(daemon);
      await writeFile(ws.path("b.jsnb"), '{ "version": 1, "cells": [] }\n');
      await daemon.events.until("notebooks.changed", (e) =>
        e.data.notebooks.some((n) => n.path === "b.jsnb"),
      );
      await rm(ws.path("b.jsnb"));
      await daemon.events.until("notebooks.changed", (e) =>
        e.data.notebooks.every((n) => n.path !== "b.jsnb"),
      );
    });
  });
});
