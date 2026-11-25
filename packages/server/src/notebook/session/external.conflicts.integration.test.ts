// External edits against the session's own changes (07-file-format §5): a page edit made on a text the file replaced
// since, an open conflict that outlives later edits of other cells, a write of another program landing during the
// daemon's, an explicit save, the saved state after a merge, a move after an atomic rewrite, the review trail of an
// agent's edit the file undid, a file caught mid-write, and the list's announcements.
import { readdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { textHash } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { connectDaemon, withDaemon } from "../../fixtures/daemon.js";
import { cellOf, docOf, edit, sessionCells, threeSaved } from "../../fixtures/external.js";
import { createNotebook } from "../../fixtures/notebook.js";

const notebook = "a.jsnb";

/** notebook.save refused: the conflict suspends it. */
const refused = (daemon: Daemon) =>
  expect(daemon.client.notebook.save({ notebook })).rejects.toMatchObject({ code: 1007 });

/** The source of `cell` in the file at `path`. */
const onDisk = async (path: string, cell: string) =>
  cellOf(docOf(await readFile(path, "utf8")), cell).source.join("\n");

/** Waits for the reconcile after event index `after` that `accept` takes. */
const reconciled = (
  daemon: Daemon,
  accept: (data: { outcome: string; changed: readonly string[] }) => boolean,
) => daemon.events.until("notebook.reconciled", (e) => accept(e.data));

describe("a page edit made on a text the file replaced since", () => {
  it("is a conflict holding both texts, whatever the timing", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const cell = ids[2];
      const path = ws.path(notebook);
      const page = await connectDaemon(daemon, { client: "ui" });
      try {
        const disk = await edit(path, (doc) => {
          cellOf(doc, cell).source = ["const x = 99"];
        });
        await reconciled(daemon, (d) => d.outcome === "merged" && d.changed.includes(cell));
        // the draft typed on "a + b" reaches the daemon after the file's edit was merged
        const base = textHash("a + b");
        await page.client.cell.update({ notebook, cell, source: "a + b // typed", base });
        const conflict = await daemon.events.until("notebook.conflict");
        expect(conflict.data.cells).toEqual([cell]);
        expect((await sessionCells(daemon))[2]?.source).toBe("a + b // typed");
        expect(await readFile(path, "utf8")).toBe(disk);
        await refused(daemon);
        const diff = await daemon.client.notebook.compareDisk({ notebook, content: true });
        const rows = diff.notebook?.rows.filter((row) => row.status !== "unchanged") ?? [];
        expect(rows.map((row) => [row.before?.source, row.after?.source])).toEqual([
          ["const x = 99", "a + b // typed"],
        ]);
      } finally {
        page.client.close();
      }
    });
  });
});

describe("a page edit made on the file's text", () => {
  it("is an edit like any other, and a stale one in a run is a conflict", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const [, second, third] = ids;
      const page = await connectDaemon(daemon, { client: "ui" });
      try {
        await edit(ws.path(notebook), (doc) => {
          cellOf(doc, second).source = ["export const b = 3"];
          cellOf(doc, third).source = ["a * b"];
        });
        await reconciled(daemon, (d) => d.changed.length === 2);
        const base = textHash("export const b = 3");
        await page.client.cell.update({
          notebook,
          cell: second,
          source: "export const b = 4",
          base,
        });
        await page.client.cell.run({
          notebook,
          cell: third,
          source: "a - b",
          base: textHash("a + b"),
        });
        const conflict = await daemon.events.until("notebook.conflict");
        expect(conflict.data.cells).toEqual([third]);
        expect((await sessionCells(daemon)).map((c) => c.source).slice(1)).toEqual([
          "export const b = 4",
          "a - b",
        ]);
      } finally {
        page.client.close();
      }
    });
  });
});

