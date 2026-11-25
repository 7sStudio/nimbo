// execution.autoRunDependents through the daemon and the real kernel (04-kernel §4.1): a cell.run that ends well runs
// its stale dependents in dependency order, each once; a failure or a manual cell holds back only what depends on it;
// cycles and never-run cells are left alone; an interrupt stops the rest; a run anyone asks for goes first; an edit
// takes a cell out; with the setting off nothing changes.
import type { AutoRunReport, Execution } from "@jsnb/core";
import type { Daemon } from "../../../fixtures/daemon.js";
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import type { TestNotebook } from "../../../fixtures/notebook.js";
import { createNotebook, valueOf } from "../../../fixtures/notebook.js";

const on = (daemon: Daemon) =>
  daemon.client.settings.set({ key: "execution.autoRunDependents", value: true });

/** Adds the cells and runs them all once, so each has a run of its own in this kernel. */
async function ranCells(daemon: Daemon, book: TestNotebook, sources: readonly string[]) {
  const ids: string[] = [];
  for (const source of sources) ids.push(await book.add(source));
  const all = await daemon.client.notebook.run({ notebook: book.notebook, select: "all" });
  expect(all.executions.every((execution) => execution.status === "ok")).toBe(true);
  return ids;
}

const statuses = (report: AutoRunReport | undefined) =>
  report?.executions.map((execution: Execution) => [execution.cell, execution.status]);

/** The cell of every run started (status `running`), in order. */
const started = (daemon: Daemon) =>
  daemon.events
    .all()
    .flatMap((e) => (e.type === "cell.status" && e.data.status === "running" ? [e.data.cell] : []));

