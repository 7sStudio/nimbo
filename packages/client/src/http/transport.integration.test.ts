// The HTTP transport's answers against a JSON-RPC peer on a real port: the token and the
// declaration, results, the daemon's errors, 401 and answers that are not JSON-RPC.
import { CellNotFound, Unauthorized } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { InvalidResponse } from "../errors/transport.js";
import { httpWorld } from "../fixtures/httpWorld.js";
import { cell, workspace } from "../fixtures/values.js";
import type { RetryNotice } from "./options.js";
import { createHttpClient } from "./client.js";

const world = httpWorld();
const peer = world.peer;
const ref = { notebook: "demo.jsnb", cell: "c_a1b2c3" };

describe("createHttpClient", () => {
  it("posts one JSON-RPC call to /rpc with the token and the declaration, and parses the result", async () => {
    const daemon = await peer();
    daemon.on("workspace.info", () => ({ result: { ...workspace, extra: true } }));
    const client = createHttpClient({
      url: daemon.url,
      token: daemon.token,
      client: "mcp",
      agent: "claude-code",
    });
    await expect(client.workspace.info()).resolves.toEqual(workspace);
    expect(daemon.httpCalls).toHaveLength(1);
    expect(daemon.httpCalls[0]?.params).toEqual({});
    expect(daemon.httpCalls[0]?.headers).toMatchObject({
      authorization: `Bearer ${daemon.token}`,
      "x-jsnb-client": "mcp",
      "x-jsnb-agent": "claude-code",
      "content-type": "application/json",
    });
  });

  it("raises the ApiError of the daemon's JSON-RPC error", async () => {
    const daemon = await peer();
    daemon.on("cell.get", () => ({
      error: { code: 1002, message: "gone", data: { cell: "c_a1b2c3" } },
    }));
    const client = createHttpClient({ url: daemon.url, token: daemon.token, client: "cli" });
    const failure = client.cell.get(ref);
    await expect(failure).rejects.toBeInstanceOf(CellNotFound);
    await expect(failure).rejects.toMatchObject({ message: "gone", data: { cell: "c_a1b2c3" } });
  });
});

describe("createHttpClient on failed answers", () => {
  it("raises Unauthorized on 401 and does not retry", async () => {
    const daemon = await peer();
    const notices: RetryNotice[] = [];
    const client = createHttpClient({
      url: daemon.url,
      token: "wrong",
      client: "cli",
      onRetry: (notice) => notices.push(notice),
    });
    await expect(client.workspace.info()).rejects.toBeInstanceOf(Unauthorized);
    expect(notices).toEqual([]);
  });

  it("raises InvalidResponse for an answer that is not JSON-RPC, or not to this request", async () => {
    const daemon = await peer();
    daemon.on("workspace.info", () => ({ raw: "<h1>oops</h1>", status: 500 }));
    daemon.on("cell.get", () => ({
      raw: JSON.stringify({ jsonrpc: "2.0", id: 999, result: { cell } }),
    }));
    daemon.on("kernel.status", () => ({ result: { state: "sleepy" } }));
    const client = createHttpClient({ url: daemon.url, token: daemon.token, client: "cli" });
    await expect(client.workspace.info()).rejects.toBeInstanceOf(InvalidResponse);
    await expect(client.cell.get(ref)).rejects.toBeInstanceOf(InvalidResponse);
    await expect(client.kernel.status({ notebook: "demo.jsnb" })).rejects.toMatchObject({
      name: "InvalidResponse",
      data: { method: "kernel.status" },
    });
  });
});

describe("createHttpClient on errors without an id", () => {
  it("raises an error answered with a null id, as a daemon answers a request it could not parse", async () => {
    const daemon = await peer();
    daemon.on("cell.get", () => ({
      raw: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "bad json" },
      }),
    }));
    const client = createHttpClient({ url: daemon.url, token: daemon.token, client: "cli" });
    await expect(client.cell.get(ref)).rejects.toMatchObject({ name: "InvalidJson", code: -32700 });
  });
});
