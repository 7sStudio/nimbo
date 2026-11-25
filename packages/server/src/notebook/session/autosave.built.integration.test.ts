// The built daemon (server:integration) writes a notebook once for a burst of edits: the one notebook.saved after the
// burst already holds the last edit.
import { readFile } from "node:fs/promises";

import { connectDaemon } from "../../fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { readServerJson, spawnBuiltDaemon } from "../../fixtures/builtDaemon.js";

describe("the built daemon's autosave of a burst of edits", () => {
  it("writes the notebook once, the last edit in it", async () => {
    await withWorkspace(async (ws) => {
      const daemonProcess = spawnBuiltDaemon(ws);
      const { url } = await daemonProcess.listening;
      const { client, events, close } = await connectDaemon({
        url,
        token: (await readServerJson(ws)).token,
      });
      try {
        const notebook = "burst.jsnb";
        await client.notebook.create({ path: notebook });
        const { cell } = await client.cell.add({ notebook, type: "markdown", source: "start" });
        await events.until("notebook.saved", (e) => e.notebook === notebook);
        const before = events.all().length;
        // one burst: the twenty updates go out together, as a fast typist's do, so how long the machine takes for each
        // round trip (a loaded one took over the 100 ms coalescing window between two awaited updates) does not split
        // it in two; the socket keeps their order, so the last one sent is the last applied
        const edits = Array.from({ length: 20 }, (_, at) => `edit ${String(at + 1)}`);
        await Promise.all(
          edits.map((source) => client.cell.update({ notebook, cell: cell.id, source })),
        );
        await events.until(
          "notebook.saved",
          (e) => e.notebook === notebook && events.all().indexOf(e) >= before,
        );
        const saves = events
          .all()
          .slice(before)
          .filter((e) => e.type === "notebook.saved");
        expect(saves).toHaveLength(1);
        expect(await readFile(ws.path(notebook), "utf8")).toContain("edit 20");
      } finally {
        close();
        daemonProcess.child.kill("SIGTERM");
        await daemonProcess.exited;
      }
    });
  });
});