describe("an open conflict", () => {
  it("outlives a later edit of other cells, and ends only when the file stops differing", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      const [first, second, third] = ids;
      const path = ws.path(notebook);
      await daemon.client.cell.update({ notebook, cell: first, source: "export const a = 7; a" });
      await edit(path, (doc) => {
        cellOf(doc, first).source = ["export const a = 8; a"];
        cellOf(doc, second).source = ["export const b = 8"];
      });
      const one = await reconciled(daemon, (d) => d.outcome === "conflict");
      expect(one.data.changed).toEqual([first]);
      await edit(path, (doc) => {
        cellOf(doc, third).source = ["a / b"];
      });
      const two = await daemon.events.until("notebook.reconciled", (e) => e.seq > one.seq);
      expect(two.data).toMatchObject({ outcome: "conflict", changed: [first] });
      expect((await sessionCells(daemon)).map((c) => c.source)).toEqual([
        "export const a = 7; a",
        "export const b = 8",
        "a / b",
      ]);
      await refused(daemon);
      // the file takes the base's text of the cell back: nothing differs from ours any more but ours
      await edit(path, (doc) => {
        cellOf(doc, first).source = ["export const a = 1; a"];
      });
      await daemon.events.until(
        "notebook.reconciled",
        (e) => e.seq > two.seq && e.data.outcome === "merged",
      );
      await daemon.client.notebook.save({ notebook });
      expect(await onDisk(path, first)).toBe("export const a = 7; a");
      expect(await onDisk(path, third)).toBe("a / b");
    });
  });
});

describe("a write of another program during the daemon's", () => {
  it("is merged, never overwritten", async () => {
    await withDaemon(async (daemon, ws) => {
      const book = await createNotebook(daemon);
      const big = await book.add(`# ${"x".repeat(8 * 1024 * 1024)}`, "markdown");
      const mine = await book.add("1");
      const theirs = await book.add("2");
      await daemon.client.notebook.save({ notebook });
      const path = ws.path(notebook);
      const doc = docOf(await readFile(path, "utf8"));
      doc.cells = doc.cells.filter((cell) => cell.id !== big);
      cellOf(doc, theirs).source = ["2 + 2"];
      const text = `${JSON.stringify(doc, null, 2)}\n`;
      // the other program writes the moment the daemon's temp file appears, long before its 8 MB are written
      const landed = new Promise<void>((resolve) => {
        const look = () => {
          if (readdirSync(ws.dir).some((name) => name.includes(".tmp-"))) {
            writeFileSync(path, text);
            resolve();
          } else setImmediate(look);
        };
        look();
      });
      await daemon.client.cell.update({ notebook, cell: mine, source: "1 + 1" });
      await landed;
      await expect
        .poll(async () => (await sessionCells(daemon)).map((c) => c.source), { timeout: 5000 })
        .toEqual(["1 + 1", "2 + 2"]);
      await daemon.client.notebook.save({ notebook });
      expect(docOf(await readFile(path, "utf8")).cells.map((c) => c.source.join("\n"))).toEqual([
        "1 + 1",
        "2 + 2",
      ]);
    });
  });
});

describe("notebook.save", () => {
  it("writes a state that differs from the file only in form", async () => {
    await withDaemon(async (daemon, ws) => {
      const book = await createNotebook(daemon);
      await book.ran("40 + 2");
      await daemon.client.notebook.save({ notebook });
      expect(await readFile(ws.path(notebook), "utf8")).not.toContain('"outputs"');
      await daemon.client.settings.set({ key: "outputs.save", value: "always" });
      await daemon.client.notebook.save({ notebook });
      expect(await readFile(ws.path(notebook), "utf8")).toContain('"outputs"');
    });
  });
});

describe("the saved state after a merge", () => {
  it("stays unsaved while an edit of the session is not on disk", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      await daemon.client.cell.update({ notebook, cell: ids[0], source: "export const a = 5; a" });
      const from = daemon.events.all().length;
      await edit(ws.path(notebook), (doc) => {
        cellOf(doc, ids[2]).source = ["a % b"];
      });
      await reconciled(daemon, (d) => d.outcome === "merged");
      expect((await daemon.client.notebook.get({ notebook })).notebook.dirty).toBe(true);
      const later = daemon.events.all().slice(from);
      expect(later.some((e) => e.type === "notebook.saved")).toBe(false);
    });
  });
});

