// The built process entry, dist/main.js, as `nimbo open` and `nimbo serve` fork it (02-architecture §7, 07-file-format
// §7): one listening line on stdout, server.json (0600) while it runs and gone after, the clean stop on SIGTERM, SIGINT,
// SIGHUP and workspace.stop with exit code 0; 2 for arguments it cannot use, 1 with a JSON line on stderr when the start
// fails; a stale server.json replaced, a live daemon's refused with DaemonRunning.
import { existsSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { readServerJson, spawnBuiltDaemon } from "./fixtures/builtDaemon.js";
import { bodyOf, postRpc } from "./fixtures/raw.js";

const info = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "workspace.info", params: {} });

describe("dist/main.js", () => {
  it("prints its listening line, keeps server.json 0600 while it runs, and stops cleanly on SIGTERM", async () => {
    await withWorkspace(async (ws) => {
      const daemon = spawnBuiltDaemon(ws);
      const listening = await daemon.listening;
      const server = await readServerJson(ws);
      expect(server).toMatchObject({ pid: daemon.child.pid, port: listening.port });
      expect((await stat(ws.path(".jsnb/server.json"))).mode & 0o777).toBe(0o600);
      const answer = await postRpc(listening.port, server.token, info);
      expect(bodyOf(answer)).toMatchObject({
        result: { startedAt: server.startedAt, pid: server.pid },
      });
      daemon.child.kill("SIGTERM");
      expect(await daemon.exited).toEqual({ code: 0, signal: null });
      expect(existsSync(ws.path(".jsnb/server.json"))).toBe(false);
    });
  });
});

describe("dist/main.js and its parent", () => {
  it("outlives a parent that closed the pipe before reading the listening line", async () => {
    await withWorkspace(async (ws) => {
      const daemon = spawnBuiltDaemon(ws);
      daemon.child.stdout?.destroy(); // the CLI died right after forking: the listening line meets a dead pipe (EPIPE)
      await expect
        .poll(() => existsSync(ws.path(".jsnb/server.json")), { timeout: 10_000 })
        .toBe(true);
      const server = await readServerJson(ws);
      const answer = await postRpc(server.port, server.token, info);
      expect(bodyOf(answer)).toMatchObject({ result: { pid: daemon.child.pid } });
      expect(daemon.child.exitCode).toBeNull();
      daemon.child.kill("SIGTERM");
      expect(await daemon.exited).toEqual({ code: 0, signal: null });
    });
  });

  it("stops cleanly on SIGINT, SIGHUP and workspace.stop, each with exit code 0", async () => {
    await withWorkspace(async (ws) => {
      for (const stop of ["SIGINT", "SIGHUP", "workspace.stop"] as const) {
        const daemon = spawnBuiltDaemon(ws);
        const { port } = await daemon.listening;
        if (stop === "workspace.stop") {
          const { token } = await readServerJson(ws);
          await postRpc(
            port,
            token,
            JSON.stringify({ jsonrpc: "2.0", id: 1, method: stop, params: {} }),
          );
        } else daemon.child.kill(stop);
        expect(await daemon.exited).toEqual({ code: 0, signal: null });
        expect(existsSync(ws.path(".jsnb/server.json"))).toBe(false);
      }
    });
  });
});

describe("dist/main.js's failures", () => {
  it("exits 2 for arguments it cannot use and 1 with a JSON line when the workspace is missing", async () => {
    await withWorkspace(async (ws) => {
      const bad = spawnBuiltDaemon(ws, ["--port", "nope"]);
      expect((await bad.exited).code).toBe(2);
      expect(JSON.parse(bad.stderr())).toMatchObject({ name: "InvalidArguments" });
      const missing = spawnBuiltDaemon(ws, ["--workspace", ws.path("missing")]);
      expect((await missing.exited).code).toBe(1);
      expect(JSON.parse(missing.stderr())).toMatchObject({ name: "WorkspaceMissing" });
    });
  });

  it("replaces a stale server.json, and refuses to start beside a live daemon with DaemonRunning", async () => {
    await withWorkspace(async (ws) => {
      const stale = {
        pid: 999_999,
        port: 1,
        token: "stale",
        startedAt: "2026-01-01T00:00:00.000Z",
        version: "0.0.0",
        root: ws.dir,
      };
      const first = spawnBuiltDaemon(ws);
      await first.listening;
      const second = spawnBuiltDaemon(ws);
      expect((await second.exited).code).toBe(1);
      expect(JSON.parse(second.stderr())).toMatchObject({ name: "DaemonRunning" });
      first.child.kill("SIGKILL");
      await first.exited;
      await writeFile(ws.path(".jsnb/server.json"), JSON.stringify(stale), { mode: 0o600 });
      const third = spawnBuiltDaemon(ws);
      const listening = await third.listening;
      expect((await readServerJson(ws)).port).toBe(listening.port);
      third.child.kill("SIGTERM");
      expect((await third.exited).code).toBe(0);
    });
  });
});
