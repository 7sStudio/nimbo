// @vitest-environment node
// The Home page's creates and renames on a real daemon: a create and a rename guarded each on
// their own, a rename into a folded folder unfolding it, the renamed row selected and the search field focused, and an
// open notebook (an agent opened it under the rename field) renamed as it is, open under the new name.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { agentCreates } from "../store/fixtures/homeAgent.js";
import { listed, startHomePage } from "./fixtures/homePage.js";

describe("a create and a rename", () => {
  it("keeps a create and a rename apart: neither waits for the other", async () => {
    await withDaemon(async (daemon) => {
      await agentCreates(daemon, "old.jsnb");
      const { home, dispatcher, sent } = await startHomePage(daemon);
      await dispatcher.dispatch("ui.notebook.close", { path: "old.jsnb" });
      await listed(home, "old.jsnb", false);
      await dispatcher.dispatch("ui.notebook.rename", { path: "old.jsnb" });
      const both = [
        dispatcher.dispatch("ui.notebook.new", { name: "made" }),
        dispatcher.dispatch("ui.notebook.rename", { path: "old.jsnb", to: "new.jsnb" }),
      ];
      expect([...home.pending].sort()).toEqual(["create", "rename"]);
      await Promise.all(both);
      expect([sent, home.renaming, home.selected, home.searchFocus, home.pending.size]).toEqual([
        ["/ui/made?token=t"],
        null,
        "new.jsnb",
        1,
        0,
      ]);
      await listed(home, "new.jsnb", false);
    });
  });

  it("unfolds the Explorer down to the folder a rename moves the notebook into", async () => {
    await withDaemon(async (daemon) => {
      for (const path of ["a.jsnb", "sub/b.jsnb"]) await agentCreates(daemon, path);
      const { home, dispatcher } = await startHomePage(daemon);
      await dispatcher.dispatch("ui.notebook.close", { path: "a.jsnb" });
      await listed(home, "a.jsnb", false);
      await dispatcher.dispatch("ui.notebook.rename", { path: "a.jsnb", to: "sub/a.jsnb" });
      expect([home.expanded, home.selected, home.searchFocus]).toEqual([["sub/"], "sub/a.jsnb", 1]);
    });
  });
});

describe("a rename field over a notebook an agent opens", () => {
  it("renames the open notebook, which stays open under the new name with its kernel", async () => {
    await withDaemon(async (daemon) => {
      await agentCreates(daemon, "a.jsnb");
      const { home, ui, dispatcher } = await startHomePage(daemon);
      await dispatcher.dispatch("ui.notebook.close", { path: "a.jsnb" });
      await listed(home, "a.jsnb", false);
      await dispatcher.dispatch("ui.notebook.rename", { path: "a.jsnb" });
      await daemon.client.notebook.open({ path: "a.jsnb" });
      await listed(home, "a.jsnb", true);
      expect(
        await dispatcher.dispatch("ui.notebook.rename", { path: "a.jsnb", to: "b.jsnb" }),
      ).toBe(true);
      await listed(home, "b.jsnb", true);
      expect([home.renaming, home.selected, ui.toasts]).toEqual([null, "b.jsnb", []]);
      expect(home.notebooks.map((each) => each.path)).toEqual(["b.jsnb"]);
    });
  });
});
