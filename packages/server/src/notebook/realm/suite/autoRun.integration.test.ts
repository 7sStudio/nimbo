// The bridge suite with execution.autoRunDependents (04-kernel §4.1, 05-bridge §5; real kernel, daemon and page): a
// client cell using a server export re-runs in the page after the server cell runs, and with no page attached it is
// left stale and named, not failed.
import { describe, expect, it } from "vitest";

import { bridgeSuite } from "../../../fixtures/bridge.js";
import { valueOf } from "../../../fixtures/notebook.js";

const { withBridge } = bridgeSuite();

describe("auto-run across the bridge", () => {
  it("re-runs a client dependent in the page, and leaves it stale with no page", async () => {
    await withBridge(async ({ daemon, notebook, page, server, client, run }) => {
      const price = await server("export const price = 1");
      const total = await client("price * 10");
      expect(valueOf(await run(total))).toBe(10);
      await daemon.client.settings.set({ key: "execution.autoRunDependents", value: true });
      const ran = await daemon.client.cell.run({
        notebook,
        cell: price,
        source: "export const price = 2",
      });
      expect(ran.autoRun?.executions.map((each) => [each.cell, each.status])).toEqual([
        [total, "ok"],
      ]);
      expect(valueOf(ran.autoRun?.executions[0])).toBe(20);
      await page.detach();
      await daemon.events.until("realm.status", (event) => !event.data.attached);
      const alone = await daemon.client.cell.run({ notebook, cell: price });
      expect(alone.autoRun).toEqual({
        executions: [],
        pending: [],
        skipped: [{ cell: total, reason: "noPage" }],
      });
      const graph = await daemon.client.notebook.graph({ notebook });
      expect(graph.cells.find((cell) => cell.id === total)?.stale).toBe(true);
    });
  });
});
