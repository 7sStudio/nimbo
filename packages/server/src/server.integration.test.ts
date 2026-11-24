// startServer's life (02-architecture §7, 03-api §7.1, 07-file-format §7, §9): .jsnb/ prepared, server.json written
// 0600 once listening and removed on stop, a stale file replaced, a live daemon refused, crash leftovers removed; a
// port in use fails the start with nothing left behind, and of two daemons started at once one serves; a stop step that
// fails is logged and the stop goes on.
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";

import { ServerFile } from "@jsnb/core";
import { withDaemon } from "./fixtures/daemon.js";
import { kernelEntry } from "@jsnb/test-tools/kernel";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { DaemonRunning, startServer } from "./index.js";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const options = (ws: Workspace) => ({
  workspace: ws.dir,
  userConfigDir: ws.path(".user"),
  kernelEntry,
});

const start = (ws: Workspace) => startServer(options(ws));

const readServerJson = async (ws: Workspace) =>
  ServerFile.parse(JSON.parse(await readFile(ws.path(".jsnb/server.json"), "utf8")));

describe("startServer's files", () => {
  it("prepares .jsnb with its .gitignore, logs/, cache/npm/ and cache/sql/", async () => {
    await withWorkspace(async (ws) => {
      const server = await start(ws);
      expect(await readFile(ws.path(".jsnb/.gitignore"), "utf8")).toBe(
        "*\n!.gitignore\n!settings.json\n!keybindings.json\n",
      );
      for (const folder of ["logs", "cache/npm", "cache/sql"])
        expect(await exists(ws.path(".jsnb", folder))).toBe(true);
      await server.stop();
    });
  });

  it("writes server.json 0600 once listening and removes it on stop", async () => {
    await withWorkspace(async (ws) => {
      const server = await start(ws);
      const file = await readServerJson(ws);
      expect(file).toMatchObject({ pid: process.pid, port: server.port, token: server.token });
      expect(file.startedAt).toBe(server.startedAt);
      expect((await stat(ws.path(".jsnb/server.json"))).mode & 0o777).toBe(0o600);
      expect(server.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await server.stop();
      await server.closed;
      expect(await exists(ws.path(".jsnb/server.json"))).toBe(false);
    });
  });
});

describe("startServer beside another daemon", () => {
  it("replaces a stale server.json and removes leftover temp files of a crashed save", async () => {
    await withWorkspace(async (ws) => {
      await (await start(ws)).stop();
      const stale = {
        pid: 2_147_483_000,
        port: 9,
        token: "old",
        startedAt: "2026-01-01",
        version: "0",
        root: ws.dir,
      };
      await writeFile(ws.path(".jsnb/server.json"), JSON.stringify(stale));
      await writeFile(ws.path("a.jsnb.tmp-123"), "half");
      const server = await start(ws);
      expect(await exists(ws.path("a.jsnb.tmp-123"))).toBe(false);
      expect(await readServerJson(ws)).toMatchObject({ port: server.port });
      await server.stop();
    });
  });
});

describe("startServer and another workspace's server.json", () => {
  it("starts its own daemon in a copied workspace, replacing the original's live server.json", async () => {
    await withDaemon(async (daemon, ws) => {
      await withWorkspace(async (copy) => {
        // cp -R of a running workspace: the copy carries the original's live server.json.
        await mkdir(copy.path(".jsnb"), { recursive: true });
        await copyFile(ws.path(".jsnb/server.json"), copy.path(".jsnb/server.json"));
        const server = await start(copy);
        expect(server.port).not.toBe(daemon.server.port);
        expect(await readServerJson(copy)).toMatchObject({
          port: server.port,
          root: server.workspace,
        });
        expect(await readServerJson(ws)).toMatchObject({ port: daemon.server.port });
        await server.stop();
      });
    });
  });

  it("refuses to start beside a live daemon of the same workspace", async () => {
    await withDaemon(async (daemon, ws) => {
      const second = start(ws);
      await expect(second).rejects.toBeInstanceOf(DaemonRunning);
      await expect(second).rejects.toMatchObject({
        data: { pid: process.pid, port: daemon.server.port },
      });
    });
  });
});

describe("startServer's failures", () => {
  it("fails on a port in use, leaving no server.json behind, and starts once the port is free", async () => {
    await withWorkspace(async (ws) => {
      const blocker = createServer();
      await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
      const port = Number(Reflect.get(Object(blocker.address()), "port"));
      const busy = startServer({ ...options(ws), port });
      await expect(busy).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(await exists(ws.path(".jsnb/server.json"))).toBe(false);
      await new Promise((resolve) => blocker.close(resolve));
      const server = await startServer({ ...options(ws), port });
      expect(server.port).toBe(port);
      await server.stop();
    });
  });

  it("lets one of two daemons started at once serve the workspace; the other fails DaemonRunning", async () => {
    await withWorkspace(async (ws) => {
      const [first, second] = await Promise.allSettled([start(ws), start(ws)]);
      const served = [first, second].flatMap((each) =>
        each.status === "fulfilled" ? [each.value] : [],
      );
      const refused = [first, second].flatMap((each): unknown[] =>
        each.status === "rejected" ? [each.reason] : [],
      );
      expect(served).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toBeInstanceOf(DaemonRunning);
      expect(await readServerJson(ws)).toMatchObject({ port: served[0]?.port });
      await served[0]?.stop();
    });
  });
});

describe("a stop step that fails", () => {
  it("is logged, and the other steps run: server.json replaced by a folder", async () => {
    await withWorkspace(async (ws) => {
      const server = await start(ws);
      await rm(ws.path(".jsnb/server.json"));
      await mkdir(ws.path(".jsnb/server.json"));
      await server.stop();
      await server.closed;
      const log = await readFile(ws.path(".jsnb/logs/daemon.log"), "utf8");
      expect(log).toContain("the daemon could not remove server.json while stopping");
      expect(log).toContain("the daemon stopped");
    });
  });
});

describe("workspace.info", () => {
  it("answers over HTTP and over the socket alike", async () => {
    await withDaemon(async (daemon) => {
      const info = await daemon.http().workspace.info();
      expect(info).toMatchObject({
        apiVersion: 1,
        nodeVersion: process.versions.node,
        pid: process.pid,
        startedAt: daemon.server.startedAt,
      });
      expect(info.root).toBe(daemon.server.workspace);
      expect(await daemon.client.workspace.info()).toEqual(info);
    });
  });
});

describe("workspace.info's nodeVersion", () => {
  it("is the daemon's Node, then the version kernel.nodePath's binary answers, and unknown when it cannot", async () => {
    await withDaemon(async (daemon, ws) => {
      const { client } = daemon;
      expect((await client.workspace.info()).nodeVersion).toBe(process.versions.node);
      const other = ws.path("node27");
      await writeFile(other, "#!/bin/sh\necho 27.1.0\n");
      await chmod(other, 0o755);
      await client.settings.set({ key: "kernel.nodePath", value: other });
      expect((await client.workspace.info()).nodeVersion).toBe("27.1.0");
      // upgraded in place at the same path: asked again
      await writeFile(other, "#!/bin/sh\necho 27.2.0\n");
      expect((await client.workspace.info()).nodeVersion).toBe("27.2.0");
      await client.settings.set({ key: "kernel.nodePath", value: "/usr/bin/false" });
      expect((await client.workspace.info()).nodeVersion).toBe("unknown");
      await client.settings.set({ key: "kernel.nodePath", value: null });
      expect((await client.workspace.info()).nodeVersion).toBe(process.versions.node);
    });
  });
});
