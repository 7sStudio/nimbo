// A kernel that cannot start: kernel.nodePath naming no Node makes the start fail, so
// kernel.status is dead and the run ends error with the start's error; once the setting names a Node again, the next
// run starts a fresh kernel; a close while the kernel still starts is logged at info, an expected end of that start,
// and answers once that start ended, even when it came before the fork (the Node check held at a gate); a restart
// before the fork launches the new kernel only once the old start ended.
import { readFile } from "node:fs/promises";

import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { gatedNode } from "../../../fixtures/gatedNode.js";
import { createNotebook, valueOf } from "../../../fixtures/notebook.js";

describe("a kernel that cannot start", () => {
  it("is dead, ends the run error with the start's error, and the next run starts once the setting is fixed", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.settings.set({ key: "kernel.nodePath", value: ws.path("no-node") });
      const book = await createNotebook(daemon);
      const cell = await book.add("1 + 1");
      const { execution } = await daemon.client.cell.run({ notebook: book.notebook, cell });
      expect(execution.status).toBe("error");
      expect(execution.error?.message).toContain("no-node");
      expect((await daemon.client.kernel.status({ notebook: book.notebook })).state).toBe("dead");
      await daemon.client.settings.set({ key: "kernel.nodePath", value: process.execPath });
      const again = await daemon.client.cell.run({ notebook: book.notebook, cell });
      expect(valueOf(again.execution)).toBe(2);
    });
  });
});

describe("a close while the kernel still starts", () => {
  it("ends the start, logged at info, never as a kernel that could not start", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      await daemon.client.notebook.close({ notebook: "a.jsnb" });
      await daemon.stop();
      const lines = (await readFile(ws.path(".jsnb/logs/daemon.log"), "utf8")).split("\n");
      expect(lines.filter((line) => line.includes("could not start"))).toEqual([]);
      const stopped = lines.find((line) => line.includes("stopped while it started"));
      expect(JSON.parse(stopped ?? "{}")).toMatchObject({ level: "info" });
    });
  });

  it("answers once the start ended, its end logged, when it comes before the kernel forked", async () => {
    await withDaemon(async (daemon, ws) => {
      const node = await gatedNode(ws.path("."));
      await daemon.client.settings.set({ key: "kernel.nodePath", value: node.path });
      await daemon.client.notebook.create({ path: "a.jsnb" }); // its kernel's start waits in the Node check
      const logAtAnswer = daemon.client.notebook
        .close({ notebook: "a.jsnb" })
        .then(() => readFile(ws.path(".jsnb/logs/daemon.log"), "utf8"));
      await node.open();
      expect(await logAtAnswer).toContain("a kernel was stopped while it started");
    });
  });
});

describe("kernel.restart while the kernel still starts", () => {
  it("launches the new kernel only once the old start ended, its end logged", async () => {
    await withDaemon(async (daemon, ws) => {
      const [calls, log] = [ws.path("calls"), ws.path(".jsnb/logs/daemon.log")];
      const seen = `grep -c 'a kernel was stopped while it started' '${log}' >> '${calls}'`;
      const node = await gatedNode(ws.path("."), { once: true, onCall: seen });
      await daemon.client.settings.set({ key: "kernel.nodePath", value: node.path });
      const book = await createNotebook(daemon); // its kernel's start waits in the Node check (the first run)
      const restarted = daemon.client.kernel.restart({ notebook: book.notebook });
      await node.open();
      await restarted;
      // Each run of the Node noted whether the old start's end was logged: the new kernel's check and fork come after.
      expect((await readFile(calls, "utf8")).trim().split("\n")).toEqual(["0", "1", "1"]);
    });
  });
});
