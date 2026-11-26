// The HTTP retry rules against a JSON-RPC peer on a real port: refused connections retried for any
// command, dropped ones only for a repeatable call, the last attempt DaemonUnreachable, and aborts.
import { describe, expect, it } from "vitest";

import { CallAborted, ConnectionDropped, DaemonUnreachable } from "../errors/transport.js";
import { httpWorld } from "../fixtures/httpWorld.js";
import type { Peer } from "../fixtures/peer.js";
import { closedPort } from "../fixtures/ports.js";
import { cell, queued } from "../fixtures/values.js";
import { createHttpClient } from "./client.js";
import type { RetryNotice } from "./options.js";

const world = httpWorld();
const peer = world.peer;
const ref = { notebook: "demo.jsnb", cell: "c_a1b2c3" };
const fast = { baseMs: 1, maxMs: 2 };

describe("createHttpClient retries", () => {
  it("retries a refused connection, then raises DaemonUnreachable after the last attempt", async () => {
    const port = await closedPort();
    const notices: RetryNotice[] = [];
    const url = `http://127.0.0.1:${String(port)}`;
    const client = createHttpClient({
      url,
      token: "t",
      client: "cli",
      retry: { ...fast, attempts: 3 },
      onRetry: (notice) => notices.push(notice),
    });
    const failure = client.workspace.info();
    await expect(failure).rejects.toBeInstanceOf(DaemonUnreachable);
    await expect(failure).rejects.toMatchObject({ data: { url, attempts: 3 } });
    expect(notices.map((notice) => [notice.method, notice.attempt, notice.delayMs])).toEqual([
      ["workspace.info", 1, 1],
      ["workspace.info", 2, 2],
    ]);
  });

  it("retries a refused connection until the daemon is up, even for a mutating command", async () => {
    const port = await closedPort();
    let starting: Promise<Peer> | undefined;
    const client = createHttpClient({
      url: `http://127.0.0.1:${String(port)}`,
      token: "secret",
      client: "cli",
      retry: { ...fast, attempts: 100 },
      onRetry: () => {
        starting ??= peer(port).then((daemon) => {
          daemon.on("cell.run", () => ({ result: { execution: queued } }));
          return daemon;
        });
      },
    });
    await expect(client.cell.run(ref)).resolves.toEqual({ execution: queued });
    const daemon = await starting;
    expect(daemon?.httpCalls.map((call) => call.method)).toEqual(["cell.run"]);
  });
});

describe("createHttpClient on dropped connections and aborts", () => {
  it("repeats a read whose connection dropped, but not a mutating command", async () => {
    const daemon = await peer();
    let gets = 0;
    daemon.on("cell.get", () => (++gets === 1 ? { destroy: true } : { result: { cell } }));
    daemon.on("cell.run", () => ({ destroy: true }));
    const client = createHttpClient({
      url: daemon.url,
      token: daemon.token,
      client: "cli",
      retry: fast,
    });
    await expect(client.cell.get(ref)).resolves.toEqual({ cell });
    expect(gets).toBe(2);
    await expect(client.cell.run(ref)).rejects.toBeInstanceOf(ConnectionDropped);
    expect(daemon.httpCalls.filter((call) => call.method === "cell.run")).toHaveLength(1);
  });

  it("stops with CallAborted when the signal aborts, before sending or during a backoff wait", async () => {
    const daemon = await peer();
    const client = createHttpClient({ url: daemon.url, token: daemon.token, client: "cli" });
    const aborted = client.workspace.info({}, { signal: AbortSignal.abort() });
    await expect(aborted).rejects.toBeInstanceOf(CallAborted);
    const controller = new AbortController();
    const waiting = createHttpClient({
      url: `http://127.0.0.1:${String(await closedPort())}`,
      token: "t",
      client: "cli",
      retry: { baseMs: 60_000, maxMs: 60_000 },
      onRetry: () => {
        controller.abort();
      },
    });
    const stopped = waiting.workspace.info({}, { signal: controller.signal });
    await expect(stopped).rejects.toMatchObject({
      name: "CallAborted",
      data: { method: "workspace.info" },
    });
  });
});

describe("createHttpClient with an onRetry that throws", () => {
  it("fails the call with what onRetry threw", async () => {
    const bug = new Error("progress printer bug");
    const client = createHttpClient({
      url: `http://127.0.0.1:${String(await closedPort())}`,
      token: "t",
      client: "cli",
      retry: fast,
      onRetry: () => {
        throw bug;
      },
    });
    await expect(client.workspace.info()).rejects.toBe(bug);
  });
});
