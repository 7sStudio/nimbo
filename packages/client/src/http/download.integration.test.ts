// The full-value download of 03-api §7.5 against the peer: the token and the declaration, a streamed body, failures.
import { Unauthorized } from "@jsnb/core";
import { afterEach, describe, expect, it } from "vitest";

import { CallAborted, InvalidResponse } from "../errors/transport.js";
import type { Peer } from "../fixtures/peer.js";
import { startPeer } from "../fixtures/peer.js";
import { downloadValue } from "./download.js";

const peers: Peer[] = [];
afterEach(async () => {
  await Promise.all(peers.splice(0).map((p) => p.close()));
});
const peer = async (): Promise<Peer> => {
  const started = await startPeer();
  peers.push(started);
  return started;
};

const ref = { execution: "x_a1b2c3d4", index: 0 };
const path = "/outputs/x_a1b2c3d4/0.json";

describe("downloadValue", () => {
  it("streams the whole value with the token and the declaration", async () => {
    const daemon = await peer();
    const headers: Record<string, unknown>[] = [];
    daemon.route(path, (response) => {
      headers.push(response.req.headers);
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"rows":[1,');
      response.end("2,3]}");
    });
    const options = { url: daemon.url, token: daemon.token, client: "ui" as const };
    const response = await downloadValue(options, ref);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rows: [1, 2, 3] });
    expect(headers).toMatchObject([
      { authorization: `Bearer ${daemon.token}`, "x-jsnb-client": "ui" },
    ]);
  });

  it("raises Unauthorized for a wrong token", async () => {
    const daemon = await peer();
    const options = { url: daemon.url, token: "wrong", client: "cli" as const };
    await expect(downloadValue(options, ref)).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe("downloadValue failures", () => {
  it("raises the ApiError of a JSON-RPC error body, else InvalidResponse with the status", async () => {
    const daemon = await peer();
    daemon.route(path, (response) => {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: 1002, message: "m", data: { cell: "c_a1b2c3" } },
        }),
      );
    });
    daemon.route("/outputs/x_a1b2c3d4/1.json", (response) => {
      response.writeHead(410).end("gone");
    });
    const options = { url: daemon.url, token: daemon.token, client: "cli" as const };
    await expect(downloadValue(options, ref)).rejects.toMatchObject({
      name: "CellNotFound",
      code: 1002,
    });
    const missing = downloadValue(options, { ...ref, index: 1 });
    await expect(missing).rejects.toBeInstanceOf(InvalidResponse);
    await expect(missing).rejects.toMatchObject({
      data: { method: "GET /outputs/x_a1b2c3d4/1.json", issues: [{ message: "HTTP status 410" }] },
    });
  });

  it("stops with CallAborted when the signal aborts", async () => {
    const daemon = await peer();
    const options = { url: daemon.url, token: daemon.token, client: "cli" as const };
    await expect(
      downloadValue(options, ref, { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(CallAborted);
  });
});

describe("downloadValue on a dropped connection", () => {
  it("tries again, since a GET is safe to repeat, and streams the value", async () => {
    const daemon = await peer();
    let requests = 0;
    daemon.route(path, (response) => {
      requests += 1;
      if (requests === 1) {
        response.socket?.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"rows":[1]}');
    });
    const options = { url: daemon.url, token: daemon.token, client: "cli" as const };
    const response = await downloadValue({ ...options, retry: { baseMs: 1, maxMs: 1 } }, ref);
    await expect(response.json()).resolves.toEqual({ rows: [1] });
    expect(requests).toBe(2);
  });
});
