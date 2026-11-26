// @vitest-environment node
// What the cell list derives from a real daemon and kernel: a draft sent after the pause and
// dropped once the source catches up; the values view's bindings read after a run; the execution count, from 1 after a
// restart and gone with Clear Outputs; the toast for an agent's edit of the selected cell; and the models, page and card state useCells builds.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";
import { effectScope } from "vue";

import { agent, startPage, whenTrue } from "../store/fixtures/page.js";
import { useContainersStore } from "../store/containers.js";
import { useRunCountStore } from "../store/runCounts.js";
import { useSettingsStore } from "../store/settings.js";
import { cardPage } from "./fixtures/models.js";
import { useAgentEdits } from "./useAgentEdits.js";
import { useScopes } from "./lineValues.js";
import { useCells } from "./useCells.js";
import { useDrafts } from "./useDrafts.js";
import { useValues } from "./useValues.js";

const notebook = "cells.jsnb";

describe("useDrafts on a real daemon", () => {
  it("sends a draft after the pause and drops it once the source caught up", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const cell = await store.add("server", undefined, "1");
      if (cell === undefined) throw new Error("no cell");
      const scope = effectScope();
      const drafts = scope.run(() => useDrafts(store, ui));
      drafts?.change(cell.id, "2");
      expect(ui.draftOf(cell.id)).toBe("2");
      await whenTrue(() => store.byId.get(cell.id)?.source === "2");
      await whenTrue(() => ui.draftOf(cell.id) === undefined);
      ui.setDraft(cell.id, "2");
      expect(await drafts?.flush(cell.id)).toBe(false);
      expect(ui.draftOf(cell.id)).toBeUndefined();
      scope.stop();
    });
  });
});

describe("useValues and the run count on a real daemon", () => {
  it("reads an open values view's bindings after each run and counts the runs", async () => {
    await withDaemon(async (daemon) => {
      const { store } = await startPage(daemon, notebook);
      const cell = await store.add("server", undefined, "const a = 1;\nlet b = 2");
      if (cell === undefined) throw new Error("no cell");
      const scope = effectScope();
      const values = scope.run(() => useValues(store));
      const counts = scope.run(() => useRunCountStore());
      await store.update(cell.id, { meta: { showBindings: true } });
      await store.run(cell.id);
      await whenTrue(() => values?.value.get(cell.id)?.length === 2);
      await store.run(cell.id);
      await whenTrue(() => counts?.countOf(cell.id) === 2);
      // a fresh kernel numbers its runs from 1 again, as Jupyter's; Clear Outputs takes the count away
      await store.restart();
      await store.run(cell.id);
      await whenTrue(() => counts?.countOf(cell.id) === 1);
      // a run under way keeps its outputs: clear once it ended and the page fetched its outputs and summary
      await whenTrue(
        () =>
          store.lastExecutionOf(cell.id)?.endedAt !== undefined &&
          store.byId.get(cell.id)?.lastExecution?.durationMs !== undefined,
      );
      await store.clearOutputs([cell.id]);
      await whenTrue(() => counts?.countOf(cell.id) === null);
      await store.update(cell.id, { meta: { showBindings: null } });
      await whenTrue(() => values?.value.has(cell.id) === false);
      scope.stop();
    });
  });
});

/** A result stops at seven lines (9rem) unless outputs.maxHeightPx was set, whose px then rule. */
function expectCap(page: { readonly maxHeight: number; readonly sevenLines: boolean } | undefined) {
  expect(page).toMatchObject({ maxHeight: 144, sevenLines: true });
  const settings = useSettingsStore();
  settings.values = { ...settings.values, "outputs.maxHeightPx": { value: 300, source: "user" } };
}

