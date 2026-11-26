// @vitest-environment node
// The Home page's dispatcher on a real daemon: New without a name focuses the search field and with one
// creates and lands on the page; Open opens a closed notebook first; Close asks while the kernel is busy, and Rename
// of an open notebook opens the field at once; Rename and Delete (which asks, and closes an open notebook first) through
// the daemon; the selection, folding, the palette and Escape; and every command that writes refused off a live socket.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { agentCreates, agentRunsForever } from "../store/fixtures/homeAgent.js";
import { whenTrue } from "../store/fixtures/page.js";
import { useSessionStore } from "../store/socket.js";
import { consent } from "./consent.js";
import { listed, startHomePage } from "./fixtures/homePage.js";

describe("New and Open", () => {
  it("focus the search field without a name, create and land with one, and open a closed notebook first", async () => {
    await withDaemon(async (daemon) => {
      const { home, dispatcher, sent } = await startHomePage(daemon);
      expect(await dispatcher.dispatch("ui.notebook.new")).toBe(true);
      expect([home.naming, home.searchFocus]).toEqual([true, 1]);
      await dispatcher.dispatch("ui.notebook.new", { name: "first", folder: "sub dir" });
      expect(sent).toEqual(["/ui/sub%20dir/first?token=t"]);
      await agentCreates(daemon, "b.jsnb");
      await dispatcher.dispatch("ui.notebook.close", { path: "b.jsnb" });
      await listed(home, "b.jsnb", false);
      expect(await dispatcher.dispatch("ui.notebook.open", { path: "nope.jsnb" })).toBe(false);
      await dispatcher.dispatch("ui.notebook.open", { path: "b.jsnb" });
      expect(sent.at(-1)).toBe("/ui/b?token=t");
      await listed(home, "b.jsnb", true);
      await dispatcher.dispatch("ui.notebook.new", { name: "first", folder: "sub dir" });
      expect(sent).toHaveLength(2); // it exists: a toast, and no landing
    });
  });
});

describe("a second submit", () => {
  it("sends nothing while a create is out: one landing, no 'already exists'", async () => {
    await withDaemon(async (daemon) => {
      const { home, ui, dispatcher, sent } = await startHomePage(daemon);
      const twice = [1, 2].map(() => dispatcher.dispatch("ui.notebook.new", { name: "once" }));
      await Promise.all(twice);
      expect([sent, ui.toasts, home.pending.size]).toEqual([["/ui/once?token=t"], [], 0]);
    });
  });
});

describe("Close", () => {
  it("asks while the kernel is busy, and Rename on an open notebook opens the field at once", async () => {
    await withDaemon(async (daemon) => {
      await agentRunsForever(daemon, "busy.jsnb");
      const { home, ui, dispatcher } = await startHomePage(daemon);
      await dispatcher.dispatch("ui.notebook.close", { path: "busy.jsnb" });
      expect(ui.overlay).toEqual({ kind: "confirmNotebook", action: "close", path: "busy.jsnb" });
      ui.overlay = null; // the confirm's answer closes it
      // F2 on the open notebook: the field, no confirm, the kernel left running
      await dispatcher.dispatch("ui.notebook.rename", { path: "busy.jsnb" });
      expect([ui.overlay, home.renaming]).toEqual([null, "busy.jsnb"]);
      await dispatcher.dispatch("ui.escape");
      // the cancelled rename gives the focus back to the search field, never to the page
      expect([home.renaming, home.searchFocus]).toEqual([null, 1]);
    });
  });
});

