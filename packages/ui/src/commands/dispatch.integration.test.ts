// @vitest-environment node
// The dispatcher on a real daemon: registry commands with the page's notebook and selected cell filled in,
// a delete through the store's undo, refusals; the UI commands on overlays, selection and theme (the regions' are regions.integration.test.ts's).
import { withDaemon } from "@jsnb/test-daemon";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { startPage, whenTrue } from "../store/fixtures/page.js";
import { useSettingsStore } from "../store/settings.js";
import { startPage as startTheRealPage } from "../store/start.js";
import { useUiStore } from "../store/ui.js";
import { createDispatcher } from "./dispatch.js";
import { nextTheme } from "./app.js";

const notebook = "commands.jsnb";

describe("registry commands", () => {
  it("fill the notebook and the selected cell, delete through undo, and refuse what cannot run", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const cell = await store.add("server", undefined, "1 + 1");
      if (cell === undefined) throw new Error("no cell");
      expect(await dispatcher.dispatch("cell.run")).toBe(false);
      ui.select(cell.id);
      expect(await dispatcher.dispatch("cell.run")).toBe(true);
      await whenTrue(() => store.byId.get(cell.id)?.status === "ok");
      expect(dispatcher.context()).toEqual({
        mode: "command",
        cellType: "server",
        overlay: false,
        page: false,
      });
      expect(await dispatcher.dispatch("packages.add")).toBe(false);
      expect(await dispatcher.dispatch("cell.snapshot")).toBe(false);
      expect(await dispatcher.dispatch("no.such")).toBe(false);
      expect(await dispatcher.dispatch("cell.delete")).toBe(true);
      await whenTrue(() => store.cellsInOrder.length === 0);
      expect(await dispatcher.dispatch("undo.restore")).toBe(true);
      await whenTrue(() => store.byId.has(cell.id));
      expect(await dispatcher.dispatch("undo.restore")).toBe(false);
      expect(await dispatcher.dispatch("cell.get", { cell: "c_zzzzzz" })).toBe(true);
      expect(ui.toasts.at(-1)?.title).toBe("Cell not found");
      // only a choice in the palette counts as recently used, never a key or a click
      expect(ui.recent).toEqual([]);
    });
  });
});

describe("a tab that does not hold the page", () => {
  it("refuses every command that writes, from any caller, and says why once", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const cell = await store.add("server", undefined, "1 + 1");
      if (cell === undefined) throw new Error("no cell");
      ui.select(cell.id);
      const before = (await daemon.client.notebook.get({ notebook })).notebook;
      store.setAttach({ state: "viewOnly" });
      expect(store.connection).toBe("viewOnly");
      for (const id of [
        "kernel.restart",
        "notebook.save",
        "notebook.run",
        "ui.run.inPlace",
        "ui.cell.moveUp",
      ])
        expect(await dispatcher.dispatch(id)).toBe(false);
      expect(ui.toasts.filter((toast) => toast.title === "View only")).toHaveLength(1);
      expect(await dispatcher.dispatch("cell.get")).toBe(true);
      expect(await dispatcher.dispatch("ui.output.find")).toBe(true);
      const after = (await daemon.client.notebook.get({ notebook })).notebook;
      expect(after.kernel.pid).toBe(before.kernel.pid);
      expect(after.cells[0]?.lastExecution).toBeNull();
    });
  });
});

describe("a tab whose attach has not settled or failed", () => {
  it("refuses writes while this tab's attach is pending or failed, the socket live", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook, {}, false);
      const dispatcher = createDispatcher();
      expect(store.connection).toBe("live");
      expect(await dispatcher.dispatch("kernel.restart")).toBe(false);
      expect(ui.toasts.at(-1)?.text).toContain("wait until this tab holds");
      store.setAttach({ state: "failed", message: "refused" });
      expect(await dispatcher.dispatch("notebook.save")).toBe(false);
      expect(ui.toasts.at(-1)?.text).toContain("could not take");
      expect(await dispatcher.dispatch("cell.get", { cell: "c_zzzzzz" })).toBe(true);
    });
  });
});

