// @vitest-environment node
// The Jupyter keys on a real daemon and kernel: ⌥↩ runs and inserts a cell of
// the run cell's type below; a marked range (⇧↑ ⇧↓) runs, retypes, copies, pastes, cuts and deletes as one, and one Z
// brings a delete back whole; Y asks a markdown cell's realm; O hides and shows the outputs; ↩ switches a server cell
// that needs a client cell's name to client (DefinedInClient).
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { startPage, whenTrue } from "../store/fixtures/page.js";
import { createDispatcher } from "./dispatch.js";

const notebook = "jupyter.jsnb";

describe("⌥↩: run and insert below", () => {
  it("runs the cell, adds one of its type below and edits it; quick repeats add one", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const client = await store.add("client", undefined, "1");
      const last = await store.add("server", undefined, "2");
      if (client === undefined || last === undefined) throw new Error("no cells");
      ui.select(client.id);
      await dispatcher.dispatch("ui.run.insertBelow");
      await whenTrue(() => store.cellsInOrder.length === 3);
      const added = store.cellsInOrder[1];
      expect(added?.type).toBe("client");
      expect([ui.selected, ui.mode]).toEqual([added?.id, "edit"]);
      ui.select(last.id);
      await Promise.all([1, 2].map(() => dispatcher.dispatch("ui.run.insertBelow")));
      await whenTrue(() => store.lastExecutionOf(last.id)?.status === "ok");
      expect(store.cellsInOrder.map((cell) => cell.type)).toEqual([
        "client",
        "client",
        "server",
        "server",
      ]);
      await whenTrue(() =>
        store.cellsInOrder.every((cell) => cell.status !== "queued" && cell.status !== "running"),
      );
    });
  });
});

describe("a marked range (⇧↑ ⇧↓)", () => {
  it("runs as one and is retyped and copied as one", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      for (const source of ["1", "2", "3"]) await store.add("server", undefined, source);
      const [a, b, c] = store.cellsInOrder.map((cell) => cell.id);
      ui.select(a ?? null);
      await dispatcher.dispatch("ui.select.extendNext");
      expect(store.markedCells.map((cell) => cell.id)).toEqual([a, b]);
      await dispatcher.dispatch("ui.run.advance");
      await whenTrue(() => store.lastExecutionOf(b ?? "")?.status === "ok");
      expect(store.lastExecutionOf(a ?? "")?.status).toBe("ok");
      expect(ui.selected).toBe(c);
      await dispatcher.dispatch("ui.select.extendPrevious");
      await dispatcher.dispatch("ui.cell.type", { type: "client" });
      await whenTrue(() => store.byId.get(c ?? "")?.type === "client");
      expect(store.byId.get(b ?? "")?.type).toBe("client");
      await dispatcher.dispatch("ui.cells.copy");
      expect(ui.clipboard.map((cell) => [cell.type, cell.source])).toEqual([
        ["client", "2"],
        ["client", "3"],
      ]);
      ui.select(a ?? null);
      expect(store.markedCells.map((cell) => cell.id)).toEqual([a]);
    });
  });
});

describe("a marked range's clipboard and delete", () => {
  it("pastes above and below, cuts and deletes as one, and one Z brings each back whole", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      for (const source of ["1", "2", "3"]) await store.add("server", undefined, source);
      const [a, b, c] = store.cellsInOrder.map((cell) => cell.id);
      ui.select(b ?? null);
      await dispatcher.dispatch("ui.select.extendNext");
      await dispatcher.dispatch("ui.cells.copy");
      ui.select(a ?? null);
      await dispatcher.dispatch("ui.cells.paste", { where: "above" });
      await whenTrue(() => store.cellsInOrder.length === 5);
      const sources = () => store.cellsInOrder.map((cell) => cell.source);
      expect(sources()).toEqual(["2", "3", "1", "2", "3"]);
      expect(ui.selected).toBe(store.cellsInOrder[1]?.id);
      await dispatcher.dispatch("ui.select.extendPrevious");
      await dispatcher.dispatch("ui.cells.cut");
      await whenTrue(() => store.cellsInOrder.length === 3);
      expect(ui.selected).toBe(a);
      await dispatcher.dispatch("ui.cells.paste", { where: "below" });
      await whenTrue(() => store.cellsInOrder.length === 5);
      expect(sources()).toEqual(["1", "2", "3", "2", "3"]);
      await dispatcher.dispatch("ui.select.extendPrevious");
      await dispatcher.dispatch("cell.delete");
      await whenTrue(() => store.cellsInOrder.length === 3);
      expect(ui.selected).toBe(a);
      await dispatcher.dispatch("undo.restore");
      await whenTrue(() => store.cellsInOrder.length === 5);
      expect(sources()).toEqual(["1", "2", "3", "2", "3"]);
      expect(store.cellsInOrder.map((cell) => cell.id).slice(3)).toEqual([b, c]);
    });
  });
});