describe("a notebook rewritten atomically, then moved", () => {
  it("is followed to its new path", async () => {
    await withDaemon(
      async (daemon, ws) => {
        const { ids } = await threeSaved(daemon);
        const path = ws.path(notebook);
        const doc = docOf(await readFile(path, "utf8"));
        cellOf(doc, ids[2]).source = ["a ** b"];
        await writeFile(`${path}.swp`, `${JSON.stringify(doc, null, 2)}\n`);
        await rename(`${path}.swp`, path);
        await reconciled(daemon, (d) => d.outcome === "merged");
        await mkdir(ws.path("sub"));
        await rename(path, ws.path("sub", "b.jsnb"));
        const moved = await daemon.events.until("notebook.moved");
        expect(moved.data).toEqual({ path: notebook, to: "sub/b.jsnb" });
      },
      { rootCheckMs: 50 },
    );
  });
});

describe("an agent's edit the file undoes", () => {
  it("keeps its review trail: the mark says the disk replaced it, the agent's text recoverable", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const cell = ids[2];
      await daemon.client.cell.markReviewed({ notebook, cell });
      await daemon.client.cell.update({ notebook, cell, source: "agent's text" });
      await daemon.client.notebook.save({ notebook });
      await edit(ws.path(notebook), (doc) => {
        cellOf(doc, cell).source = ["a + b"];
      });
      await reconciled(daemon, (d) => d.changed.includes(cell));
      const edited = (await daemon.client.cell.get({ notebook, cell })).cell.meta.lastEdit;
      expect(edited).toMatchObject({ by: "external", review: { previousSource: "agent's text" } });
    });
  });
});

describe("an agent's new cell the file rewrites", () => {
  it("keeps the agent's text as the code a revert brings back", async () => {
    await withDaemon(async (daemon, ws) => {
      await createNotebook(daemon);
      const added = await daemon.client.cell.add({
        notebook,
        type: "server",
        source: "agent's cell",
      });
      await daemon.client.notebook.save({ notebook });
      await edit(ws.path(notebook), (doc) => {
        cellOf(doc, added.cell.id).source = ["the file's text"];
      });
      await reconciled(daemon, (d) => d.changed.includes(added.cell.id));
      const cell = (await daemon.client.cell.get({ notebook, cell: added.cell.id })).cell;
      expect(cell.meta.lastEdit).toMatchObject({
        by: "external",
        review: { previousSource: "agent's cell" },
      });
      await daemon.client.cell.revert({ notebook, cell: added.cell.id });
      expect((await daemon.client.cell.get({ notebook, cell: added.cell.id })).cell.source).toBe(
        "agent's cell",
      );
    });
  });
});

describe("a file caught mid-write", () => {
  it("is merged once complete, without saying it does not parse", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      const path = ws.path(notebook);
      const doc = docOf(await readFile(path, "utf8"));
      cellOf(doc, ids[2]).source = ["b - a"];
      const text = `${JSON.stringify(doc, null, 2)}\n`;
      await writeFile(path, text.slice(0, 40));
      await new Promise((resolve) => setTimeout(resolve, 150)); // the half the program wrote first, seen by the watch
      await writeFile(path, text);
      await reconciled(daemon, (d) => d.outcome === "merged");
      const outcomes = daemon.events
        .all()
        .flatMap((e) => (e.type === "notebook.reconciled" ? [e.data.outcome] : []));
      expect(outcomes).toEqual(["merged"]);
    });
  });
});

describe("the notebook list", () => {
  it("is not announced for a save of an open notebook", async () => {
    await withDaemon(async (daemon, ws) => {
      await createNotebook(daemon);
      const added = await daemon.client.cell.add({ notebook, type: "server", source: "1" });
      await daemon.client.notebook.save({ notebook });
      const from = daemon.events.all().length;
      await daemon.client.cell.update({ notebook, cell: added.cell.id, source: "2" });
      await daemon.client.notebook.save({ notebook });
      await writeFile(ws.path("c.jsnb"), '{ "version": 1, "cells": [] }\n');
      await daemon.events.until("notebooks.changed", (e) =>
        e.data.notebooks.some((n) => n.path === "c.jsnb"),
      );
      const announced = daemon.events
        .all()
        .slice(from)
        .filter((e) => e.type === "notebooks.changed");
      expect(announced).toHaveLength(1);
    });
  });
});