describe("Rename and Delete", () => {
  it("rename through the field, ask before a delete, and delete an open notebook after closing it", async () => {
    await withDaemon(async (daemon) => {
      await agentCreates(daemon, "a.jsnb");
      const { home, ui, dispatcher } = await startHomePage(daemon);
      await dispatcher.dispatch("ui.notebook.close", { path: "a.jsnb" });
      await listed(home, "a.jsnb", false);
      await dispatcher.dispatch("ui.notebook.rename", { path: "a.jsnb" });
      expect(home.renaming).toBe("a.jsnb");
      await dispatcher.dispatch("ui.notebook.rename", { path: "a.jsnb", to: "calm.jsnb" });
      expect([home.renaming, home.selected]).toEqual([null, "calm.jsnb"]);
      await dispatcher.dispatch("ui.notebook.open", { path: "calm.jsnb" });
      await listed(home, "calm.jsnb", true);
      await dispatcher.dispatch("ui.notebook.delete", { path: "calm.jsnb" });
      expect(ui.overlay).toEqual({ kind: "confirmNotebook", action: "delete", path: "calm.jsnb" });
      ui.overlay = null;
      // a yes a key binding could carry asks all the same: only a dialog's token says yes
      for (const args of [{ confirmed: true }, { consent: "made-up" }, { confirm: true }]) {
        await dispatcher.dispatch("ui.notebook.delete", { path: "calm.jsnb", ...args });
        expect(ui.overlay).toMatchObject({ kind: "confirmNotebook", action: "delete" });
        ui.overlay = null;
      }
      expect(home.notebooks.length).toBe(1);
      await dispatcher.dispatch("ui.notebook.delete", { path: "calm.jsnb", consent: consent() });
      await whenTrue(() => home.notebooks.length === 0);
    });
  });
});

describe("the list's commands", () => {
  it("move the selection, open the palette and close it with Escape", async () => {
    await withDaemon(async (daemon) => {
      for (const path of ["a.jsnb", "sub/b.jsnb", "sub/c.jsnb"]) await agentCreates(daemon, path);
      const { home, ui, dispatcher } = await startHomePage(daemon);
      for (const id of ["ui.home.select.next", "ui.home.select.next"])
        await dispatcher.dispatch(id);
      expect(home.selected).toBe("sub/b.jsnb");
      await dispatcher.dispatch("ui.home.select.previous");
      expect(home.selected).toBe("a.jsnb");
      await dispatcher.dispatch("ui.palette.open");
      expect(dispatcher.context()).toEqual({
        mode: "command",
        cellType: null,
        overlay: true,
        page: false,
      });
      await dispatcher.dispatch("ui.escape");
      expect(ui.palette.open).toBe(false);
      ui.overlay = { kind: "confirmNotebook", action: "delete", path: "a.jsnb" };
      await dispatcher.dispatch("ui.escape");
      expect(ui.overlay).toBeNull();
      ui.overlay = { kind: "confirmNotebook", action: "delete", path: "a.jsnb" };
      await dispatcher.dispatch("ui.overlay.close");
      await dispatcher.dispatch("ui.palette.open");
      await dispatcher.dispatch("ui.palette.close");
      expect([ui.overlay, ui.palette.open]).toEqual([null, false]);
      expect(await dispatcher.request("ui.home.refresh")).toBeUndefined();
      expect(dispatcher.find("ui.theme.toggle")?.title).toBe("Toggle Light and Dark");
    });
  });
});

describe("a Home page off a live socket", () => {
  it("refuses every command that writes, saying so", async () => {
    await withDaemon(async (daemon) => {
      await agentCreates(daemon, "a.jsnb");
      const { ui, dispatcher } = await startHomePage(daemon);
      useSessionStore().stop();
      await whenTrue(() => useSessionStore().status === "closed");
      for (const id of ["ui.notebook.new", "ui.notebook.open", "ui.notebook.delete"]) {
        expect(dispatcher.available(id, { path: "a.jsnb" })).toBe(false);
        expect(await dispatcher.dispatch(id, { path: "a.jsnb" })).toBe(false);
      }
      expect(ui.toasts.at(-1)?.title).toBe("Not connected");
      expect(await dispatcher.dispatch("no.such")).toBe(false);
      expect(dispatcher.available("ui.home.select.next")).toBe(true);
    });
  });
});
