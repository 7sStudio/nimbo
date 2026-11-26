// The conflict's state as a page reads it, and the recovery copy of unsaved text: a conflict
// that ends by itself says so, and notebook.get carries it; text a conflict or a failing save holds survives a close
// in `.jsnb/recovery/` and comes back as a conflict at the next open, whatever the length of the path; a copy is never
// written or read through a link put in place of the folder, and one of another notebook at the path, or one that
// cannot be read, is set aside, not taken.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import { cellOf, docOf, edit, sessionCells, threeSaved } from "../../fixtures/external.js";
import { logged } from "../../fixtures/folders.js";
import { createNotebook } from "../../fixtures/notebook.js";

const notebook = "a.jsnb";

type Paths = { path: (...parts: string[]) => string };

const copyName = (ref: string) => `${createHash("sha256").update(ref).digest("hex")}.json`;

const recoveryFile = (ws: Paths, ref = notebook) => ws.path(".jsnb", "recovery", copyName(ref));

/** `cell` made "mine" here and "theirs" on disk, with autosave off: an open conflict on it. */
async function conflicted(daemon: Daemon, path: string, cell: string, ref = notebook) {
  await daemon.client.cell.update({ notebook: ref, cell, source: "mine" });
  await edit(path, (doc) => {
    cellOf(doc, cell).source = ["theirs"];
  });
  return daemon.events.until("notebook.conflict", (e) => e.data.cells?.includes(cell) === true);
}

/** A folder outside the workspace, removed after `work`. */
async function outsideFolder<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "nimbo-outside-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `.jsnb/recovery` replaced by a link to `dir`, as another program could once the daemon runs. */
async function linkRecovery(ws: Paths, dir: string) {
  await rm(ws.path(".jsnb", "recovery"), { recursive: true });
  await symlink(dir, ws.path(".jsnb", "recovery"));
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

describe("a rename with a conflict open", () => {
  it("takes the recovery copy along, under the new ref", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      await conflicted(daemon, ws.path(notebook), ids[2]);
      await expect.poll(() => existsSync(recoveryFile(ws))).toBe(true);
      await daemon.client.notebook.rename({ path: notebook, to: "b.jsnb" });
      expect(existsSync(recoveryFile(ws))).toBe(false);
      expect(JSON.parse(await readFile(recoveryFile(ws, "b.jsnb"), "utf8"))).toMatchObject({
        notebook: "b.jsnb",
      });
    });
  });
});

describe("a recovery folder replaced by a symbolic link after the start", () => {
  it("takes no copy through it: nothing written there by a conflict and a close", async () => {
    await outsideFolder(async (outside) => {
      await withDaemon(async (daemon, ws) => {
        await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
        const { ids } = await threeSaved(daemon);
        await linkRecovery(ws, outside);
        await conflicted(daemon, ws.path(notebook), ids[2]);
        const log = ws.path(".jsnb", "logs", "daemon.log");
        await logged(log, "the recovery copy could not be kept");
        await daemon.client.notebook.close({ notebook });
        await logged(log, "its recovery copy could not be written: they are lost");
        expect(await readFile(log, "utf8")).not.toContain("they are kept in its recovery copy");
        expect(await readdir(outside)).toEqual([]);
      });
    });
  });

  it("reads no copy through it: one planted there is not applied at the open", async () => {
    await outsideFolder(async (outside) => {
      await withDaemon(async (daemon, ws) => {
        const { ids } = await threeSaved(daemon);
        await daemon.client.notebook.close({ notebook });
        const text = await readFile(ws.path(notebook), "utf8");
        const doc = docOf(text);
        cellOf(doc, ids[2]).source = ["planted"];
        const planted = { version: 1, notebook, at: "2026-01-01T00:00:00.000Z", base: text };
        const copy = `${JSON.stringify({ ...planted, mine: JSON.stringify(doc) })}\n`;
        await writeFile(join(outside, copyName(notebook)), copy);
        await linkRecovery(ws, outside);
        await daemon.client.notebook.open({ path: notebook });
        const opened = (await daemon.client.notebook.get({ notebook })).notebook;
        expect(opened.cells[2]?.source).toBe("a + b");
        expect(opened.conflict).toBeUndefined();
        expect(opened.recovered).toBeUndefined();
        expect(await readdir(outside)).toEqual([copyName(notebook)]);
      });
    });
  });
});

describe("a notebook whose ref is too long for a file name", () => {
  it("keeps its recovery copy, under a name of its own length", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const ref = "数据分析笔记本/第二季度的销售数据与客户行为研究/每周报告汇总和趋势预测.jsnb";
      expect(Buffer.byteLength(encodeURIComponent(ref))).toBeGreaterThan(255);
      await mkdir(ws.path("数据分析笔记本", "第二季度的销售数据与客户行为研究"), {
        recursive: true,
      });
      const book = await createNotebook(daemon, ref);
      const cell = await book.add("1 + 1");
      await daemon.client.notebook.save({ notebook: ref });
      await conflicted(daemon, ws.path(ref), cell, ref);
      await daemon.client.notebook.close({ notebook: ref });
      expect(await readFile(recoveryFile(ws, ref), "utf8")).toContain('"mine"');
      await daemon.client.notebook.open({ path: ref });
      const reopened = (await daemon.client.notebook.get({ notebook: ref })).notebook;
      expect(reopened.conflict?.cells).toEqual([cell]);
      expect(reopened.cells[0]?.source).toBe("mine");
    });
  });
});

describe("a recovery copy that is not this file's", () => {
  it("is set aside with its text when another notebook took the path, and when it cannot be read", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
      const { ids } = await threeSaved(daemon);
      await conflicted(daemon, ws.path(notebook), ids[2]);
      await daemon.client.notebook.close({ notebook });
      const kept = await readFile(recoveryFile(ws), "utf8");
      // another notebook at the same path: none of the copy's cells
      await rm(ws.path(notebook));
      await createNotebook(daemon);
      await daemon.client.cell.add({ notebook, type: "markdown", source: "# another" });
      await daemon.client.notebook.save({ notebook });
      await daemon.client.notebook.close({ notebook });
      await daemon.client.notebook.open({ path: notebook });
      const opened = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(opened.cells.map((each) => each.source)).toEqual(["# another"]);
      expect(opened.conflict).toBeUndefined();
      const folder = ws.path(".jsnb", "recovery");
      const asides = await readdir(folder);
      expect(asides).toHaveLength(1);
      expect(asides[0]).toMatch(/\.orphaned-.+\.json$/);
      expect(await readFile(join(folder, asides[0] ?? ""), "utf8")).toBe(kept);
      // cut short: set aside once, not read again at every open
      await daemon.client.notebook.close({ notebook });
      await rename(join(folder, asides[0] ?? ""), recoveryFile(ws));
      await writeFile(recoveryFile(ws), kept.slice(0, 40));
      await daemon.client.notebook.open({ path: notebook });
      expect((await daemon.client.notebook.get({ notebook })).notebook.conflict).toBeUndefined();
      const after = await readdir(folder);
      expect(after.filter((name) => name.includes(".unusable-"))).toHaveLength(1);
      expect(existsSync(recoveryFile(ws))).toBe(false);
    });
  });
});
