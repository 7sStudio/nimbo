// workspace.open with the built daemon: the daemon of the folder opened is started
// from the same entry as `nimbo open` forks it (or the live one there is used), the answer is its Home's address with a
// token that works there, the daemon the page leaves stops cleanly, and both folders are among the recent ones.
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";

import type { Workspace } from "@jsnb/test-tools/workspace";
import { beforeRemoval, withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { readServerJson, spawnBuiltDaemon } from "./fixtures/builtDaemon.js";
import { within } from "./fixtures/folders.js";
import { bodyOf, postRpc } from "./fixtures/raw.js";

const call = (method: string, params: Record<string, unknown> = {}) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

/** The result of `method` on the daemon at `port`. */
async function rpc(port: number, token: string, method: string, params?: Record<string, unknown>) {
  return bodyOf(await postRpc(port, token, call(method, params)));
}

/** A built daemon over `folder`, with its token. */
async function daemonOver(folder: Workspace) {
  const daemon = spawnBuiltDaemon(folder);
  const { port } = await daemon.listening;
  const { token } = await readServerJson(folder);
  return { ...daemon, port, token };
}

/** Stops the daemon a test did not start itself (the one workspace.open started) before its folder goes. */
function stopLater(folder: Workspace): void {
  beforeRemoval(folder.dir, async () => {
    if (!existsSync(folder.path(".jsnb/server.json"))) return;
    const { port, token } = await readServerJson(folder);
    await postRpc(port, token, call("workspace.stop")).catch(() => undefined);
  });
}

const addressOf = (url: string) => {
  const parsed = new URL(url);
  return {
    port: Number(parsed.port),
    token: parsed.searchParams.get("token") ?? "",
    path: parsed.pathname,
  };
};

describe("workspace.open", () => {
  it("starts the other folder's daemon, answers its Home with a working token, and stops this one", async () => {
    await withWorkspace(async (ws) => {
      const [a, b] = [await within(ws, "a"), await within(ws, "b")];
      stopLater(b);
      const daemon = await daemonOver(a);
      const answer = await rpc(daemon.port, daemon.token, "workspace.open", { path: b.dir });
      const root = await realpath(b.dir);
      expect(answer).toMatchObject({ result: { root } });
      const url = (answer as { result: { url: string } }).result.url;
      const other = addressOf(url);
      expect(other.path).toBe("/ui/");
      expect(other.port).not.toBe(daemon.port);
      expect(await rpc(other.port, other.token, "workspace.info")).toMatchObject({
        result: { root },
      });
      expect(await daemon.exited).toEqual({ code: 0, signal: null });
      expect(existsSync(a.path(".jsnb/server.json"))).toBe(false);
      expect((await readServerJson(b)).port).toBe(other.port);
      expect(existsSync(b.path(".jsnb/logs/stderr.log"))).toBe(true);
      const recent = JSON.parse(await readFile(a.path(".user-config/recent.json"), "utf8")) as {
        folders: { path: string }[];
      };
      expect(recent.folders.map((each) => each.path)).toEqual([root, await realpath(a.dir)]);
    });
  });

  it("uses the daemon already serving the other folder", async () => {
    await withWorkspace(async (ws) => {
      const [a, b] = [await within(ws, "a"), await within(ws, "b")];
      const there = await daemonOver(b);
      const daemon = await daemonOver(a);
      const answer = await rpc(daemon.port, daemon.token, "workspace.open", { path: b.dir });
      const url = (answer as { result: { url: string } }).result.url;
      expect(addressOf(url)).toMatchObject({ port: there.port, token: there.token });
      expect(await daemon.exited).toEqual({ code: 0, signal: null });
      there.child.kill("SIGTERM");
      expect(await there.exited).toEqual({ code: 0, signal: null });
    });
  });
});