describe("execution.autoRunDependents", () => {
  it("runs a diamond's stale dependents in dependency order, each once, and records why they ran", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const [a, c, b, d] = await ranCells(daemon, book, [
        "const a = 1",
        "const c = a * 2",
        "const b = a + 1",
        "const d = b + c\nd",
      ]);
      await on(daemon);
      await daemon.client.cell.update({ notebook, cell: a ?? "", source: "const a = 10" });
      const ran = await daemon.client.cell.run({ notebook, cell: a ?? "" });
      expect(ran.execution.status).toBe("ok");
      expect(statuses(ran.autoRun)).toEqual([
        [c, "ok"],
        [b, "ok"],
        [d, "ok"],
      ]);
      expect(ran.autoRun?.pending).toEqual([]);
      expect(ran.autoRun?.skipped).toEqual([]);
      expect(valueOf(ran.autoRun?.executions[2])).toBe(31);
      expect(ran.autoRun?.executions[0]?.autoRun).toEqual({ cell: a, execution: ran.execution.id });
      expect(ran.autoRun?.executions[0]?.requestedBy).toEqual(ran.execution.requestedBy);
      const graph = await daemon.client.notebook.graph({ notebook });
      expect(graph.cells.filter((cell) => cell.stale)).toEqual([]);
      await daemon.events.until(
        "cells.autoRun",
        (e) => e.data.running === null && e.data.added.length === 0,
      );
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("holds back only what depends on a failed or a manual cell, and leaves never-run cells alone", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const [a, fails, fine, below, manual, afterManual] = await ranCells(daemon, book, [
        "let a = 1",
        "if (a > 5) throw new Error('too big')\nconst f = a",
        "const g = a + 1",
        "const h = f + 1",
        "const m = a + 2",
        "const n = m + 1",
      ]);
      const fresh = await book.add("const never = a");
      await on(daemon);
      await daemon.client.cell.update({ notebook, cell: manual ?? "", meta: { manual: true } });
      const ran = await daemon.client.cell.run({ notebook, cell: a ?? "", source: "let a = 9" });
      expect(statuses(ran.autoRun)).toEqual([
        [fails, "error"],
        [fine, "ok"],
      ]);
      expect(ran.autoRun?.skipped).toEqual([
        { cell: manual, reason: "manual" },
        { cell: fresh, reason: "notRun" },
        { cell: below, reason: "upstream", by: fails },
        { cell: afterManual, reason: "upstream", by: manual },
      ]);
      const graph = await daemon.client.notebook.graph({ notebook });
      expect(graph.cells.filter((cell) => cell.stale).map((cell) => cell.id)).toEqual([
        fails,
        below,
        manual,
        afterManual,
        fresh,
      ]);
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("refuses to run through a cycle", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const [root, x, y, z] = await ranCells(daemon, book, [
        "var r = 1",
        "var x = r + (typeof y === 'undefined' ? 0 : y)",
        "var y = x + 1",
        "var z = r + 1",
      ]);
      await on(daemon);
      const ran = await daemon.client.cell.run({ notebook: book.notebook, cell: root ?? "" });
      expect(statuses(ran.autoRun)).toEqual([[z, "ok"]]);
      expect(ran.autoRun?.skipped).toEqual([
        { cell: x, reason: "cycle" },
        { cell: y, reason: "cycle" },
      ]);
      const fromCycle = await daemon.client.cell.run({ notebook: book.notebook, cell: x ?? "" });
      expect(fromCycle.autoRun?.skipped).toEqual([{ cell: y, reason: "cycle" }]);
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("stops the whole cascade on interrupt, the rest left stale", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const [a, slow, after] = await ranCells(daemon, book, [
        "let a = 1",
        "const s = a\nif (a > 1) await new Promise((r) => setTimeout(r, 20_000))",
        "const t = s + 1",
      ]);
      await on(daemon);
      const answer = daemon.client.cell.run({ notebook, cell: a ?? "", source: "let a = 2" });
      await daemon.events.until("cells.autoRun", (e) => e.data.running === slow);
      await daemon.client.kernel.interrupt({ notebook });
      const ran = await answer;
      expect(statuses(ran.autoRun)).toEqual([[slow, "interrupted"]]);
      expect(ran.autoRun?.skipped).toEqual([{ cell: after, reason: "stopped" }]);
      const graph = await daemon.client.notebook.graph({ notebook });
      expect(graph.cells.filter((cell) => cell.stale).map((cell) => cell.id)).toEqual([
        slow,
        after,
      ]);
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("runs what anyone asks for before the rest of a cascade, and drops a cell edited meanwhile", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const [a, slow, later, edited, other] = await ranCells(daemon, book, [
        "let a = 1",
        "const s = a\nif (a > 1) await new Promise((r) => setTimeout(r, 300))",
        "const l = a + 1",
        "const e = a + 2",
        "globalThis.other = (globalThis.other ?? 0) + 1",
      ]);
      await on(daemon);
      const before = started(daemon).length;
      const answer = daemon.client.cell.run({ notebook, cell: a ?? "", source: "let a = 2" });
      await daemon.events.until("cells.autoRun", (e) => e.data.running === slow);
      await book.start(other ?? "");
      await daemon.client.cell.update({ notebook, cell: edited ?? "", source: "const e = a + 3" });
      const ran = await answer;
      expect(started(daemon).slice(before)).toEqual([a, slow, other, later]);
      expect(statuses(ran.autoRun)).toEqual([
        [slow, "ok"],
        [later, "ok"],
      ]);
      expect(ran.autoRun?.skipped).toEqual([{ cell: edited, reason: "edited" }]);
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("answers at once without waitAutoRun, listing what it will run", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const [a, b] = await ranCells(daemon, book, ["let a = 1", "const b = a + 1"]);
      await on(daemon);
      const ran = await daemon.client.cell.run({
        notebook: book.notebook,
        cell: a ?? "",
        waitAutoRun: false,
      });
      const listed = [
        ...(ran.autoRun?.pending ?? []),
        ...(ran.autoRun?.executions ?? []).map((execution) => execution.cell),
      ];
      expect(listed).toEqual([b]);
      await daemon.events.until(
        "cells.autoRun",
        (e) => e.data.running === null && e.data.added.length === 0,
      );
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("with the setting off, marks dependents stale and runs nothing", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const [a, b] = await ranCells(daemon, book, ["let a = 1", "const b = a + 1"]);
      const before = started(daemon).length;
      const ran = await daemon.client.cell.run({ notebook: book.notebook, cell: a ?? "" });
      expect(ran.autoRun).toBeUndefined();
      expect(started(daemon).slice(before)).toEqual([a]);
      const graph = await daemon.client.notebook.graph({ notebook: book.notebook });
      expect(graph.cells.find((cell) => cell.id === b)?.stale).toBe(true);
      expect(daemon.events.all().some((e) => e.type === "cells.autoRun")).toBe(false);
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("never runs code that has not run: a cell whose run never started, or edited since its run", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const a = await book.add("let a = 1");
      await book.add("throw new Error('stop')");
      const c = await book.add("const c = a + 1");
      const all = await daemon.client.notebook.run({ notebook, select: "all" });
      expect(all.executions.map((execution) => execution.status)).toEqual([
        "ok",
        "error",
        "interrupted",
      ]);
      await on(daemon);
      const first = await daemon.client.cell.run({ notebook, cell: a, source: "let a = 2" });
      expect(first.autoRun?.skipped).toEqual([{ cell: c, reason: "notRun" }]);
      expect(first.autoRun?.executions).toEqual([]);
      expect((await daemon.client.cell.run({ notebook, cell: c })).execution.status).toBe("ok");
      await daemon.client.cell.update({ notebook, cell: c, source: "const c = a + 2" });
      const edited = await daemon.client.cell.run({ notebook, cell: a, source: "let a = 3" });
      expect(edited.autoRun?.skipped).toEqual([{ cell: c, reason: "notRun" }]);
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("stops when the kernel dies and never starts a kernel for the rest", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const [a, dies, q, z] = await ranCells(daemon, book, [
        "let a = 1",
        "if (a > 1) process.exit(3)",
        "await Promise.resolve()\nconst q = a + 1",
        "const z = q + 1",
      ]);
      await on(daemon);
      const ran = await daemon.client.cell.run({ notebook, cell: a ?? "", source: "let a = 2" });
      expect(statuses(ran.autoRun)).toEqual([[dies, "error"]]);
      expect(ran.autoRun?.skipped).toEqual([
        { cell: q, reason: "stopped" },
        { cell: z, reason: "stopped" },
      ]);
      expect((await daemon.client.kernel.status({ notebook })).state).toBe("dead");
    });
  });
});

describe("execution.autoRunDependents", () => {
  it("names a waiting cell deleted meanwhile as deleted, and the page hydrates the cascade from notebook.get", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const [a, slow, gone, after] = await ranCells(daemon, book, [
        "let a = 1",
        "const s = a\nif (a > 1) await new Promise((r) => setTimeout(r, 300))",
        "const g = a + 1",
        "const h = s + 1",
      ]);
      await on(daemon);
      const answer = daemon.client.cell.run({ notebook, cell: a ?? "", source: "let a = 2" });
      await daemon.events.until("cells.autoRun", (e) => e.data.running === slow);
      const { notebook: state } = await daemon.client.notebook.get({ notebook });
      expect(state.autoRun).toEqual({ running: slow, pending: [gone, after] });
      await daemon.client.cell.delete({ notebook, cell: gone ?? "" });
      const ran = await answer;
      expect(statuses(ran.autoRun)).toEqual([
        [slow, "ok"],
        [after, "ok"],
      ]);
      expect(ran.autoRun?.skipped).toEqual([{ cell: gone, reason: "deleted" }]);
    });
  });
});
