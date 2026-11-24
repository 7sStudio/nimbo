// Agent edits waiting for review (03-api §4.3, §5) through a real daemon: the code before the first edit no
// one reviewed and the lines changed since, over several agent edits; a user's edit in between; cell.revert by the
// user and by an agent, the editor's undo of a revert; cell.markReviewed; the events; and the file across a reload.
import { readFile } from "node:fs/promises";

import type { Cell } from "@jsnb/core";
import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

const notebook = "a.jsnb";

describe("an agent's new cell", () => {
  it("waits for review from empty code, and cell.markReviewed keeps who made it and when", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const agent = daemon.socket({ client: "mcp", agent: "claude-code" });
      const added = await agent.cell.add({ notebook, type: "server", source: "a\nb\nc" });
      expect(added.cell.meta.lastEdit).toMatchObject({
        by: "agent",
        client: "mcp",
        agent: "claude-code",
        review: { previousSource: "", previousType: "server", lines: [{ from: 1, to: 3 }] },
      });
      const done = await agent.cell.markReviewed({ notebook, cell: added.cell.id });
      expect(done.cell.meta.lastEdit).toEqual({
        by: "agent",
        client: "mcp",
        agent: "claude-code",
        at: added.cell.meta.lastEdit?.at,
      });
    });
  });
});

describe("an agent's edits in a row", () => {
  it("keep the code before the first edit no one reviewed, and the lines that differ from it now", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const agent = daemon.socket({ client: "mcp", agent: "claude-code" });
      const user = daemon.socket({ client: "ui" });
      const added = await user.cell.add({ notebook, type: "server", source: "a\nb\nc" });
      const ref = { notebook, cell: added.cell.id };
      await agent.cell.update({ ...ref, source: "a\nB\nc" });
      const cli = daemon.http({ client: "cli" });
      const second = await cli.cell.update({ ...ref, source: "a\nB\nc\nd" });
      expect(second.cell.meta.lastEdit).toMatchObject({
        by: "agent",
        client: "cli",
        review: {
          previousSource: "a\nb\nc",
          previousType: "server",
          lines: [
            { from: 2, to: 2 },
            { from: 4, to: 4 },
          ],
        },
      });
      const event = await daemon.events.until(
        "cell.updated",
        (e) => e.data.cell.source === "a\nB\nc\nd",
      );
      expect(event.data.cell.meta.lastEdit?.review?.lines).toEqual(
        second.cell.meta.lastEdit?.review?.lines,
      );
      // back to the code before: nothing is left to review
      const back = await agent.cell.update({ ...ref, source: "a\nb\nc" });
      expect(back.cell.meta.lastEdit?.review).toBeUndefined();
      expect(back.cell.meta.lastEdit).toMatchObject({ by: "agent", client: "mcp" });
    });
  });
});

describe("the user's edit of a cell an agent edited", () => {
  it("ends the review, while a meta-only update keeps it", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const agent = daemon.socket({ client: "mcp", agent: "claude-code" });
      const user = daemon.socket({ client: "ui" });
      const { cell } = await user.cell.add({ notebook, type: "server", source: "1" });
      const ref = { notebook, cell: cell.id };
      expect(cell.meta.lastEdit?.review).toBeUndefined();
      await agent.cell.update({ ...ref, source: "2" });
      const pinned = await user.cell.update({ ...ref, meta: { collapsed: true } });
      expect(pinned.cell.meta.lastEdit?.review).toMatchObject({ previousSource: "1" });
      const typed = await user.cell.update({ ...ref, source: "2 + 1" });
      expect(typed.cell.meta.lastEdit).toMatchObject({ by: "user", client: "ui" });
      expect(typed.cell.meta.lastEdit?.review).toBeUndefined();
      // the next agent edit starts a review from the user's code
      const again = await agent.cell.update({ ...ref, source: "3" });
      expect(again.cell.meta.lastEdit?.review).toMatchObject({ previousSource: "2 + 1" });
    });
  });
});

