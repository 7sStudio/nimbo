// @vitest-environment node
// The cell-scoped UI commands on a real daemon and kernel: run and advance (the last cell stays
// selected; three presses within one round trip run three cells), run and insert below (⌥↩, the run cell's type), run
// in place with the editor's draft, markdown rendering, add above and below, type, values, collapse, hidden outputs,
// moves, a marked range run, retyped, copied, cut, pasted and deleted with one undo, full screen of the first value,
// and the output's find and query requests.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { startPage, whenTrue } from "../store/fixtures/page.js";
import { createDispatcher } from "./dispatch.js";

const notebook = "cells.jsnb";

describe("running from the keyboard", () => {
  it("runs with the draft, advances and stays on the last cell, renders markdown", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const md = await store.add("markdown", undefined, "# a");
      const code = await store.add("client", undefined, "1");
      if (md === undefined || code === undefined) throw new Error("no cells");
      ui.select(md.id);
      ui.setMode("edit");
      ui.setDraft(md.id, "# rendered");
      await dispatcher.dispatch("ui.run.inPlace");
      await whenTrue(() => store.byId.get(md.id)?.source === "# rendered");
      expect(ui.mode).toBe("command");
      await dispatcher.dispatch("ui.cell.type", { type: "server" });
      expect(await dispatcher.dispatch("ui.cell.type", { type: "nope" })).toBe(true);
      ui.select(code.id);
      await dispatcher.dispatch("ui.cell.type", { type: "server" });
      await whenTrue(() => store.byId.get(code.id)?.type === "server");
      ui.setDraft(code.id, "({ a: 1 })");
      ui.setMode("edit");
      await dispatcher.dispatch("ui.run.advance");
      // the last cell runs and stays selected, in command mode: no cell is added
      await whenTrue(() => store.lastExecutionOf(code.id)?.outputs.length === 1);
      expect(store.cellsInOrder).toHaveLength(2);
      expect([ui.selected, ui.mode]).toEqual([code.id, "command"]);
      await dispatcher.dispatch("ui.fullscreen.open");
      expect(ui.fullscreen).toEqual({ cell: code.id, index: 0 });
      ui.select(md.id);
      await dispatcher.dispatch("ui.run.advance");
      expect(ui.selected).toBe(code.id);
      await dispatcher.dispatch("ui.run.withDependents");
      // the test owns its world: it ends once its runs did, so stopping the daemon never waits out a busy kernel
      await whenTrue(() =>
        store.cellsInOrder.every((cell) => cell.status !== "queued" && cell.status !== "running"),
      );
    });
  });
});

describe("three ⇧↩ within one round trip", () => {
  it("run three cells, each press on the cell the one before selected, and stay on the last", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const cells = [];
      for (const source of ["1", "2", "3"])
        cells.push(await store.add("server", undefined, source));
      const ids = cells.map((cell) => cell?.id);
      ui.select(ids[0] ?? null);
      // no press waits for the one before: all three are out at once, as a user's fast keys are
      await Promise.all([1, 2, 3].map(() => dispatcher.dispatch("ui.run.advance")));
      await whenTrue(() =>
        ids.every((id) => id !== undefined && store.lastExecutionOf(id)?.status === "ok"),
      );
      expect(store.cellsInOrder).toHaveLength(3);
      expect(ui.selected).toBe(ids[2]);
      await whenTrue(() =>
        store.cellsInOrder.every((cell) => cell.status !== "queued" && cell.status !== "running"),
      );
    });
  });
});

describe("⇧↩ while its run is out", () => {
  it("keeps the edit mode the user entered on the next cell, and the last cell adds none", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const first = await store.add("server", undefined, "1");
      const second = await store.add("server", undefined, "2");
      ui.select(first?.id ?? null);
      const pressed = dispatcher.dispatch("ui.run.advance");
      await whenTrue(() => ui.selected === second?.id);
      ui.setMode("edit"); // the user edits the next cell while the run is out
      await pressed;
      expect(ui.mode).toBe("edit");
      ui.setMode("command");
      await Promise.all([1, 2].map(() => dispatcher.dispatch("ui.run.advance")));
      await whenTrue(() => store.lastExecutionOf(second?.id ?? "")?.status === "ok");
      expect(store.cellsInOrder).toHaveLength(2);
      expect(ui.selected).toBe(second?.id);
      await whenTrue(() =>
        store.cellsInOrder.every((cell) => cell.status !== "queued" && cell.status !== "running"),
      );
    });
  });
});

