// The cell edits of 03-api §4.3 through the daemon: edit provenance per connection (09-testing §4.7), the events and
// their order, explicit ids, moves and deletes, and the stale flags of dependents (02-architecture §5 step 2).
import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../../fixtures/notebook.js";
import { bodyOf, postRpc } from "../../fixtures/raw.js";

describe("meta.lastEdit", () => {
  it("is stamped from each connection's declaration on cell.add and cell.update", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const add = { notebook: "a.jsnb", type: "markdown" as const };
      const ui = await daemon.socket({ client: "ui" }).cell.add(add);
      const mcp = await daemon.socket({ client: "mcp", agent: "claude-code" }).cell.add(add);
      const cli = await daemon
        .http({ client: "cli" })
        .cell.update({ notebook: "a.jsnb", cell: ui.cell.id, source: "x" });
      const raw = await postRpc(
        daemon.server.port,
        daemon.server.token,
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "cell.add", params: add }),
      );
      const undeclared = (bodyOf(raw) as { result: { cell: { meta: unknown } } }).result.cell.meta;
      expect(ui.cell.meta.lastEdit).toMatchObject({ by: "user", client: "ui" });
      expect(mcp.cell.meta.lastEdit).toMatchObject({
        by: "agent",
        client: "mcp",
        agent: "claude-code",
      });
      expect(cli.cell.meta.lastEdit).toMatchObject({ by: "agent", client: "cli" });
      expect(undeclared).toMatchObject({ lastEdit: { by: "agent", client: "cli" } });
    });
  });
});

describe("a meta-only cell.update", () => {
  it("keeps the last code edit's stamp, and a null key removes the key", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const agent = daemon.socket({ client: "mcp", agent: "claude-code" });
      const { cell } = await agent.cell.add({ notebook: "a.jsnb", type: "server", source: "1" });
      const ref = { notebook: "a.jsnb", cell: cell.id };
      const query = { mode: "jq" as const, query: ".a" };
      const user = daemon.socket({ client: "ui" });
      const pinned = await user.cell.update({
        ...ref,
        meta: { collapsed: true, outputQuery: query },
      });
      expect(pinned.cell.meta).toMatchObject({ collapsed: true, outputQuery: query });
      expect(pinned.cell.meta.lastEdit).toMatchObject({ by: "agent", client: "mcp" });
      const unpinned = await user.cell.update({ ...ref, meta: { outputQuery: null } });
      expect(unpinned.cell.meta.outputQuery).toBeUndefined();
      expect(unpinned.cell.meta.collapsed).toBe(true);
      expect(unpinned.cell.meta.lastEdit).toEqual(pinned.cell.meta.lastEdit);
      const edited = await user.cell.update({ ...ref, source: "2" });
      expect(edited.cell.meta.lastEdit).toMatchObject({ by: "user", client: "ui" });
      const same = await agent.cell.update({ ...ref, source: "2" });
      expect(same.cell.meta.lastEdit).toEqual(edited.cell.meta.lastEdit);
    });
  });
});

describe("meta.lastEdit sent by a client", () => {
  it("is refused with INVALID_PARAMS", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const { cell } = await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown" });
      const lastEdit = { by: "user", client: "ui", at: "2026-01-01T00:00:00Z" };
      await expect(
        daemon.client.call((await import("@jsnb/core")).cellUpdate, {
          notebook: "a.jsnb",
          cell: cell.id,
          meta: { lastEdit },
        } as never),
      ).rejects.toMatchObject({ code: -32602 });
    });
  });
});

