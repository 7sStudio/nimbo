// @vitest-environment node
// The dispatcher's commands on the workbench's three regions, on a real daemon's page: ui.panel.open, toggle and close
// take a place by its name (a view, a tab, an inspector group, or a panel's older name) and act on
// the region that holds it, on the side panel with no name; ui.inspector.toggle and ui.bottom.toggle.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { startPage } from "../store/fixtures/page.js";
import { createDispatcher } from "./dispatch.js";

const notebook = "regions.jsnb";

describe("UI commands on the workbench's regions", () => {
  it("open, toggle and hide a place by its name, the older names included", async () => {
    await withDaemon(async (daemon) => {
      const { ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const open = () => [ui.layout.side.open, ui.layout.inspector.open, ui.layout.bottom.open];
      expect(open()).toEqual([true, true, false]);
      // "errors" is the Problems tab's older name
      await dispatcher.dispatch("ui.panel.open", { which: "errors" });
      expect(ui.layout.bottom).toMatchObject({ open: true, tab: "problems" });
      await dispatcher.dispatch("ui.panel.toggle", { which: "kernelLog" });
      expect(ui.layout.bottom).toMatchObject({ open: true, tab: "kernelLog" });
      await dispatcher.dispatch("ui.panel.toggle", { which: "kernelLog" });
      expect(ui.layout.bottom).toMatchObject({ open: false, tab: "kernelLog" });
      await dispatcher.dispatch("ui.panel.toggle", { which: "secrets" });
      expect(ui.layout.side).toMatchObject({ open: true, view: "environment" });
      await dispatcher.dispatch("ui.panel.close", { which: "routes" });
      expect(open()).toEqual([true, false, false]);
      await dispatcher.dispatch("ui.panel.open", { which: "routes" });
      expect([open(), ui.revealed]).toEqual([[true, true, false], { section: "routes", at: 1 }]);
      await dispatcher.dispatch("ui.panel.close");
      expect(open()).toEqual([false, true, false]);
    });
  });
});

describe("UI commands on a region with no place named", () => {
  it("act on the side panel with no name, and toggle the inspector and the bottom panel", async () => {
    await withDaemon(async (daemon) => {
      const { ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const open = () => [ui.layout.side.open, ui.layout.inspector.open, ui.layout.bottom.open];
      await dispatcher.dispatch("ui.panel.toggle");
      expect(open()).toEqual([false, true, false]);
      // a name that is no place acts on the side panel, as no name does
      await dispatcher.dispatch("ui.panel.toggle", { which: "no such place" });
      expect(open()).toEqual([true, true, false]);
      await dispatcher.dispatch("ui.panel.close");
      await dispatcher.dispatch("ui.panel.open");
      expect(ui.layout.side).toMatchObject({ open: true, view: "explorer" });
      await dispatcher.dispatch("ui.inspector.toggle");
      await dispatcher.dispatch("ui.bottom.toggle");
      expect(open()).toEqual([true, false, true]);
      await dispatcher.dispatch("ui.inspector.toggle");
      await dispatcher.dispatch("ui.bottom.toggle");
      expect(open()).toEqual([true, true, false]);
    });
  });
});
