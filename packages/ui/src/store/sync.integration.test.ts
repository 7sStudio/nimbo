// @vitest-environment node
// The mirror's fetches racing a close on a real daemon: a cell that is running when an agent closes the
// notebook ends interrupted just before the close, so the store's fetch of its outputs and summary finds the notebook
// gone; the page reads closed and shows no error toast.
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { startPage, whenTrue } from "./fixtures/page.js";

const notebook = "race.jsnb";

describe("a close while a cell runs", () => {
  it("reads closed with no toast when an agent closes the notebook mid-run", async () => {
    await withDaemon(async (daemon) => {
      const { store, ui, client } = await startPage(daemon, notebook);
      const cell = await store.add("server", undefined, "await new Promise(() => {})");
      if (cell === undefined) throw new Error("no cell");
      await store.run(cell.id);
      await whenTrue(() => store.runningCell === cell.id);
      await daemon.client.notebook.close({ notebook });
      await whenTrue(() => store.mirror.closed);
      // A call sent after the run's fetches on the same socket: once it is answered, theirs are too.
      await client.workspace.info({});
      expect(ui.toasts).toEqual([]);
    });
  });
});
