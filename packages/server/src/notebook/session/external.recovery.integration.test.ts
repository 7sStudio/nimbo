// The conflict's state as a page reads it, and the recovery copy of unsaved text (07-file-format §5, §7): a conflict
// that ends by itself says so, and notebook.get carries it; text a conflict or a failing save holds survives a close
// in `.jsnb/recovery/` and comes back as a conflict at the next open.
import { existsSync } from "node:fs";
import { chmod, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { cellOf, docOf, edit, sessionCells, threeSaved } from "../../fixtures/external.js";

const notebook = "a.jsnb";

const recoveryFile = (ws: { path: (...parts: string[]) => string }) =>
  ws.path(".jsnb", "recovery", "a.jsnb.json");

/** `cell` made "mine" here and "theirs" on disk, with autosave off: an open conflict on it. */
async function conflicted(daemon: Daemon, path: string, cell: string) {
  await daemon.client.cell.update({ notebook, cell, source: "mine" });
  await edit(path, (doc) => {
    cellOf(doc, cell).source = ["theirs"];
  });
  return daemon.events.until("notebook.conflict", (e) => e.data.cells?.includes(cell) === true);
}

describe("a conflict that ends by itself", () => {
  it("says so, and notebook.get follows it", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      const path = ws.path(notebook);
      await conflicted(daemon, path, ids[2]);
      const open = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(open.conflict).toEqual({ cells: [ids[2]] });
      await edit(path, (doc) => {
        cellOf(doc, ids[2]).source = ["a + b"]; // the base again
      });
      await daemon.events.until("notebook.conflictEnded");
      const after = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(after.conflict).toBeUndefined();
      expect(after.dirty).toBe(true);
      expect((await sessionCells(daemon))[2]?.source).toBe("mine");
    });
  });
});

describe("a close with a conflict open", () => {
  it("keeps the session's text in a recovery copy, taken back as a conflict at the next open", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      const path = ws.path(notebook);
      await conflicted(daemon, path, ids[2]);
      await expect.poll(() => existsSync(recoveryFile(ws))).toBe(true); // a crash now would leave it too
      await daemon.client.notebook.close({ notebook });
      expect(await readFile(recoveryFile(ws), "utf8")).toContain('"mine"');
      await daemon.client.notebook.open({ path: notebook });
      const reopened = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(reopened.conflict?.cells).toEqual([ids[2]]);
      expect(reopened.recovered).toBeTruthy();
      expect(reopened.cells[2]?.source).toBe("mine");
      expect(cellOf(docOf(await readFile(path, "utf8")), ids[2]).source).toEqual(["theirs"]);
      await daemon.client.notebook.save({ notebook, force: true });
      expect(cellOf(docOf(await readFile(path, "utf8")), ids[2]).source).toEqual(["mine"]);
      await expect.poll(() => existsSync(recoveryFile(ws))).toBe(false);
    });
  });
});

describe("a close whose last save fails", () => {
  it("keeps the unsaved text, taken back at the next open", async () => {
    await withDaemon(async (daemon, ws) => {
      const { ids } = await threeSaved(daemon);
      await chmod(ws.dir, 0o555);
      try {
        await daemon.client.cell.update({ notebook, cell: ids[1], source: "export const b = 9" });
        await daemon.events.until("notebook.saveFailed");
        await daemon.client.notebook.close({ notebook });
      } finally {
        await chmod(ws.dir, 0o755);
      }
      expect(await readFile(recoveryFile(ws), "utf8")).toContain("export const b = 9");
      await daemon.client.notebook.open({ path: notebook });
      const reopened = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(reopened.cells[1]?.source).toBe("export const b = 9");
      expect(reopened.conflict?.cells).toEqual([ids[1]]);
      await daemon.client.notebook.reload({ notebook });
      expect((await sessionCells(daemon))[1]?.source).toBe("export const b = 2");
      await expect.poll(() => existsSync(recoveryFile(ws))).toBe(false);
    });
  });
});
