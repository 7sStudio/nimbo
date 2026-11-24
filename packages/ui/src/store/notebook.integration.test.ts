// @vitest-environment node
// The notebook store on a real daemon and kernel: hydrate, an agent's edits mirrored and counted, runs
// with their outputs and summaries, moves, delete and undo under the old id, errors as toasts.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { startPage, whenTrue } from "./fixtures/page.js";
import { useUndoStore } from "./undo.js";

const notebook = "store.jsnb";

describe("the notebook store's mirror", () => {
  it("mirrors an agent's cells, counts its edits apart from the page's own", async () => {
    await withDaemon(async (daemon) => {
      const { store } = await startPage(daemon, notebook);
      expect(store.connection).toBe("live");
      await daemon.client.cell.add({ notebook, type: "server", source: "1 + 1" });
      const mine = await store.add("markdown", undefined, "# mine");
      await whenTrue(() => store.cellsInOrder.length === 2);
      expect(store.agentEditCount).toBe(1);
      expect(mine && store.byId.get(mine.id)?.meta.lastEdit).toMatchObject({
        by: "user",
        client: "ui",
      });
    });
  });
});

describe("the notebook store's runs", () => {
  it("runs a cell and folds in its outputs, summary and graph", async () => {
    await withDaemon(async (daemon) => {
      const { store } = await startPage(daemon, notebook);
      const cell = await store.add(
        "server",
        undefined,
        "export const n = 41; console.log('x'); n + 1",
      );
      if (cell === undefined) throw new Error("no cell");
      await store.run(cell.id);
      await whenTrue(() => store.byId.get(cell.id)?.lastExecution?.durationMs !== undefined);
      await whenTrue(() => store.lastExecutionOf(cell.id)?.outputs.length === 2);
      expect(store.lastExecutionOf(cell.id)?.outputs.map((output) => output.kind)).toEqual([
        "stream",
        "value",
      ]);
      await whenTrue(() => store.mirror.graph.get(cell.id)?.exports.includes("n") === true);
      expect(store.runningCell).toBeNull();
    });
  });
});

describe("the notebook store's edits", () => {
  it("lists failed cells, moves cells, and restores a deleted cell under its old id", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const a = await store.add("server", undefined, "throw new TypeError('no')");
      const b = await store.add("server", undefined, "2");
      if (a === undefined || b === undefined) throw new Error("no cells");
      await store.update(b.id, { meta: { collapsed: true } });
      await store.runSelection("all");
      await whenTrue(() => store.errors.some((cell) => cell.id === a.id));
      await store.moveBy(store.cellsInOrder, b.id, -1);
      await whenTrue(() => store.cellsInOrder[0]?.id === b.id);
      expect(await store.moveBy(store.cellsInOrder, b.id, -1)).toBeUndefined();
      await whenTrue(() => store.byId.get(b.id)?.meta.collapsed === true);
      await store.remove(store.cellsInOrder, b.id);
      await whenTrue(() => !store.byId.has(b.id));
      expect(ui.toasts.at(-1)?.action?.command).toBe("undo.restore");
      expect(await useUndoStore().restore()).toBe(b.id);
      await whenTrue(() => store.byId.get(b.id)?.meta.collapsed === true);
      expect(store.cellsInOrder.map((cell) => cell.id)).toEqual([b.id, a.id]);
      expect(await useUndoStore().restore()).toBeUndefined();
    });
  });
});

describe("the notebook store's errors", () => {
  it("shows a failed call as a toast and resolves undefined", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      expect(await store.update("c_zzzzzz", { source: "x" })).toBeUndefined();
      expect(ui.toasts.at(-1)).toMatchObject({ kind: "error", title: "Cell not found" });
    });
  });
});

describe("the notebook store's kernel actions", () => {
  it("interrupts, restarts, saves, reloads and reads routes, bindings and values", async () => {
    await withDaemon(async (daemon) => {
      const { store } = await startPage(daemon, notebook);
      const cell = await store.add(
        "server",
        undefined,
        'export const v = { a: [1, 2] }; route("GET /hi", () => "hi"); v',
      );
      if (cell === undefined) throw new Error("no cell");
      await store.run(cell.id);
      await whenTrue(() => store.mirror.routes.length === 1);
      expect(await store.bindings(cell.id)).toMatchObject({ bindings: [{ name: "v" }] });
      expect((await store.outputValue(cell.id, 0, "$.a"))?.json).toEqual([1, 2]);
      expect(await store.interrupt()).toEqual({ interrupted: null });
      expect(await store.save()).toMatchObject({ savedAt: expect.any(String) as unknown });
      expect(await store.reload()).toBeDefined();
      await store.restart();
      await whenTrue(() => store.mirror.notebook?.kernel.state !== "busy");
      await store.refreshRoutes();
      expect(store.mirror.saveState).toBe("saved");
    });
  });
});