describe("cell.add, cell.move and cell.delete", () => {
  it("place cells by `after`, refuse an id in use, and emit added, moved and deleted", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const add = (extra: object) =>
        daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", ...extra });
      const a = (await add({ source: "a" })).cell;
      const b = (await add({ source: "b", after: null })).cell;
      const c = (await add({ source: "c", after: b.id, id: "c_000000" })).cell;
      const placed = await daemon.client.notebook.get({ notebook: "a.jsnb" });
      expect(placed.notebook.cells.map((cell) => [cell.id, cell.index])).toEqual([
        [b.id, 0],
        [c.id, 1],
        [a.id, 2],
      ]);
      await expect(add({ id: "c_000000" })).rejects.toMatchObject({ code: 1008 });
      await expect(add({ after: "c_999999" })).rejects.toMatchObject({ code: 1002 });
      expect(
        (await daemon.client.cell.move({ notebook: "a.jsnb", cell: b.id, after: a.id })).order,
      ).toEqual([c.id, a.id, b.id]);
      await daemon.client.cell.delete({ notebook: "a.jsnb", cell: c.id });
      const types = daemon.events
        .all()
        .filter((e) => e.notebook === "a.jsnb")
        .map((e) => e.type);
      expect(types.filter((type) => type.startsWith("cell."))).toEqual([
        "cell.added",
        "cell.added",
        "cell.added",
        "cell.moved",
        "cell.deleted",
      ]);
      await expect(
        daemon.client.cell.get({ notebook: "a.jsnb", cell: c.id }),
      ).rejects.toMatchObject({ code: 1002 });
    });
  });
});

describe("cells.stale", () => {
  it("marks the dependents of an edited cell stale and forgets a deleted one", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const add = (source: string) =>
        daemon.client.cell.add({ notebook: "a.jsnb", type: "server", source });
      const a = (await add("const x = 1")).cell;
      const b = (await add("const y = x + 1")).cell;
      const c = (await add("y * 2")).cell;
      await daemon.client.cell.update({ notebook: "a.jsnb", cell: a.id, source: "const x = 2" });
      const stale = await daemon.events.until("cells.stale", (e) => e.data.cells.includes(c.id));
      expect(stale.data.cells).toEqual([b.id, c.id]);
      const graph = await daemon.client.notebook.graph({ notebook: "a.jsnb" });
      expect(graph.cells.map((cell) => [cell.id, cell.dependsOn, cell.stale])).toEqual([
        [a.id, [], false],
        [b.id, [a.id], true],
        [c.id, [b.id], true],
      ]);
      await daemon.client.cell.delete({ notebook: "a.jsnb", cell: c.id });
      expect(
        (await daemon.client.notebook.graph({ notebook: "a.jsnb" })).cells.map((cell) => cell.id),
      ).toEqual([a.id, b.id]);
    });
  });
});

describe("a server cell retyped while it runs", () => {
  it("finishes its run with its old code before the kernel disposes it", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const cell = await book.add("await new Promise((r) => setTimeout(r, 300))\nconst s = 1");
      const answer = daemon.client.cell.run({ notebook: book.notebook, cell });
      await book.cellReaches(cell, "running");
      await daemon.client.cell.update({ notebook: book.notebook, cell, type: "markdown" });
      expect((await answer).execution.status).toBe("ok");
    });
  });
});

describe("a deleted cell added back under its id", () => {
  it("gets its runs back, stale as the graph says since its last run", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const a = await book.add("const x = 1;");
      const b = await book.add("x + 1");
      await daemon.client.cell.run({ notebook, cell: a });
      const { execution } = await daemon.client.cell.run({ notebook, cell: b });
      const restore = async () => {
        await daemon.client.cell.delete({ notebook, cell: b });
        await daemon.client.cell.add({
          notebook,
          id: b,
          type: "server",
          source: "x + 1",
          after: a,
        });
        return (await daemon.client.cell.get({ notebook, cell: b })).cell;
      };
      const back = { status: "ok", stale: false, lastExecution: { id: execution.id } };
      expect(await restore()).toMatchObject(back);

      await daemon.client.cell.update({ notebook, cell: a, source: "const x = 2;" });
      expect(await restore()).toMatchObject({ stale: true, lastExecution: { id: execution.id } });

      await daemon.client.cell.run({ notebook, cell: b });
      await daemon.client.cell.delete({ notebook, cell: b });
      await daemon.client.cell.run({ notebook, cell: a }); // what b read changed while it was gone
      await daemon.client.cell.add({ notebook, id: b, type: "server", source: "x + 1", after: a });
      expect((await daemon.client.cell.get({ notebook, cell: b })).cell.stale).toBe(true);

      await daemon.client.cell.delete({ notebook, cell: b });
      await daemon.client.cell.add({ notebook, id: b, type: "server", source: "x + 2", after: a });
      const fresh = (await daemon.client.cell.get({ notebook, cell: b })).cell;
      expect(fresh).toMatchObject({ status: "idle", stale: false, lastExecution: null });
    });
  });
});
