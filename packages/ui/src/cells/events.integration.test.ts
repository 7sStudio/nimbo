// @vitest-environment node
// A card's events and the list's focus on a real daemon, in a happy-dom page: a command selects
// its cell and runs through the dispatcher; the editor's focus enters edit mode, its text is sent on blur, a meta change
// and a jump go through commands, a handled request is cleared; an added cell is selected and takes the focus, a
// pointer's selection does not move it, a markdown block opens at its end.
import { pageDocument } from "../store/fixtures/dom.js";

import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import { createDispatcher } from "../commands/dispatch.js";
import { startPage, whenTrue } from "../store/fixtures/page.js";
import { cellEvents } from "./cellEvents.js";
import { useDrafts } from "./useDrafts.js";
import { useFocusFollow } from "./useFocusFollow.js";

const notebook = "events.jsnb";

/** An item for `cell` in the page, as CellList renders it. */
function item(cell: string): HTMLElement {
  const element = pageDocument().createElement("li");
  element.dataset.cell = cell;
  element.tabIndex = -1;
  pageDocument().body.append(element);
  return element;
}

describe("cellEvents on a real daemon", () => {
  it("routes a card's events through the dispatcher on its own cell", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const cell = await store.add("server", undefined, "1");
      if (cell === undefined) throw new Error("no cell");
      const scope = effectScope();
      const drafts = scope.run(() => useDrafts(store, ui));
      if (drafts === undefined) throw new Error("no drafts");
      const on = cellEvents(cell.id, { dispatcher, ui, drafts });
      on.focus();
      expect([ui.selected, ui.mode]).toEqual([cell.id, "edit"]);
      on.change("2");
      on.blur();
      await whenTrue(() => store.byId.get(cell.id)?.source === "2");
      on.meta({ collapsed: true });
      await whenTrue(() => store.byId.get(cell.id)?.meta.collapsed === true);
      on.command("ui.cell.toggleCollapse");
      await whenTrue(() => store.byId.get(cell.id)?.meta.collapsed !== true);
      on.copy({ what: "json" });
      expect(ui.toasts.at(-1)?.title).toBe("Copied JSON");
      ui.outputRequest = { kind: "find", cell: cell.id, at: 1 };
      ui.fullscreen = { cell: cell.id, index: 0 };
      on.handled();
      expect([ui.outputRequest, ui.fullscreen]).toEqual([null, null]);
      ui.select(null);
      on.jump({ cell: cell.id });
      await whenTrue(() => ui.selected === cell.id);
      on.leave("next");
      scope.stop();
    });
  });
});

describe("useFocusFollow on a real daemon", () => {
  it("opens an added cell in edit mode and leaves a pointer's selection alone", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const first = await store.add("markdown", undefined, "# a");
      if (first === undefined) throw new Error("no cell");
      const firstItem = item(first.id);
      const scope = effectScope();
      const focus = scope.run(() => useFocusFollow(store, ui, ref(null)));
      focus?.add("server", first.id);
      await whenTrue(() => store.cellsInOrder.length === 2);
      const added = store.cellsInOrder[1]?.id ?? "";
      await whenTrue(() => ui.selected === added);
      // VS Code's + Code: the new cell's editor, the caret at its end
      expect([ui.mode, ui.caret]).toEqual(["edit", "end"]);
      await nextTick();
      await nextTick();
      const before = pageDocument().activeElement;
      focus?.point(first.id);
      await nextTick();
      await nextTick();
      expect(ui.selected).toBe(first.id);
      expect(pageDocument().activeElement).toBe(before);
      focus?.point(first.id);
      focus?.edit(first.id);
      expect([ui.mode, ui.caret]).toEqual(["edit", "end"]);
      expect(firstItem.isConnected).toBe(true);
      scope.stop();
    });
  });
});