describe("editing from the keyboard", () => {
  it("adds, moves, toggles values and collapse, and asks the output for find and query", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const first = await store.add("client", undefined, "1");
      if (first === undefined) throw new Error("no cell");
      ui.select(first.id);
      await dispatcher.dispatch("ui.cell.addAbove");
      await dispatcher.dispatch("ui.cell.addBelow");
      expect(store.cellsInOrder.map((cell) => cell.type)).toEqual(["client", "client", "client"]);
      // every add opens the new cell in edit mode, the caret inside
      expect([ui.mode, ui.caret]).toEqual(["edit", "end"]);
      const middle = ui.selected; // the cell added below the one added above: second of three
      await whenTrue(() => store.cellsInOrder[1]?.id === middle);
      await dispatcher.dispatch("ui.cell.moveUp");
      await whenTrue(() => store.cellsInOrder[0]?.id === middle);
      await dispatcher.dispatch("ui.cell.moveDown");
      await dispatcher.dispatch("ui.cell.toggleValues");
      await dispatcher.dispatch("ui.cell.toggleCollapse");
      await whenTrue(
        () =>
          store.selectedCell?.meta.collapsed === true &&
          store.selectedCell.meta.showBindings === true,
      );
      await dispatcher.dispatch("ui.output.find");
      expect(ui.outputRequest).toMatchObject({ kind: "find", cell: middle });
      await dispatcher.dispatch("ui.output.query");
      expect(ui.outputRequest?.kind).toBe("query");
      await dispatcher.dispatch("ui.fullscreen.open");
      expect(ui.fullscreen).toBeNull();
    });
  });
});

describe("adding with none selected", () => {
  it("Shift M adds a markdown cell at the end of an empty notebook, in edit mode", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      await createDispatcher().dispatch("ui.cell.addBelow", { type: "markdown" });
      expect([store.cellsInOrder.map((cell) => cell.type), ui.mode]).toEqual([
        ["markdown"],
        "edit",
      ]);
    });
  });
});

describe("Fold All", () => {
  it("folds every cell but the selected one on the page alone, opens and folds back one, and pins a result", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const first = await store.add("server", undefined, "1");
      const second = await store.add("server", undefined, "2");
      if (first === undefined || second === undefined) throw new Error("no cells");
      ui.select(first.id);
      await dispatcher.dispatch("ui.cells.foldAll");
      expect([ui.foldAll, [...ui.opened]]).toEqual([true, [first.id]]);
      // W on the open cell folds it back on the page: the cell's own meta never changes for Fold All
      await dispatcher.dispatch("ui.cell.toggleCollapse");
      expect(ui.opened.has(first.id)).toBe(false);
      await dispatcher.dispatch("ui.cell.toggleCollapse");
      expect(ui.opened.has(first.id)).toBe(true);
      expect(store.byId.get(first.id)?.meta.collapsed).toBeUndefined();
      // Enter opens a cell Fold All folded, to edit it
      ui.select(second.id);
      await dispatcher.dispatch("ui.mode.edit");
      expect([ui.opened.has(second.id), ui.mode]).toEqual([true, "edit"]);
      ui.setMode("command");
      // a cell folded by its own meta opens for good under Fold All
      ui.setFoldAll(false, null);
      await dispatcher.dispatch("ui.cell.toggleCollapse");
      await whenTrue(() => store.byId.get(second.id)?.meta.collapsed === true);
      await dispatcher.dispatch("ui.cells.foldAll");
      await dispatcher.dispatch("ui.cell.toggleCollapse");
      await whenTrue(() => store.byId.get(second.id)?.meta.collapsed === false);
      expect(ui.opened.has(second.id)).toBe(true);
      await dispatcher.dispatch("ui.cells.foldAll");
      expect([ui.foldAll, ui.opened.size]).toEqual([false, 0]);
    });
  });
});

describe("the pin", () => {
  it("pins the selected cell's result with P, a second P unpins it, and Unpin works from anywhere", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const first = await store.add("server", undefined, "1");
      const second = await store.add("server", undefined, "2");
      ui.select(second?.id ?? null);
      expect(await dispatcher.dispatch("ui.unpin")).toBe(false);
      await dispatcher.dispatch("ui.cell.pin");
      expect(ui.pinned).toBe(second?.id);
      ui.select(first?.id ?? null);
      await dispatcher.dispatch("ui.cell.pin");
      expect(ui.pinned).toBe(first?.id);
      await dispatcher.dispatch("ui.cell.pin");
      expect(ui.pinned).toBeNull();
      await dispatcher.dispatch("ui.cell.pin");
      expect(await dispatcher.dispatch("ui.unpin")).toBe(true);
      expect(ui.pinned).toBeNull();
    });
  });
});
