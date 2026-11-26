// The run queue through the daemon: one run at a time per notebook in call order (a cell run twice
// runs twice), and notebook.run over a selection: notebook order, markdown left out, client cells with no page
// skipped, stopOnError ending the rest `interrupted` unstarted, and its own wait and timeout; a cell edited while it
// runs keeps the running code, and its queued run reads the source when it starts.
import { bridgeCall } from "@jsnb/core";
import type { Daemon } from "../../../fixtures/daemon.js";
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook, valueOf } from "../../../fixtures/notebook.js";

/** The cell and status of every cell.status event past `queued`, in arrival order. */
const transitions = (daemon: Daemon) =>
  daemon.events
    .all()
    .flatMap((e) =>
      e.type === "cell.status" && e.data.status !== "queued" ? [[e.data.cell, e.data.status]] : [],
    );

describe("the run queue of a notebook", () => {
  it("runs one run at a time in call order, a cell run twice included", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const a = await book.add("globalThis.seen = [...(globalThis.seen ?? []), 'a']");
      const b = await book.add(
        "await Promise.resolve()\nglobalThis.seen = [...globalThis.seen, 'b']",
      );
      const count = await book.add("globalThis.n = (globalThis.n ?? 0) + 1");
      const queued = [
        await book.start(a),
        await book.start(b),
        await book.start(count),
        await book.start(count),
      ];
      expect(queued.map((run) => run.status)).toEqual(["queued", "queued", "queued", "queued"]);
      await book.reaches(queued[3]?.id ?? "", "ok");
      expect(transitions(daemon)).toEqual([
        [a, "running"],
        [a, "ok"],
        [b, "running"],
        [b, "ok"],
        [count, "running"],
        [count, "ok"],
      ]);
      const counted = await daemon.client.cell.outputs({ notebook: book.notebook, cell: count });
      expect(valueOf(counted.execution)).toBe(2);
      expect(valueOf((await book.ran("globalThis.seen")).execution)).toEqual(["a", "b"]);
    });
  });
});

describe("notebook.run", () => {
  it("runs the selection in notebook order, skips client cells with no page and stops after an error", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const a = await book.add("const a = 1\na");
      await book.add("# notes", "markdown");
      const client = await book.add("a", "client");
      const b = await book.add("throw new Error('stop here')");
      const c = await book.add("a + 1");
      const stopped = await daemon.client.notebook.run({ notebook, select: "all", wait: true });
      expect(stopped.skipped).toEqual([
        {
          cell: client,
          code: "REALM_NOT_ATTACHED",
          message: expect.stringMatching(/realm\.headless/u) as unknown,
        },
      ]);
      expect(stopped.executions.map((e) => [e.cell, e.status])).toEqual([
        [a, "ok"],
        [b, "error"],
        [c, "interrupted"],
      ]);
      // the run that never started names the cell whose failure stopped it; the ones that ran name none
      expect(stopped.executions.map((e) => e.stoppedBy)).toEqual([undefined, undefined, b]);
      const unstarted = await daemon.client.cell.outputs({ notebook, cell: c });
      expect(unstarted.execution).toMatchObject({
        status: "interrupted",
        durationMs: 0,
        stoppedBy: b,
      });
      const all = await daemon.client.notebook.run({
        notebook,
        select: { cells: [b, c] },
        stopOnError: false,
      });
      expect(all.executions.map((e) => [e.cell, e.status])).toEqual([
        [b, "error"],
        [c, "ok"],
      ]);
      expect(valueOf(all.executions[1])).toBe(2);
      expect(all.executions.map((e) => e.stoppedBy)).toEqual([undefined, undefined]);
    });
  });
});

describe("notebook.run's wait", () => {
  it("answers queued at once without wait, and with timedOut when timeoutMs passes first", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      await daemon.events.until("kernel.status", (e) => e.data.state === "idle");
      const hang = await book.add("await new Promise(() => {})");
      const after = await book.add("1");
      const queued = await daemon.client.notebook.run({ notebook, select: "all", wait: false });
      expect(queued.executions.map((e) => e.status)).toEqual(["queued", "queued"]);
      await daemon.client.kernel.interrupt({ notebook });
      const select = { cells: [hang, after] };
      const late = await daemon.client.notebook.run({ notebook, select, timeoutMs: 50 });
      const [first, second] = late.executions;
      // the first run started within the 50 ms, or not yet on a loaded machine
      expect([first?.cell, first?.timedOut]).toEqual([hang, true]);
      expect(["queued", "running"]).toContain(first?.status);
      expect([second?.cell, second?.status, second?.timedOut]).toEqual([after, "queued", true]);
      await book.reaches(first?.id ?? "", "running");
      await daemon.client.kernel.interrupt({ notebook });
    });
  });
});

describe("cell.update of a cell that runs and is queued again", () => {
  it("leaves the running run on the code it started with; the queued run reads the source when it starts", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      await book.ran(
        "globalThis.hold = new Promise((resolve) => { globalThis.release = resolve })\nexport function free() { globalThis.release() }",
      );
      const cell = await book.add('await globalThis.hold\n"old"');
      const first = daemon.client.cell.run({ notebook, cell });
      await book.cellReaches(cell, "running");
      const second = (await daemon.client.cell.run({ notebook, cell, wait: false })).execution;
      expect(second.status).toBe("queued");
      await daemon.client.cell.update({ notebook, cell, source: '"new"' });
      await daemon.client.call(bridgeCall, { notebook, fn: "free", args: [] });
      expect(valueOf((await first).execution)).toBe("old");
      await book.reaches(second.id, "ok");
      expect(valueOf((await daemon.client.cell.outputs({ notebook, cell })).execution)).toBe("new");
    });
  });
});
