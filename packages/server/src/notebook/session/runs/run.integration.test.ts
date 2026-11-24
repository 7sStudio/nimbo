// The life of a run through the daemon (02-architecture §5 steps 3 to 8, 03-api §4.3.1), observed through events: the
// queue, the transform and pre-flight, the kernel's outputs, the terminal status with its duration, the stale flags;
// `wait` and `timeoutMs`, markdown cells, `source` applied first, cell.add with `run`.
import type { EventEnvelope } from "@jsnb/core";
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook, valueOf } from "../../../fixtures/notebook.js";

/** The events about `cell` but its edits: statuses by their status, the rest by type. */
const lifeOf = (events: readonly EventEnvelope[], cell: string): readonly string[] =>
  events.flatMap((event) => {
    const data: unknown = event.data;
    const about = typeof data === "object" && data !== null && Reflect.get(data, "cell") === cell;
    if (!about || event.type === "cell.updated") return [];
    return [event.type === "cell.status" ? event.data.status : event.type];
  });

describe("cell.run of a server cell", () => {
  it("queues, runs in the kernel, streams its outputs, ends ok and marks its dependents stale", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const a = await book.add("console.log('hi')\nconst x = 20 + 1\nx");
      const b = await book.add("x * 2");
      const queued = await book.start(a);
      expect(queued).toMatchObject({ cell: a, status: "queued", outputs: [] });
      await book.reaches(queued.id, "ok");
      const stale = await daemon.events.until("cells.stale", (e) => e.data.cells.includes(b));
      expect(lifeOf(daemon.events.all(), a)).toEqual([
        "queued",
        "running",
        "cell.output",
        "cell.output",
        "ok",
      ]);
      expect(stale.data.cells).toEqual([b]);
      const { execution } = await daemon.client.cell.outputs({ notebook: book.notebook, cell: a });
      expect(execution).toMatchObject({ id: queued.id, status: "ok", cell: a });
      expect(execution?.durationMs).toBeGreaterThanOrEqual(0);
      expect(execution?.outputs.map((output) => output.kind)).toEqual(["stream", "value"]);
      expect(valueOf(execution)).toBe(21);
    });
  });
});

describe("cell.run with wait", () => {
  it("answers at the terminal status with the outputs, or at timeoutMs with timedOut and the run going on", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const done = await daemon.client.cell.run({ notebook, cell: await book.add("1 + 1") });
      expect(done.execution).toMatchObject({ status: "ok", outputs: [{ kind: "value" }] });
      expect(done.execution.timedOut).toBeUndefined();
      const hang = await book.add("await new Promise(() => {})");
      const late = await daemon.client.cell.run({ notebook, cell: hang, timeoutMs: 50 });
      expect(late.execution).toMatchObject({ status: "running", timedOut: true });
      const { execution } = await daemon.client.cell.outputs({ notebook, cell: hang });
      expect(execution?.status).toBe("running");
      await daemon.client.kernel.interrupt({ notebook });
      await book.reaches(late.execution.id, "interrupted");
    });
  });
});

describe("cell.run of a markdown cell, and with `source`", () => {
  it("answers ok with no outputs for markdown, and applies `source` first, stamped like an edit", async () => {
    const options = { client: "mcp", agent: "a1" } as const;
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const md = await daemon.client.cell.run({
        notebook,
        cell: await book.add("# hi", "markdown"),
      });
      expect(md.execution).toMatchObject({ status: "ok", outputs: [], durationMs: 0 });
      const code = await book.add("1");
      const edited = await daemon.client.cell.run({ notebook, cell: code, source: "40 + 2" });
      expect(valueOf(edited.execution)).toBe(42);
      const { cell } = await daemon.client.cell.get({ notebook, cell: code });
      expect(cell.source).toBe("40 + 2");
      expect(cell.meta.lastEdit).toMatchObject({ by: "agent", client: "mcp", agent: "a1" });
    }, options);
  });
});

describe("a run that cannot start", () => {
  it("ends in error with MissingPackage before anything executes", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { cell, execution } = await book.ran(
        'import pad from "left-pad"\nimport { z } from "zod"\npad',
      );
      expect(execution).toMatchObject({ status: "error", outputs: [] });
      expect(execution.error).toMatchObject({
        name: "MissingPackage",
        data: { names: ["left-pad", "zod"] },
      });
      expect(lifeOf(daemon.events.all(), cell)).toEqual(["queued", "error"]);
    });
  });

  it("ends in error with a syntax error at its line, and a thrown error with the cell's frames", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const broken = await book.ran("const a = 1\nconst = 2");
      expect(broken.execution).toMatchObject({ status: "error" });
      expect(broken.execution.error?.frames).toEqual([
        expect.objectContaining({ cell: broken.cell, line: 2 }),
      ]);
      const thrown = await book.ran("const n = 1\nthrow new Error('boom')");
      expect(thrown.execution.error).toMatchObject({ name: "Error", message: "boom" });
      expect(thrown.execution.error?.frames[0]).toMatchObject({ cell: thrown.cell, line: 2 });
    });
  });
});

describe("cell.add with run", () => {
  it("adds, runs and answers both; a client cell with no page is refused before it is added", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const added = await daemon.client.cell.add({
        notebook,
        type: "server",
        source: "6 * 7",
        run: true,
      });
      expect(added.cell.status).toBe("ok");
      expect(added.execution).toMatchObject({ status: "ok", cell: added.cell.id });
      await expect(
        daemon.client.cell.add({ notebook, type: "client", source: "1", run: true }),
      ).rejects.toMatchObject({ code: 1004 });
      expect((await daemon.client.notebook.get({ notebook })).notebook.cells).toHaveLength(1);
    });
  });
});
