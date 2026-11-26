// What the kernel answers through the daemon: cell.bindings with each name's current value and
// the cell that defined it last, kernel.scope of the server realm, and a late output (a timer's) joining its run.
import { decode } from "@jsnb/core";
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../../../fixtures/notebook.js";

describe("cell.bindings and kernel.scope", () => {
  it("answer the names a cell defined with their current values, and every binding of the server realm", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const define = (await book.ran("const point = { x: 1 }\nlet count = 2")).cell;
      const reassign = (await book.ran("count = 3")).cell;
      const never = await book.add("const later = 1");
      const { bindings } = await daemon.client.cell.bindings({ notebook, cell: define });
      expect(bindings.map((b) => [b.name, decode(b.json), b.definedBy])).toEqual([
        ["point", { x: 1 }, define],
        ["count", 3, reassign],
      ]);
      expect((await daemon.client.cell.bindings({ notebook, cell: never })).bindings).toEqual([]);
      const scope = await daemon.client.kernel.scope({ notebook, realm: "server" });
      expect(scope.bindings.map((b) => b.name).sort()).toEqual(["count", "point"]);
      const client = await daemon.client.kernel.scope({ notebook, realm: "client" });
      expect(client.bindings).toEqual([]);
    });
  });
});

describe("a late output", () => {
  it("arrives as cell.output after the run ended ok and joins the run's outputs", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { cell, execution } = await book.ran(
        "setTimeout(() => console.log('later'), 0)\n'now'", // tested behaviour: a late output from the cell's timer
      );
      expect(execution.status).toBe("ok");
      await daemon.events.until(
        "cell.output",
        (e) =>
          e.data.cell === cell &&
          e.data.output.kind === "stream" &&
          e.data.output.text === "later\n",
      );
      const { execution: last } = await daemon.client.cell.outputs({
        notebook: book.notebook,
        cell,
      });
      expect(last?.outputs.map((output) => output.kind)).toEqual(["value", "stream"]);
    });
  });
});
