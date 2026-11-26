// The daemon's surfaces that touch user code and files: notebook refs never leave the workspace; no
// install happens but packages.add (an uninstalled import ends with MissingPackage, nothing written); only current
// exports are callable; a second page is refused REALM_ATTACHED. The routes (/n/) are in notebook/routes/suite/.
import { existsSync } from "node:fs";

import { bridgeCall, packagesAdd, realmAttach } from "@jsnb/core";
import { withDaemon } from "../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../fixtures/notebook.js";
import { opened, rawSocket } from "../fixtures/raw.js";

describe("a notebook ref", () => {
  it("that leaves the workspace or is not a .jsnb path is refused with INVALID_PARAMS", async () => {
    await withDaemon(async (daemon) => {
      for (const path of [
        "../x.jsnb",
        "/etc/x.jsnb",
        "a\\b.jsnb",
        "a/./b.jsnb",
        "a//b.jsnb",
        "x.txt",
        "",
      ]) {
        await expect(daemon.client.notebook.create({ path })).rejects.toMatchObject({
          code: -32602,
        });
        await expect(daemon.client.notebook.open({ path })).rejects.toMatchObject({ code: -32602 });
      }
    });
  });
});

describe("packages", () => {
  it("are never installed silently: an uninstalled import ends with MissingPackage and nothing is written", async () => {
    await withDaemon(async (daemon, ws) => {
      const book = await createNotebook(daemon);
      const { execution } = await book.ran('import { z } from "zod"\nz');
      expect(execution.error).toMatchObject({ name: "MissingPackage", data: { names: ["zod"] } });
      expect([existsSync(ws.path("node_modules")), existsSync(ws.path("package.json"))]).toEqual([
        false,
        false,
      ]);
      expect(packagesAdd.tags.mutating).toBe(true);
    });
  });
});

describe("bridge.call", () => {
  it("calls only a current export: a defined name that is not exported fails BRIDGE_CALL_FAILED", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      await book.ran("const internal = () => 1\nexport const open = () => 2");
      const call = (fn: string) =>
        daemon.client.call(bridgeCall, { notebook: book.notebook, fn, args: [] });
      expect(await call("open")).toEqual({ result: 2 });
      await expect(call("internal")).rejects.toMatchObject({
        code: 2001,
        data: { error: { name: "NotExported" } },
      });
      await expect(call("process")).rejects.toMatchObject({ code: 2001 });
    });
  });
});

describe("realm.attach", () => {
  it("lets one page run the notebook's client cells: a second one is refused REALM_ATTACHED", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const query = `?token=${daemon.token}&client=ui`;
      const pages = [];
      const answers = [];
      for (const id of [1, 2]) {
        const page = rawSocket(daemon.server.port, query); // opened before the next one exists, so its open is seen
        await opened(page.ws);
        const params = { notebook: book.notebook, kind: "tab" };
        page.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: realmAttach.name, params }));
        answers.push(await page.next());
        pages.push(page);
      }
      expect(answers[0]).toMatchObject({ result: { realmId: expect.any(String) as unknown } });
      expect(answers[1]).toMatchObject({ error: { code: 1011 } });
      for (const page of pages) page.ws.close();
    });
  });
});