describe("a notebook another client closed", () => {
  it("refuses writes with that reason, then takes them again once it is open again", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      await daemon.client.notebook.close({ notebook });
      await expect.poll(() => store.mirror.closed).toBe(true);
      expect(await dispatcher.dispatch("kernel.restart")).toBe(false);
      expect(ui.toasts.at(-1)?.title).toBe("Notebook closed");
      await daemon.client.notebook.open({ path: notebook });
      await expect.poll(() => store.reopened).toBe(1);
      expect(store.mirror.closed).toBe(false);
    });
  });
});

describe("a page whose start stopped", () => {
  it("does not run the theme toggle, and says nothing internal", async () => {
    await withDaemon(async (daemon) => {
      setActivePinia(createPinia());
      expect(
        await startTheRealPage({ url: daemon.url, token: daemon.token, notebook: "gone.jsnb" }),
      ).toBe(false);
      const ui = useUiStore();
      expect(await createDispatcher().dispatch("ui.theme.toggle")).toBe(false);
      expect(ui.toasts).toEqual([]);
    });
  });
});

describe("UI commands on the selection", () => {
  it("move the selection and enter edit mode with the caret where it belongs", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const a = await store.add("server", undefined, "1");
      const b = await store.add("markdown", undefined, "# b");
      if (a === undefined || b === undefined) throw new Error("no cells");
      expect(await dispatcher.dispatch("ui.mode.edit")).toBe(false);
      await dispatcher.dispatch("ui.select.previous");
      expect(ui.selected).toBe(b.id);
      await dispatcher.dispatch("ui.select.next");
      expect(ui.selected).toBe(b.id);
      await dispatcher.dispatch("ui.select", { cell: a.id });
      await dispatcher.dispatch("ui.edit.next");
      expect([ui.selected, ui.mode, ui.caret]).toEqual([b.id, "edit", "start"]);
      await dispatcher.dispatch("ui.edit.previous");
      expect([ui.selected, ui.caret]).toEqual([a.id, "end"]);
      await dispatcher.dispatch("ui.mode.command");
      expect(ui.mode).toBe("command");
    });
  });
});

describe("UI commands on overlays and panels", () => {
  it("open and close the palette, the cell menu and full screen, and toggle the agent filter", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const a = await store.add("server", undefined, "1");
      if (a === undefined) throw new Error("no cell");
      await dispatcher.dispatch("ui.palette.open");
      expect(dispatcher.context().overlay).toBe(true);
      await dispatcher.dispatch("ui.escape");
      expect(ui.palette.open).toBe(false);
      await dispatcher.dispatch("ui.cellMenu.open", { cell: a.id });
      expect(ui.overlay).toEqual({ kind: "cellMenu", cell: a.id, at: null });
      ui.fullscreen = { cell: a.id, index: 0 };
      for (let i = 0; i < 3; i += 1) await dispatcher.dispatch("ui.escape");
      expect([ui.overlay, ui.fullscreen]).toEqual([null, null]);
      await dispatcher.dispatch("ui.filter.agentEdits");
      expect(ui.filter).toBe("agentEdits");
      await dispatcher.dispatch("ui.filter.agentEdits");
      expect(ui.filter).toBe("all");
    });
  });
});

describe("the theme command", () => {
  it("toggles the theme as the user setting ui.theme, or the workspace one when that decides", async () => {
    await withDaemon(async (daemon) => {
      await startPage(daemon, notebook);
      const settings = useSettingsStore();
      await settings.start();
      await createDispatcher().dispatch("ui.theme.toggle");
      await whenTrue(() => settings.valueOf("ui.theme") === "dark");
      expect(settings.values["ui.theme"]?.source).toBe("user");
      // a workspace that sets ui.theme outranks the user: the toggle writes there, so it still turns the page
      await daemon.client.settings.set({ key: "ui.theme", value: "light", scope: "workspace" });
      await whenTrue(() => settings.values["ui.theme"]?.source === "workspace");
      await createDispatcher().dispatch("ui.theme.toggle");
      await whenTrue(() => settings.valueOf("ui.theme") === "dark");
      expect(settings.values["ui.theme"]?.source).toBe("workspace");
      expect([
        nextTheme("dark", false),
        nextTheme("system", true),
        nextTheme(undefined, false),
      ]).toEqual(["light", "light", "dark"]);
    });
  });
});
