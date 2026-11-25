// The bridge suite, 05-bridge §11 item 8 with §5 (real kernel, daemon and page): a client cell depends on the server
// cell whose export it uses; re-running the server cell marks it stale and its own run clears it; withDependents runs it
// after the server cell when a page is attached and lists it skipped otherwise; a server cell that stops exporting the
// name (edited, or deleted) marks it stale and its next run fails NotExported, while a stub the page already holds
// keeps calling the kernel's function until the server cell runs again.
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

describe("a client cell using a server export", () => {
  it("depends on that server cell, goes stale when it re-runs and clears on its own run", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      const price = await server("export const price = 1");
      const total = await client("price + 1");
      expect(valueOf(await run(total))).toBe(2);
      const { cells } = await daemon.client.notebook.graph({ notebook });
      expect(cells.find((cell) => cell.id === total)).toMatchObject({
        uses: ["price"],
        dependsOn: [price],
        stale: false,
      });
      const staleOf = async () =>
        (await daemon.client.notebook.graph({ notebook })).cells.find((cell) => cell.id === total)
          ?.stale;
      await run(price);
      expect(await staleOf()).toBe(true);
      await run(total);
      expect(await staleOf()).toBe(false);
    });
  });
});

describe("a client cell using a server export, and withDependents", () => {
  it("runs after it across the boundary, and is skipped when no page is attached", async () => {
    await withBridge(async ({ daemon, notebook, page, server, client }) => {
      const price = await server("export const price = 1");
      const total = await client("price * 10");
      const ran = await daemon.client.notebook.run({ notebook, select: { withDependents: price } });
      expect(ran.executions.map((each) => [each.cell, each.status])).toEqual([
        [price, "ok"],
        [total, "ok"],
      ]);
      expect(valueOf(ran.executions[1])).toBe(10);
      expect(ran.skipped).toEqual([]);
      await page.detach();
      await daemon.events.until("realm.status", (event) => !event.data.attached);
      const alone = await daemon.client.notebook.run({
        notebook,
        select: { withDependents: price },
      });
      expect(alone.executions.map((each) => each.cell)).toEqual([price]);
      expect(alone.skipped).toEqual([
        {
          cell: total,
          code: "REALM_NOT_ATTACHED",
          message: expect.stringMatching(/realm\.headless/u) as unknown,
        },
      ]);
    });
  });
});

describe("a server cell that stops exporting a name", () => {
  it("marks its client dependents stale; their next run fails NotExported, a held stub works until it re-runs", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      const maker = await server("export function f() { return 1 }");
      const holder = await client("const keep = () => f()\nawait keep()");
      expect(valueOf(await run(holder))).toBe(1);
      await daemon.client.cell.update({
        notebook,
        cell: maker,
        source: "function f() { return 1 }",
      });
      await daemon.events.until("cells.stale", (event) => event.data.cells.includes(holder));
      expect((await run(holder)).error).toMatchObject({
        name: "NotExported",
        message:
          "f is defined in server cell 1 but not exported. Add export in that cell to use it here.",
      });
      const caller = await client("await keep()");
      expect(valueOf(await run(caller))).toBe(1);
      await run(maker);
      expect((await run(caller)).error).toMatchObject({
        name: "NotExported",
        data: { cell: maker },
      });
    });
  });
});

describe("a server cell that exports a name and is deleted", () => {
  it("marks its client dependents stale and their next run fails NotExported, naming no cell", async () => {
    await withBridge(async ({ daemon, notebook, server, client, run }) => {
      const maker = await server('export const token = "t"');
      const reader = await client("token");
      expect(valueOf(await run(reader))).toBe("t");
      await daemon.client.cell.delete({ notebook, cell: maker });
      await daemon.events.until("cells.stale", (event) => event.data.cells.includes(reader));
      expect((await run(reader)).error).toMatchObject({
        name: "NotExported",
        message:
          "token is no longer exported by any server cell. Export it from a server cell to use it here.",
        data: { name: "token" },
      });
    });
  });
});