describe("cell.revert by the user", () => {
  it("puts the code back as the user's edit, and the editor's undo of it starts no review", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const agent = daemon.socket({ client: "mcp", agent: "claude-code" });
      const user = daemon.socket({ client: "ui" });
      const a = (await user.cell.add({ notebook, type: "server", source: "const x = 1" })).cell;
      const b = (await user.cell.add({ notebook, type: "server", source: "x + 1" })).cell;
      await agent.cell.update({ notebook, cell: a.id, source: "const x = 2" });
      await agent.cell.update({ notebook, cell: a.id, type: "client" });
      const reverted = await user.cell.revert({ notebook, cell: a.id });
      expect([reverted.cell.source, reverted.cell.type]).toEqual(["const x = 1", "server"]);
      expect(reverted.cell.meta.lastEdit).toMatchObject({ by: "user", client: "ui" });
      expect(reverted.cell.meta.lastEdit?.review).toBeUndefined();
      // an edit like any other: the cell's dependents are stale
      await daemon.events.until("cells.stale", (e) => e.data.cells.includes(b.id));
      // the page's undo sends the agent's text back as the user's edit
      const undone = await user.cell.update({ notebook, cell: a.id, source: "const x = 2" });
      expect(undone.cell.meta.lastEdit).toMatchObject({ by: "user" });
      expect(undone.cell.meta.lastEdit?.review).toBeUndefined();
    });
  });
});

describe("cell.revert by an agent", () => {
  it("leaves nothing to review, and a cell with nothing to review is left as it is", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: notebook });
      const cli = daemon.http({ client: "cli" });
      const { cell } = await cli.cell.add({ notebook, type: "server", source: "1" });
      const ref = { notebook, cell: cell.id };
      await cli.cell.update({ ...ref, source: "2" });
      const reverted = await cli.cell.revert(ref);
      // the agent's own cell: its code before the first edit was empty
      expect(reverted.cell.source).toBe("");
      expect(reverted.cell.meta.lastEdit).toMatchObject({ by: "agent", client: "cli" });
      expect(reverted.cell.meta.lastEdit?.review).toBeUndefined();
      const seq = daemon.events.all().length;
      const again = await cli.cell.revert(ref);
      const marked = await cli.cell.markReviewed(ref);
      expect([again.cell, marked.cell]).toEqual([reverted.cell, reverted.cell]);
      const later = daemon.events.all().slice(seq);
      expect(later.filter((e) => e.type === "cell.updated")).toEqual([]);
      await expect(cli.cell.revert({ notebook, cell: "c_999999" })).rejects.toMatchObject({
        code: 1002,
      });
    });
  });
});

describe("a review in the file", () => {
  it("keeps the code before, never the derived lines, and survives a reload from disk", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: notebook });
      const user = daemon.socket({ client: "ui" });
      const agent = daemon.socket({ client: "mcp", agent: "claude-code" });
      const { cell } = await user.cell.add({ notebook, type: "server", source: "a\nb" });
      await agent.cell.update({ notebook, cell: cell.id, source: "a\nB" });
      await daemon.client.notebook.save({ notebook });
      const text = await readFile(ws.path(notebook), "utf8");
      const stored = (JSON.parse(text) as { cells: { meta: { lastEdit: unknown } }[] }).cells[0];
      expect(stored?.meta.lastEdit).toEqual({
        by: "agent",
        client: "mcp",
        agent: "claude-code",
        at: expect.any(String) as unknown,
        review: { previousSource: "a\nb", previousType: "server" },
      });
      const reloaded = await daemon.client.notebook.reload({ notebook });
      const after: Cell | undefined = reloaded.notebook.cells[0];
      expect(after?.meta.lastEdit?.review).toEqual({
        previousSource: "a\nb",
        previousType: "server",
        lines: [{ from: 2, to: 2 }],
      });
      await daemon.client.cell.markReviewed({ notebook, cell: cell.id });
      await daemon.client.notebook.save({ notebook });
      const clean = JSON.parse(await readFile(ws.path(notebook), "utf8")) as {
        cells: { meta: { lastEdit: Record<string, unknown> } }[];
      };
      expect(clean.cells[0]?.meta.lastEdit).not.toHaveProperty("review");
    });
  });
});
