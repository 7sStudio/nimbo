// The built process entry, dist/main.js, as an agent runs it (after `pnpm build`; mcp:integration):
// the SDK's own client over the child's real stdio pipes lists the tools and calls them on a running daemon, the
// edits carrying the client's name; a mutating tool with no daemon forks the server's built entry (@jsnb/server/main,
// no NIMBO_DAEMON_ENTRY); closing its input ends it with 0, and so does an agent that stops reading, quietly. This is
// what proves src/main.ts's wiring.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { withDaemon } from "@jsnb/test-daemon";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it, onTestFinished } from "vitest";

import { testEnv } from "./fixtures/mcp.js";
import { StdioTransport } from "./server/stdio.js";

/** One tool per public command the registry does not mark planned. */
// Every public command that is not planned, pinned as a number so a tool that silently goes missing fails here.
const toolCount = 103;

const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));

type Running = {
  readonly child: ChildProcess;
  readonly agent: Client;
  readonly exited: Promise<number | null>;
  readonly stderr: () => string;
};

/** `node dist/main.js` in the workspace with an environment of its own, an SDK client on its pipes. */
async function served(ws: Workspace, cwd = ws.dir): Promise<Running> {
  const child = spawn(process.execPath, [entry], {
    cwd,
    env: testEnv(ws.dir),
    stdio: "pipe",
  });
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", resolve);
  });
  const agent = new Client({ name: "claude-code", version: "1.0.0" });
  await agent.connect(new StdioTransport(child.stdout, child.stdin));
  return { child, agent, exited, stderr: () => stderr };
}

describe("dist/main.js", () => {
  it("serves the tools to an agent over stdio, and exits 0 once the agent closes its input", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const { child, agent, exited, stderr } = await served(ws);
      expect((await agent.listTools()).tools).toHaveLength(toolCount);
      const info = await agent.callTool({ name: "workspace_info", arguments: {} });
      expect(info.structuredContent).toMatchObject({ root: await realpath(ws.dir) });
      const add = await agent.callTool({
        name: "cell_add",
        arguments: { notebook: "a.jsnb", type: "server" },
      });
      expect(add.structuredContent).toMatchObject({
        cell: { meta: { lastEdit: { by: "agent", client: "mcp", agent: "claude-code" } } },
      });
      child.stdin?.end();
      expect(await exited).toBe(0);
      expect(stderr()).toBe("");
    });
  });
});

describe("dist/main.js", () => {
  it("starts the daemon from the server's built entry for a mutating tool, and workspace_stop stops it", async () => {
    await withWorkspace(async (ws) => {
      const { child, agent, exited } = await served(ws);
      const set = await agent.callTool({
        name: "settings_set",
        arguments: { key: "editor.fontSize", value: 15 },
      });
      expect(set.isError).toBeUndefined();
      expect(existsSync(ws.path(".jsnb/server.json"))).toBe(true);
      expect(
        (await agent.callTool({ name: "workspace_stop", arguments: {} })).isError,
      ).toBeUndefined();
      await expect
        .poll(() => existsSync(ws.path(".jsnb/server.json")), { timeout: 10_000, interval: 20 })
        .toBe(false);
      child.stdin?.end();
      expect(await exited).toBe(0);
    });
  });
});

describe("dist/main.js", () => {
  it("ends quietly with 0 when the agent stops reading its answers (EPIPE)", async () => {
    await withWorkspace(async (ws) => {
      const { child, exited, stderr } = await served(ws);
      child.stdout?.destroy();
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" })}\n`);
      expect(await exited).toBe(0);
      expect(stderr()).toBe("");
    });
  });
});

describe("dist/main.js", () => {
  it("answers WorkingFolderGone, and keeps serving, when its working folder was deleted under it", async () => {
    await withWorkspace(async (ws) => {
      await mkdir(ws.path("gone"));
      const { child, agent, exited } = await served(ws, ws.path("gone"));
      await rm(ws.path("gone"), { recursive: true });
      const info = await agent.callTool({ name: "workspace_info", arguments: {} });
      expect(info.isError).toBe(true);
      expect(info.content).toEqual([
        { type: "text", text: expect.stringContaining('"name":"WorkingFolderGone"') as unknown },
      ]);
      expect((await agent.listTools()).tools).toHaveLength(toolCount);
      child.stdin?.end();
      expect(await exited).toBe(0);
    });
  });
});

describe("dist/main.js", () => {
  it("answers what an agent piped in before closing its input (printf … | nimbo mcp), then exits 0", async () => {
    await withDaemon(async (_daemon, ws) => {
      const child = spawn(process.execPath, [entry], { cwd: ws.dir, env: testEnv(ws.dir) });
      onTestFinished(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      });
      const lines: unknown[] = [];
      createInterface({ input: child.stdout }).on("line", (line) => lines.push(JSON.parse(line)));
      const exited = new Promise<number | null>((resolve) => {
        child.once("exit", resolve);
      });
      const request = (id: number, method: string, params: object) =>
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
      child.stdin.end(
        request(1, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "printf", version: "1" },
        }) + request(2, "tools/call", { name: "workspace_info", arguments: {} }),
      );
      expect(await exited).toBe(0);
      expect(lines).toMatchObject([
        { id: 1 },
        { id: 2, result: { structuredContent: { pid: process.pid } } },
      ]);
    });
  });
});

describe("dist/main.js", () => {
  it("sends a result under the 128 KiB cap whole and refuses one past it, the session going on", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: "big.jsnb" });
      const { child, agent, exited } = await served(ws);
      const html = (kibibytes: number) =>
        `display.html("<p>" + "x".repeat(${String(kibibytes)} * 1024) + "</p>")`;
      const add = (source: string) => ({ notebook: "big.jsnb", type: "server", source, run: true });
      const whole = await agent.callTool({ name: "cell_add", arguments: add(html(40)) });
      expect(whole.structuredContent).toMatchObject({ execution: { status: "ok" } });
      const refused = await agent.callTool({ name: "cell_add", arguments: add(html(200)) });
      expect(refused.isError).toBe(true);
      expect(refused.content).toEqual([
        { type: "text", text: expect.stringContaining('"name":"ResultTooLarge"') as unknown },
      ]);
      expect((await agent.listTools()).tools).toHaveLength(toolCount);
      child.stdin?.end();
      expect(await exited).toBe(0);
    });
  });
});
