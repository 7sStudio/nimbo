// The example notebooks shipped with the app on a real daemon and a real kernel: each is in the file
// format's exact form, listed with its title and purpose, copied under a free name without touching the shipped file,
// and runs clean with Run all in a workspace of its own, with no package installed, no network and no .env (the
// payment example answers its own samples); the queries the data example pins answer on the daemon. Client cells
// need the page, so Run all lists them as skipped here; the journeys run them in the built page.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Cell } from "@jsnb/core";
import { parse, randomIds, serialize } from "@jsnb/core";
import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { shippedExamples } from "./examples.js";

const files = async () =>
  (await readdir(shippedExamples)).filter((file) => file.endsWith(".jsnb")).sort();
const hashOf = async (file: string) =>
  createHash("sha256")
    .update(await readFile(join(shippedExamples, file)))
    .digest("hex");

describe("the shipped examples", () => {
  it("are the five, each in the file format's exact form, with a title and a purpose", async () => {
    expect(await files()).toEqual([
      "01-data.jsnb",
      "02-client-ui.jsnb",
      "03-payments.jsnb",
      "04-routes-and-agents.jsnb",
      "05-vue.jsnb",
    ]);
    for (const file of await files()) {
      const text = await readFile(join(shippedExamples, file), "utf8");
      const parsed = parse(text, { ids: randomIds(), path: file, appVersion: "0.0.0" });
      expect(parsed.ok && serialize(parsed.value.doc)).toBe(text);
    }
    await withDaemon(async (daemon) => {
      const { examples } = await daemon.client.examples.list({});
      expect(examples.map((each) => each.name)).toEqual([
        "01-data",
        "02-client-ui",
        "03-payments",
        "04-routes-and-agents",
        "05-vue",
      ]);
      for (const each of examples) {
        expect(each.title).not.toBe(each.name);
        expect(each.purpose).toMatch(/^[A-Z][^:]+\.$/u);
      }
    });
  });
});

describe("examples.copy", () => {
  it("copies under the example's name, then the next free number, never touching the shipped file", async () => {
    await withDaemon(async (daemon, ws) => {
      const before = await hashOf("02-client-ui.jsnb");
      await writeFile(ws.path("02-client-ui-2.jsnb"), "taken\n");
      const copies = [];
      for (let at = 0; at < 3; at += 1)
        copies.push((await daemon.client.examples.copy({ name: "02-client-ui" })).path);
      expect(copies).toEqual(["02-client-ui.jsnb", "02-client-ui-3.jsnb", "02-client-ui-4.jsnb"]);
      expect(await readFile(ws.path("02-client-ui-2.jsnb"), "utf8")).toBe("taken\n");
      const shipped = await readFile(join(shippedExamples, "02-client-ui.jsnb"), "utf8");
      expect(await readFile(ws.path("02-client-ui-3.jsnb"), "utf8")).toBe(shipped);
      expect(await hashOf("02-client-ui.jsnb")).toBe(before);
      const listed = await daemon.events.until("notebooks.changed", (event) =>
        event.data.notebooks.some((each) => each.path === "02-client-ui-4.jsnb"),
      );
      expect(listed.data.notebooks.map((each) => each.path)).toContain("02-client-ui.jsnb");
      await expect(daemon.client.examples.copy({ name: "../package" })).rejects.toMatchObject({
        code: -32602,
      });
    });
  });
});

describe("Run all on each shipped example", () => {
  it.each(["01-data", "02-client-ui", "03-payments", "04-routes-and-agents", "05-vue"])(
    "%s runs with no failed cell, no package and no key",
    async (name) => {
      await withDaemon(async (daemon) => {
        const { client } = daemon;
        const { path } = await client.examples.copy({ name });
        const { notebook } = await client.notebook.open({ path });
        const run = await client.notebook.run({
          notebook: path,
          select: "all",
          timeoutMs: 60_000,
        });
        const failed = run.executions.filter(
          (each) => each.status !== "ok" || each.outputs.some((output) => output.kind === "error"),
        );
        expect(failed.map((each) => [each.cell, each.status, each.error?.message])).toEqual([]);
        const clients = notebook.cells
          .filter((cell) => cell.type === "client")
          .map((cell) => cell.id);
        expect(run.skipped.map((each) => each.cell)).toEqual(clients);
        const code = notebook.cells.filter((cell) => cell.type === "server");
        expect(run.executions).toHaveLength(code.length);
        await pinnedQueriesAnswer(client, path, notebook.cells);
      });
    },
    120_000,
  );
});

type Client = Parameters<Parameters<typeof withDaemon>[0]>[0]["client"];

/** Every query a cell pins answers on the daemon, over the cell's own value. */
async function pinnedQueriesAnswer(
  client: Client,
  notebook: string,
  cells: readonly Cell[],
): Promise<void> {
  for (const cell of cells) {
    const pinned = cell.meta.outputQuery;
    if (pinned === undefined) continue;
    const { mode } = pinned;
    const answer = await client.cell.outputQuery({
      notebook,
      cell: cell.id,
      index: 0,
      mode,
      query: pinned.query,
    });
    expect(answer.timedOut ?? false).toBe(false);
    expect(answer.total).toBeGreaterThan(0);
  }
}
