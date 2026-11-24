// Writes, autosave and conflicts of 07-file-format §5 through the daemon: one write per burst, the file's exact text,
// a conflict when the file changed on disk, reload by cell id, a forced save, and a failed write retried.
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";

import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

describe("autosave", () => {
  it("writes one file for a burst of edits, atomically, with the cells in order", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const added = await daemon.client.cell.add({
        notebook: "a.jsnb",
        type: "server",
        source: "1",
      });
      // one burst: the updates go out together, so a loaded machine's round trips (two awaited ones fell more than the
      // 100 ms coalescing window apart in a full run) do not split it in two; the socket keeps their order
      const sources = ["const a = 1", "const a = 2\nexport { a }", "const a = 3"];
      await Promise.all(
        sources.map((source) =>
          daemon.client.cell.update({ notebook: "a.jsnb", cell: added.cell.id, source }),
        ),
      );
      const first = await daemon.events.until("notebook.saved");
      const saved = daemon.events.all().filter((e) => e.type === "notebook.saved");
      expect(saved).toHaveLength(1);
      const text = await readFile(ws.path("a.jsnb"), "utf8");
      expect(JSON.parse(text)).toMatchObject({
        cells: [{ id: added.cell.id, source: ["const a = 3"] }],
      });
      expect((await readdir(ws.dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
      const state = await daemon.client.notebook.get({ notebook: "a.jsnb" });
      expect(state.notebook).toMatchObject({ dirty: false, savedAt: first.data.savedAt });
    });
  });
});

// With files.mergeExternalChanges off, an external edit is found by the next save (external.integration.test.ts
// has the merge).
const mergeOff = (daemon: Daemon) =>
  daemon.client.settings.set({ key: "files.mergeExternalChanges", value: false });

describe("a conflict", () => {
  it("suspends autosave when the file changed on disk, until a forced save", async () => {
    await withDaemon(async (daemon, ws) => {
      await mergeOff(daemon);
      await daemon.client.notebook.create({ path: "a.jsnb" });
      await writeFile(ws.path("a.jsnb"), '{ "version": 1, "cells": [] }\n');
      await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "mine" });
      await daemon.events.until("notebook.conflict");
      expect(await readFile(ws.path("a.jsnb"), "utf8")).toBe('{ "version": 1, "cells": [] }\n');
      await expect(daemon.client.notebook.save({ notebook: "a.jsnb" })).rejects.toMatchObject({
        code: 1007,
      });
      await daemon.client.notebook.save({ notebook: "a.jsnb", force: true });
      expect(await readFile(ws.path("a.jsnb"), "utf8")).toContain('"mine"');
    });
  });
});

describe("notebook.reload", () => {
  it("resolves a conflict, reconciling by cell id", async () => {
    await withDaemon(async (daemon, ws) => {
      await mergeOff(daemon);
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const kept = (
        await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "k" })
      ).cell;
      const gone = (
        await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "g" })
      ).cell;
      await daemon.events.until("notebook.saved");
      const disk = {
        version: 1,
        cells: [
          { type: "markdown", source: ["new"] },
          { id: kept.id, type: "markdown", source: ["k2"] },
        ],
      };
      await writeFile(ws.path("a.jsnb"), JSON.stringify(disk));
      await daemon.client.cell.update({
        notebook: "a.jsnb",
        cell: kept.id,
        meta: { collapsed: true },
      });
      const conflict = await daemon.events.until("notebook.conflict");
      const reloaded = await daemon.client.notebook.reload({ notebook: "a.jsnb" });
      expect(reloaded.notebook.cells.map((cell) => cell.source)).toEqual(["new", "k2"]);
      expect(reloaded.notebook.cells[1]?.id).toBe(kept.id);
      await daemon.events.until("cell.deleted", (e) => e.data.cell === gone.id);
      await daemon.events.until("notebook.saved", (e) => e.seq > conflict.seq);
    });
  });
});

describe("a failed write", () => {
  it("emits notebook.saveFailed, keeps the state and saves at the next change", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: "dir/a.jsnb" });
      await chmod(ws.path("dir"), 0o555);
      try {
        await daemon.client.cell.add({ notebook: "dir/a.jsnb", type: "markdown", source: "x" });
        const failed = await daemon.events.until("notebook.saveFailed");
        expect(failed.data).toMatchObject({ path: "dir/a.jsnb", error: { code: "EACCES" } });
        await expect(daemon.client.notebook.save({ notebook: "dir/a.jsnb" })).rejects.toMatchObject(
          {
            data: { name: "SaveFailed" },
          },
        );
      } finally {
        await chmod(ws.path("dir"), 0o755);
      }
      await daemon.client.cell.add({ notebook: "dir/a.jsnb", type: "markdown", source: "y" });
      await daemon.events.until("notebook.saved");
      expect(await readFile(ws.path("dir/a.jsnb"), "utf8")).toContain('"y"');
    });
  });
});