describe("useAgentEdits and useCells on a real daemon", () => {
  it("toasts an agent's edit of the selected cell and builds the cards' models", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const cell = await store.add("client", undefined, "1");
      if (cell === undefined) throw new Error("no cell");
      ui.select(cell.id);
      const scope = effectScope();
      const built = scope.run(() => {
        useAgentEdits(store, ui);
        const stores = {
          store,
          ui,
          settings: useSettingsStore(),
          containers: useContainersStore(),
        };
        return useCells(stores, cardPage().host, true);
      });
      await agent(daemon, notebook).edit(cell.id, "2");
      await whenTrue(() => ui.toasts.some((toast) => toast.title.startsWith("Cell 1 edited by")));
      const model = built?.cells.value[0];
      expect(model).toMatchObject({ number: 1, type: "client", selected: true, count: null });
      const routes = { count: 0, hits: 0 };
      expect(model).toMatchObject({ name: "", about: "", staleWhy: null, routes });
      expect(built?.page.value.definedBy(cell.id, cell.id)).toBe("this cell");
      expectCap(built?.page.value);
      expect(built?.page.value).toMatchObject({ maxHeight: 300, sevenLines: false });
      if (model !== undefined)
        expect(built?.stateOf(model, undefined)).toMatchObject({
          outputs: [],
          live: null,
          draft: undefined,
          missing: [],
          menu: null,
        });
      scope.stop();
    });
  });
});

describe("the cards' function sources on a real daemon", () => {
  it("names the last cell of the output's realm that defines a function, arrows included", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const first = await store.add("server", undefined, "const format = (n: number) => `${n}`");
      const second = await store.add(
        "server",
        undefined,
        "function format(n: number) { return n }",
      );
      const client = await store.add("client", undefined, "const shown = () => 1");
      if (first === undefined || second === undefined || client === undefined) {
        throw new Error("no cell");
      }
      const scope = effectScope();
      const page = scope.run(() => {
        const stores = {
          store,
          ui,
          settings: useSettingsStore(),
          containers: useContainersStore(),
        };
        return useCells(stores, cardPage().host, true).page;
      });
      await whenTrue(() => store.mirror.graph.get(client.id)?.defines.includes("shown") === true);
      expect(page?.value.functionSource(first.id, "format")).toEqual({
        cell: second.id,
        label: "cell 2",
      });
      expect(page?.value.functionSource(client.id, "shown")).toEqual({
        cell: client.id,
        label: "cell 3",
      });
      expect(page?.value.functionSource(client.id, "format")).toBeUndefined();
      expect(page?.value.functionSource(first.id, "missing")).toBeUndefined();
      scope.stop();
    });
  });
});

describe("a syntax error's card on a real daemon", () => {
  it("gives the error block the error with the excerpt alone of its data, and the header's place", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const cell = await store.add("server", undefined, "const x = ;");
      if (cell === undefined) throw new Error("no cell");
      await store.run(cell.id);
      // the status arrives as an event, the error with the run's fetch after it
      await whenTrue(() => store.lastExecutionOf(cell.id)?.error?.name === "SyntaxError");
      const scope = effectScope();
      const built = scope.run(() => {
        const stores = {
          store,
          ui,
          settings: useSettingsStore(),
          containers: useContainersStore(),
        };
        return useCells(stores, cardPage().host, true);
      });
      const model = built?.cells.value[0];
      if (model === undefined || built === undefined) throw new Error("no model");
      expect(model.run).toMatchObject({ kind: "syntax", place: { line: 1, col: 11 } });
      // the run's error is the card's error block, not one of its outputs
      const state = built.stateOf(model, undefined);
      expect(state.outputs).toEqual([]);
      expect(state.error).toMatchObject({
        name: "SyntaxError",
        frames: [{ cell: cell.id, line: 1, col: 11 }],
        data: { excerpt: "> 1 | const x = ;\n    |           ^" },
      });
      expect(Object.keys(state.error?.data ?? {})).toEqual(["excerpt"]);
      scope.stop();
    });
  });
});

describe("the line values' scopes on a real daemon", () => {
  it("reads the server kernel's values under the cell that set them once the runs settle", async () => {
    await withDaemon(async (daemon) => {
      const { store } = await startPage(daemon, notebook);
      const cell = await store.add("server", undefined, "const total = 40 + 2;\ntotal");
      if (cell === undefined) throw new Error("no cell");
      const scope = effectScope();
      const scopes = scope.run(() => useScopes(store));
      await store.run(cell.id);
      await whenTrue(() => scopes?.value.get(cell.id)?.has("total") === true);
      expect(scopes?.value.get(cell.id)?.get("total")).toEqual({
        name: "total",
        text: "42",
        full: "42",
      });
      scope.stop();
    });
  });
});