describe("Y and O", () => {
  it("asks a markdown cell's realm, leaves a code cell's, and hides and shows outputs", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const md = await store.add("markdown", undefined, "# a");
      const code = await store.add("server", undefined, "1");
      if (md === undefined || code === undefined) throw new Error("no cells");
      ui.select(code.id);
      await dispatcher.dispatch("ui.cell.toCode");
      expect(ui.overlay).toBeNull();
      await dispatcher.dispatch("ui.cell.toggleOutputs");
      await whenTrue(() => store.byId.get(code.id)?.meta.outputsHidden === true);
      await dispatcher.dispatch("ui.cell.toggleOutputs");
      await whenTrue(() => store.byId.get(code.id)?.meta.outputsHidden === false);
      ui.select(md.id);
      await dispatcher.dispatch("ui.cell.toCode");
      expect(ui.overlay).toEqual({ kind: "typeMenu", cell: md.id, toCode: true });
      await dispatcher.dispatch("ui.cell.type", { type: "client", from: "markdown" });
      await whenTrue(() => store.byId.get(md.id)?.type === "client");
    });
  });
});

describe("↩ on a DefinedInClient cell", () => {
  it("switches it to client; on any other cell it edits", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      await store.add("client", undefined, "const format = () => 1");
      const server = await store.add("server", undefined, "format()");
      if (server === undefined) throw new Error("no cell");
      ui.select(server.id);
      await dispatcher.dispatch("ui.run.inPlace");
      await whenTrue(() => store.lastExecutionOf(server.id)?.error?.name === "DefinedInClient");
      await dispatcher.dispatch("ui.mode.edit");
      await whenTrue(() => store.byId.get(server.id)?.type === "client");
      expect(ui.mode).toBe("command");
      await dispatcher.dispatch("ui.mode.edit");
      expect(ui.mode).toBe("edit");
    });
  });
});

describe("undo of large and quick deletes", () => {
  it("keeps a range of more than ten cells whole, and two quick Z or X act once", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      for (let n = 1; n <= 13; n += 1) await store.add("server", undefined, String(n));
      const sources = () => store.cellsInOrder.map((cell) => cell.source);
      ui.select(store.cellsInOrder[0]?.id ?? null);
      for (let n = 0; n < 11; n += 1) await dispatcher.dispatch("ui.select.extendNext");
      expect(store.markedCells).toHaveLength(12);
      await dispatcher.dispatch("cell.delete");
      await whenTrue(() => store.cellsInOrder.length === 1);
      await Promise.all([dispatcher.dispatch("undo.restore"), dispatcher.dispatch("undo.restore")]);
      await whenTrue(() => store.cellsInOrder.length === 13);
      expect(sources()).toEqual(Array.from({ length: 13 }, (_, n) => String(n + 1)));
      expect(ui.toasts.some((toast) => toast.kind === "error")).toBe(false);
      ui.select(store.cellsInOrder[11]?.id ?? null);
      await dispatcher.dispatch("ui.select.extendNext");
      await Promise.all([dispatcher.dispatch("ui.cells.cut"), dispatcher.dispatch("ui.cells.cut")]);
      await whenTrue(() => store.cellsInOrder.length === 11);
      expect(ui.clipboard.map((cell) => cell.source)).toEqual(["12", "13"]);
      expect(ui.toasts.some((toast) => toast.kind === "error")).toBe(false);
    });
  });
});

describe("Y on a marked range", () => {
  it("asks the realm once and changes only the markdown cells", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui } = await startPage(daemon, notebook);
      const dispatcher = createDispatcher();
      const client = await store.add("client", undefined, "1");
      const md = await store.add("markdown", undefined, "# a");
      const server = await store.add("server", undefined, "2");
      if (client === undefined || md === undefined || server === undefined)
        throw new Error("no cells");
      ui.select(server.id);
      await dispatcher.dispatch("ui.cell.toCode");
      expect(ui.overlay).toBeNull();
      await dispatcher.dispatch("ui.select.extendPrevious");
      await dispatcher.dispatch("ui.select.extendPrevious");
      await dispatcher.dispatch("ui.cell.toCode");
      expect(ui.overlay).toMatchObject({ kind: "typeMenu", toCode: true });
      await dispatcher.dispatch("ui.cell.type", { type: "server", from: "markdown" });
      await whenTrue(() => store.byId.get(md.id)?.type === "server");
      expect(store.byId.get(client.id)?.type).toBe("client");
    });
  });
});
