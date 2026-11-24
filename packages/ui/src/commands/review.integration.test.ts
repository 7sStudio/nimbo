// @vitest-environment node
// An agent's edit to review from the page on a real daemon: a view-only tab sees it and its full diff but
// neither reverts nor marks it reviewed; the tab that holds the page does both, a revert with no editor on the page
// going through cell.revert as the user's edit.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { startPage, whenTrue } from "../store/fixtures/page.js";
import { createDispatcher } from "./dispatch.js";

const notebook = "review.jsnb";

describe("an agent's edit to review", () => {
  it("is seen but neither reverted nor marked reviewed from a view-only tab; the tab holding the page does both", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const cell = await store.add("server", undefined, "1");
      if (cell === undefined) throw new Error("no cell");
      const agent = daemon.http({ client: "cli" });
      await agent.cell.update({ notebook, cell: cell.id, source: "2" });
      await whenTrue(() => store.byId.get(cell.id)?.meta.lastEdit?.review !== undefined);
      ui.select(cell.id);
      store.setAttach({ state: "viewOnly" });
      expect(await dispatcher.dispatch("ui.cell.revert")).toBe(false);
      expect(await dispatcher.dispatch("cell.markReviewed")).toBe(false);
      expect(await dispatcher.dispatch("ui.cell.agentDiff")).toBe(true);
      const kept = (await daemon.client.cell.get({ notebook, cell: cell.id })).cell;
      expect(kept.meta.lastEdit?.review?.previousSource).toBe("1");
      store.setAttach({ state: "attached" });
      // no editor on this page: the revert goes through cell.revert
      expect(await dispatcher.dispatch("ui.cell.revert")).toBe(true);
      await whenTrue(() => store.byId.get(cell.id)?.source === "1");
      expect(store.byId.get(cell.id)?.meta.lastEdit).toMatchObject({ by: "user", client: "ui" });
      await agent.cell.update({ notebook, cell: cell.id, source: "3" });
      await whenTrue(() => store.byId.get(cell.id)?.meta.lastEdit?.review !== undefined);
      expect(await dispatcher.dispatch("cell.markReviewed")).toBe(true);
      await whenTrue(() => store.byId.get(cell.id)?.meta.lastEdit?.review === undefined);
      expect(store.byId.get(cell.id)?.source).toBe("3");
    });
  });
});
