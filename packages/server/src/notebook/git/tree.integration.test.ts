// A git operation rewriting an open notebook's file goes through the merge of external edits,
// once: a pull changing another cell than the one typed in keeps both with no conflict; one changing the typed cell is
// one conflict holding the typing, the pulled text on disk, a recovery copy kept; a discard with unsaved typing ends
// as the index's version; a stash saves the typing first, so it takes and its pop brings back what the page showed;
// with files.mergeExternalChanges off the app's own discard and pull still bring the notebook in step.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import { cellOf, docOf, edit } from "../../fixtures/external.js";
import {
  isolateGit,
  makeRepo,
  notebookText,
  pushFrom,
  sh,
  withRemote,
} from "../../fixtures/git.js";

isolateGit();

const notebook = "n.jsnb";
const cells = (a: string, b: string) =>
  notebookText([
    { id: "c_aaaaaa", source: a },
    { id: "c_bbbbbb", source: b },
  ]);

/** A daemon on `ws` with autosave off and the notebook open, the typing "const a = 2;" in cell a not on disk. */
async function typed(ws: Workspace) {
  const daemon = await startDaemon(ws);
  await daemon.client.settings.set({ key: "files.autoSave", value: "off" });
  await daemon.client.notebook.open({ path: notebook });
  await daemon.client.cell.update({ notebook, cell: "c_aaaaaa", source: "const a = 2;" });
  return daemon;
}

type Daemon = Awaited<ReturnType<typeof typed>>;

const sources = async (daemon: Daemon) =>
  (await daemon.client.notebook.get({ notebook })).notebook.cells.map((cell) => cell.source);

const onDisk = async (ws: Workspace, cell: string) =>
  cellOf(docOf(await readFile(ws.path(notebook), "utf8")), cell).source.join("\n");

/** The events of `type` about the notebook so far, after the watch had its moment to see the same change. */
async function settled(daemon: Daemon, type: "notebook.conflict" | "notebook.reconciled") {
  await new Promise((resolve) => setTimeout(resolve, 600)); // the watch's debounce and a check
  return daemon.events.all().filter((event) => event.type === type);
}

it("keeps the typing and takes a pulled change of another cell, with no conflict, merged once", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { [notebook]: cells("const a = 1;", "const b = 1;") });
    await withRemote(ws.dir, async ({ other }) => {
      await pushFrom(other, { [notebook]: cells("const a = 1;", "const b = 9;") });
      const daemon = await typed(ws);
      await daemon.client.git.pull({ confirm: true }); // the unsaved typing counts as a change
      expect(await sources(daemon)).toEqual(["const a = 2;", "const b = 9;"]);
      expect((await daemon.client.notebook.get({ notebook })).notebook.conflict).toBeUndefined();
      expect(await settled(daemon, "notebook.conflict")).toEqual([]);
      const merged = await settled(daemon, "notebook.reconciled");
      expect(merged.map((event) => event.data)).toEqual([
        expect.objectContaining({ outcome: "merged", changed: ["c_bbbbbb"] }),
      ]);
    });
  });
});

it("holds the typed cell in one conflict when the pull changed it, the pulled text on disk", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { [notebook]: cells("const a = 1;", "const b = 1;") });
    await withRemote(ws.dir, async ({ other }) => {
      await pushFrom(other, { [notebook]: cells("const a = 7;", "const b = 1;") });
      const daemon = await typed(ws);
      await daemon.client.git.pull({ confirm: true }); // the unsaved typing counts as a change
      const state = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(state.conflict).toEqual({ cells: ["c_aaaaaa"] });
      expect(state.cells[0]?.source).toBe("const a = 2;");
      expect(await onDisk(ws, "c_aaaaaa")).toBe("const a = 7;");
      expect(await settled(daemon, "notebook.conflict")).toHaveLength(1);
      await expect.poll(async () => (await readdir(ws.path(".jsnb", "recovery"))).length).toBe(1);
    });
  });
});

it("ends a discard with unsaved typing as the index's version, with no conflict", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { [notebook]: cells("const a = 1;", "const b = 1;") });
    await edit(ws.path(notebook), (doc) => {
      cellOf(doc, "c_bbbbbb").source = ["const b = 5;"]; // a saved change, not committed
    });
    const daemon = await typed(ws);
    await daemon.client.git.discard({ paths: [notebook], confirm: true });
    expect(await sources(daemon)).toEqual(["const a = 1;", "const b = 1;"]);
    expect(await onDisk(ws, "c_aaaaaa")).toBe("const a = 1;");
    expect(sh(ws.dir, "status", "--porcelain").trim()).toBe("");
    expect(await settled(daemon, "notebook.conflict")).toEqual([]);
    expect(existsSync(ws.path(".jsnb", "recovery"))).toBe(true);
    expect(await readdir(ws.path(".jsnb", "recovery"))).toEqual([]);
  });
});

