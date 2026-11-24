// `nimbo mcp` from the built bin (after `pnpm build`; cli:integration): dist/main.js of the cli runs
// the built MCP server, @jsnb/mcp/main, with its own stdio inherited, so an agent's pipes reach the server itself: it
// answers initialize and a tool call on a running daemon, and both processes end with 0 once the agent closes its
// input. The MCP server's own built tests are packages/mcp's main.built.integration.test.ts (mcp:integration).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it, onTestFinished } from "vitest";

const bin = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

const request = (id: number, method: string, params: object): string =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;

describe("nimbo mcp, built", () => {
  it("hands the agent's pipes to the MCP server, which answers on them, and exits 0 when they close", async () => {
    await withDaemon(async (_daemon, ws) => {
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        XDG_CONFIG_HOME: ws.path(".user-config"),
      };
      const child = spawn(process.execPath, [bin, "mcp"], { cwd: ws.dir, env, stdio: "pipe" });
      onTestFinished(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      });
      const exited = new Promise<number | null>((resolve) => {
        child.once("exit", resolve);
      });
      const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      const next = async (): Promise<unknown> => JSON.parse(String((await lines.next()).value));
      child.stdin.write(
        request(1, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-agent", version: "1.0.0" },
        }),
      );
      expect(await next()).toMatchObject({ id: 1, result: { serverInfo: { name: "nimbo" } } });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      child.stdin.write(request(2, "tools/call", { name: "workspace_info", arguments: {} }));
      expect(await next()).toMatchObject({
        id: 2,
        result: { structuredContent: { pid: process.pid } },
      });
      child.stdin.end();
      expect(await exited).toBe(0);
    });
  });
});
