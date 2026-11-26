// JSON-RPC 2.0 over HTTP and the WebSocket: the protocol codes, the bearer token and the 4401 close,
// concurrent calls answered by id, events.subscribe refused over HTTP, and notifications carried out unanswered.
import { readFile } from "node:fs/promises";

import { withDaemon } from "../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { bodyOf, opened, postRpc, rawHttp, rawSocket } from "../fixtures/raw.js";

const call = (method: string, params: unknown = {}, id: number | string = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params });

describe("POST /rpc", () => {
  it("answers 401 with UNAUTHORIZED without the token or with a wrong one", async () => {
    await withDaemon(async ({ server }) => {
      for (const authorization of [undefined, "Bearer nope", `Basic ${server.token}`]) {
        const answer = await rawHttp(server.port, {
          method: "POST",
          path: "/rpc",
          headers: authorization ? { authorization } : {},
          body: call("workspace.info"),
        });
        expect(answer.status).toBe(401);
        expect(bodyOf(answer)).toMatchObject({ id: null, error: { code: 1006 } });
      }
    });
  });
});

describe("POST /rpc's protocol errors", () => {
  it("answers the protocol errors -32700, -32600 and -32601 with status 200", async () => {
    await withDaemon(async ({ server }) => {
      const answer = async (body: string) => bodyOf(await postRpc(server.port, server.token, body));
      expect(await answer("{oops")).toMatchObject({ id: null, error: { code: -32700 } });
      expect(await answer("[1]")).toMatchObject({ id: null, error: { code: -32600 } });
      expect(await answer('{"jsonrpc":"2.0","id":3}')).toMatchObject({
        id: 3,
        error: { code: -32600 },
      });
      expect(await answer(call("no.such", {}, 4))).toMatchObject({
        id: 4,
        error: { code: -32601 },
      });
      expect(await answer('{"jsonrpc":"2.0","id":5,"result":1}')).toMatchObject({
        error: { code: -32600 },
      });
    });
  });
});

describe("POST /rpc's refusals", () => {
  it("answers INVALID_PARAMS with the Zod issues, and 405 to anything but POST", async () => {
    await withDaemon(async ({ server }) => {
      const answer = await postRpc(
        server.port,
        server.token,
        call("secrets.set", { name: "bad name" }),
      );
      const body = bodyOf(answer) as {
        error: { code: number; data: { issues: { path: unknown[] }[] } };
      };
      expect(body.error.code).toBe(-32602);
      expect(body.error.data.issues.map((issue) => issue.path)).toContainEqual(["name"]);
      const get = await rawHttp(server.port, {
        path: "/rpc",
        headers: { authorization: `Bearer ${server.token}` },
      });
      expect(get.status).toBe(405);
      expect(get.headers.allow).toBe("POST");
    });
  });

  it("refuses events.subscribe, which needs a socket, with -32601", async () => {
    await withDaemon(async ({ server }) => {
      const answer = await postRpc(server.port, server.token, call("events.subscribe"));
      expect(bodyOf(answer)).toMatchObject({
        error: { code: -32601, message: /WebSocket/ },
      });
    });
  });
});

describe("the WebSocket", () => {
  it("accepts the upgrade and closes with 4401 without the token or with a wrong one", async () => {
    await withDaemon(async ({ server }) => {
      expect(await rawSocket(server.port, "").closed).toBe(4401);
      expect(await rawSocket(server.port, "?token=nope").closed).toBe(4401);
    });
  });

  it("answers concurrent calls by id, a binary frame with -32700, an unknown method with -32601", async () => {
    await withDaemon(async ({ server }) => {
      const socket = rawSocket(server.port, `?token=${server.token}`);
      await opened(socket.ws);
      socket.ws.send(call("workspace.info", {}, "a"));
      socket.ws.send(call("settings.get", { key: "ui.theme" }, "b"));
      const answers = [await socket.next(), await socket.next()];
      expect(answers.map((frame) => (frame as { id: string }).id).sort()).toEqual(["a", "b"]);
      socket.ws.send(Buffer.from([1, 2]), { binary: true });
      expect(await socket.next()).toMatchObject({ id: null, error: { code: -32700 } });
      socket.ws.send(call("no.such", {}, 9));
      expect(await socket.next()).toMatchObject({ id: 9, error: { code: -32601 } });
      socket.ws.close();
    });
  });
});

const notify = (method: string, params: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", method, params });

describe("a JSON-RPC notification (no id)", () => {
  it("is carried out and never answered: 204 over HTTP, no frame on the socket, a failure logged", async () => {
    await withDaemon(async (daemon, ws) => {
      const { port, token } = daemon.server;
      const set = (value: number) => notify("settings.set", { key: "query.timeoutMs", value });
      const changed = (value: number) =>
        daemon.events.until("settings.changed", (e) =>
          JSON.stringify(e.data).includes(String(value)),
        );
      const posted = await postRpc(port, token, set(4100));
      expect([posted.status, posted.body]).toEqual([204, ""]);
      await changed(4100);
      expect((await postRpc(port, token, notify("no.such", {}))).status).toBe(204);
      const socket = rawSocket(port, `?token=${token}`);
      await opened(socket.ws);
      socket.ws.send(set(4200));
      socket.ws.send(notify("no.such", {}));
      await changed(4200);
      socket.ws.send(call("workspace.info", {}, "after"));
      expect(await socket.next()).toMatchObject({ id: "after", result: { pid: process.pid } });
      socket.ws.close();
      const log = await readFile(ws.path(".jsnb/logs/daemon.log"), "utf8");
      expect(log.match(/a notification failed/g)).toHaveLength(2);
    });
  });
});