it("saves the unsaved typing before a stash, so the stash takes it and its pop brings it back", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { [notebook]: cells("const a = 1;", "const b = 1;") });
    await edit(ws.path(notebook), (doc) => {
      cellOf(doc, "c_bbbbbb").source = ["const b = 5;"];
    });
    const daemon = await typed(ws);
    expect(await sources(daemon)).toEqual(["const a = 2;", "const b = 5;"]);
    expect(await daemon.client.git.stash({})).toEqual({ created: true });
    expect(await onDisk(ws, "c_aaaaaa")).toBe("const a = 1;");
    expect(await sources(daemon)).toEqual(["const a = 1;", "const b = 1;"]);
    expect(await daemon.client.git.stashPop({ index: 0 })).toEqual({
      result: "applied",
      conflicts: [],
    });
    expect(await sources(daemon)).toEqual(["const a = 2;", "const b = 5;"]);
    expect(await settled(daemon, "notebook.conflict")).toEqual([]);
  });
});

it("stashes a notebook whose only change is unsaved typing, and pops it with autosave on", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { [notebook]: cells("const a = 1;", "const b = 1;") });
    const daemon = await startDaemon(ws);
    await daemon.client.settings.set({ key: "files.autoSave", value: "afterDelay" });
    await daemon.client.settings.set({ key: "files.autoSaveDelay", value: 5000 });
    await daemon.client.notebook.open({ path: notebook });
    await daemon.client.cell.update({ notebook, cell: "c_aaaaaa", source: "const a = 2;" });
    expect(await daemon.client.git.stash({})).toEqual({ created: true });
    expect(await settled(daemon, "notebook.conflict")).toEqual([]); // and no write after it
    expect(sh(ws.dir, "status", "--porcelain").trim()).toBe("");
    expect(await daemon.client.git.stashPop({ index: 0 })).toEqual({
      result: "applied",
      conflicts: [],
    });
    expect(await sources(daemon)).toEqual(["const a = 2;", "const b = 1;"]);
  });
});

describe("with files.mergeExternalChanges off", () => {
  /** A daemon with merging off and autosave at once, the notebook open with "const b = 5;" saved but not committed. */
  async function savedEdit(ws: Workspace) {
    const daemon = await startDaemon(ws);
    await daemon.client.settings.set({ key: "files.mergeExternalChanges", value: false });
    await daemon.client.notebook.open({ path: notebook });
    await daemon.client.cell.update({ notebook, cell: "c_bbbbbb", source: "const b = 5;" });
    await daemon.client.notebook.save({ notebook });
    return daemon;
  }

  it("still brings an open notebook in step with a discard", async () => {
    await withWorkspace(async (ws) => {
      await makeRepo(ws.dir, { [notebook]: cells("const a = 1;", "const b = 1;") });
      const daemon = await savedEdit(ws);
      await daemon.client.git.discard({ paths: [notebook], confirm: true });
      expect(await onDisk(ws, "c_bbbbbb")).toBe("const b = 1;");
      expect(await sources(daemon)).toEqual(["const a = 1;", "const b = 1;"]);
      const state = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(state.conflict).toBeUndefined();
      await daemon.client.cell.update({ notebook, cell: "c_aaaaaa", source: "const a = 3;" });
      await daemon.client.notebook.save({ notebook }); // no conflict: the session's base is the file
      expect(await onDisk(ws, "c_bbbbbb")).toBe("const b = 1;");
    });
  });

  it("still brings an open notebook in step with a pull", async () => {
    await withWorkspace(async (ws) => {
      await makeRepo(ws.dir, { [notebook]: cells("const a = 1;", "const b = 1;") });
      await withRemote(ws.dir, async ({ other }) => {
        await pushFrom(other, { [notebook]: cells("const a = 1;", "const b = 9;") });
        const daemon = await startDaemon(ws);
        await daemon.client.settings.set({ key: "files.mergeExternalChanges", value: false });
        await daemon.client.notebook.open({ path: notebook });
        await daemon.client.git.pull({});
        expect(await sources(daemon)).toEqual(["const a = 1;", "const b = 9;"]);
        expect((await daemon.client.notebook.get({ notebook })).notebook.conflict).toBeUndefined();
      });
    });
  });
});
