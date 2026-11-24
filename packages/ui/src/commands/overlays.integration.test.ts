// @vitest-environment node
// The overlay commands and the restart confirm on a real daemon: each menu opens on its cell, selecting
// it; Escape closes the open one; a restart while a cell runs opens the confirm and restarts nothing until it is
// answered; the cell menu's own commands (run all above, copy the id) act on the selected cell.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { startPage, whenTrue } from "../store/fixtures/page.js";
import { createDispatcher } from "./dispatch.js";

const notebook = "overlays.jsnb";

describe("the overlay commands", () => {
  it("open each menu on its cell and close it", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const a = await store.add("server", undefined, "1");
      const b = await store.add("server", a?.id, "2");
      if (a === undefined || b === undefined) throw new Error("no cells");
      expect(dispatcher.available("ui.cellMenu.open")).toBe(false);
      await dispatcher.dispatch("ui.cellMenu.open", { cell: b.id, x: 3, y: 4 });
      expect([ui.selected, ui.overlay]).toEqual([
        b.id,
        { kind: "cellMenu", cell: b.id, at: { x: 3, y: 4 } },
      ]);
      expect(dispatcher.context().overlay).toBe(true);
      await dispatcher.dispatch("ui.typeMenu.open");
      expect(ui.overlay).toEqual({ kind: "typeMenu", cell: b.id });
      await dispatcher.dispatch("ui.restartMenu.open", { from: "cluster" });
      expect(ui.overlay).toEqual({ kind: "restartMenu", from: "cluster" });
      await dispatcher.dispatch("ui.escape");
      expect(ui.overlay).toBeNull();
      // the kernel log is the bottom panel's tab, opened by its older command: no overlay
      await dispatcher.dispatch("ui.kernelLog.open");
      expect(ui.overlay).toBeNull();
      expect(ui.layout.bottom).toMatchObject({ open: true, tab: "kernelLog" });
      await dispatcher.dispatch("ui.palette.open");
      expect([ui.overlay, ui.palette.open]).toEqual([null, true]);
      await dispatcher.dispatch("ui.escape");
      await dispatcher.dispatch("ui.restartMenu.open");
      expect(ui.overlay).toEqual({ kind: "restartMenu", from: "button" });
      await dispatcher.dispatch("ui.overlay.close");
      expect(ui.overlay).toBeNull();
    });
  });
});

describe("one overlay at a time", () => {
  it("keep one overlay open: an opener closes the palette, and opening the open one closes it", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const a = await store.add("server", undefined, "1");
      if (a === undefined) throw new Error("no cell");
      ui.select(a.id);
      await dispatcher.dispatch("ui.palette.open");
      await dispatcher.dispatch("ui.cellMenu.open");
      expect([ui.palette.open, ui.overlay?.kind]).toEqual([false, "cellMenu"]);
      await dispatcher.dispatch("ui.cellMenu.open");
      expect(ui.overlay).toBeNull();
      await dispatcher.dispatch("ui.restartMenu.open");
      await dispatcher.dispatch("ui.restartMenu.open", { from: "cluster" });
      expect(ui.overlay).toEqual({ kind: "restartMenu", from: "cluster" });
      await dispatcher.dispatch("ui.restartMenu.open", { from: "cluster" });
      expect(ui.overlay).toBeNull();
    });
  });
});

describe("the cell menu's own commands", () => {
  it("run the cells above the selected one and copy its id", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const a = await store.add("server", undefined, "1");
      const b = await store.add("server", a?.id, "2");
      if (a === undefined || b === undefined) throw new Error("no cells");
      ui.select(b.id);
      await dispatcher.dispatch("ui.run.above");
      await whenTrue(() => store.byId.get(a.id)?.status === "ok");
      expect(store.byId.get(b.id)?.status).toBe("idle");
      await dispatcher.dispatch("ui.cell.copyId");
      // no clipboard in Node: the page says it could not copy, with the id it meant to copy
      expect(ui.toasts.at(-1)).toMatchObject({ title: "Could not copy", text: b.id });
    });
  });
});

describe("the restart confirm", () => {
  it("asks before restarting while a cell runs, and restarts once answered", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const cell = await store.add(
        "server",
        undefined,
        "await new Promise((done) => setTimeout(done, 60_000))",
      );
      if (cell === undefined) throw new Error("no cell");
      const started = store.mirror.notebook?.kernel.startedAt;
      await store.run(cell.id);
      await whenTrue(() => store.runningCell === cell.id);

      expect(await dispatcher.dispatch("kernel.restart", { all: true })).toBe(true);
      expect(ui.overlay).toEqual({ kind: "confirmRestart", running: cell.id, all: true });
      expect(store.runningCell).toBe(cell.id);

      ui.overlay = null;
      expect(await dispatcher.dispatch("kernel.restart", { confirmed: true })).toBe(true);
      await whenTrue(() => store.byId.get(cell.id)?.status !== "running");
      await whenTrue(
        () =>
          store.mirror.notebook?.kernel.state === "idle" &&
          store.mirror.notebook.kernel.startedAt !== started,
      );
      expect(ui.overlay).toBeNull();
      expect(ui.toasts.at(-1)?.title).toBe("Kernel restarted");
    });
  });
});
