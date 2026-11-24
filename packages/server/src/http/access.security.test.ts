// The daemon's doors (09-testing §5; 02-architecture §7, §8; 03-api §7.1): every endpoint refuses a call without the
// token (HTTP 401, the WebSocket closed 4401 after its upgrade); the page cookie (nimbo-<port>, a page key that is never
// the token nor in server.json) lets in /ui/ and /npm/ only, never /rpc, /outputs/ or /schema/, and only as a browser
// sends it from the daemon's own page (Sec-Fetch-Site same-origin or none): without that header, from
// another site, with a wrong key or under another port's name it is a 401 with no body; a foreign Host or Origin is
// refused before anything else, no answer carries a CORS header, a WebSocket upgrades at /rpc only, and only 127.0.0.1
// listens.
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { connect } from "node:net";

import { withDaemon } from "../fixtures/daemon.js";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { pageCookie, rawHttp, rawSocket } from "../fixtures/raw.js";

const rpc = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "workspace.info", params: {} });

/** The status of one request with exactly `headers`. */
const status = async (
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
) =>
  (await rawHttp(port, { method, path, headers, ...(method === "POST" ? { body: rpc } : {}) }))
    .status;

describe("the token", () => {
  it("is asked of every endpoint but /n/", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      expect(await status(port, "POST", "/rpc")).toBe(401);
      expect(await status(port, "POST", "/rpc", { authorization: `Bearer ${token}x` })).toBe(401);
      for (const path of [
        "/ui/a.jsnb",
        "/npm/zod",
        "/outputs/x_00000000/0.json",
        "/schema/settings.json",
      ]) {
        expect([path, await status(port, "GET", path)]).toEqual([path, 401]);
      }
      expect(await status(port, "GET", "/n/nothing/here")).toBe(404);
    });
  });

  it("closes a WebSocket that came without it, with a wrong one or with the cookie only, with 4401", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      const closed = async (query: string, headers: Record<string, string> = {}) =>
        rawSocket(port, query, headers).closed;
      expect(await closed("")).toBe(4401);
      expect(await closed(`?token=${token}x`)).toBe(4401);
      expect(await closed("", { cookie: `jsnb_token=${token}` })).toBe(4401);
    });
  });
});

/** A POST /rpc with the token and `headers`. */
const post = (port: number, token: string, headers: Record<string, string>) =>
  rawHttp(port, {
    method: "POST",
    path: "/rpc",
    headers: { authorization: `Bearer ${token}`, ...headers },
    body: rpc,
  });

describe("the page cookie", () => {
  it("is named after the port, never holds the token, and lets in /ui/ and /npm/ only", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      const pair = await pageCookie(port, token);
      const [name = "", key = ""] = pair.split("=");
      expect(name).toBe(`nimbo-${String(port)}`);
      expect(key).not.toBe(token);
      expect(await readFile(daemon.server.workspace + "/.jsnb/server.json", "utf8")).not.toContain(
        key,
      );
      const cookie = { cookie: pair, "sec-fetch-site": "same-origin" };
      expect(await status(port, "GET", "/ui/a.jsnb", cookie)).not.toBe(401);
      expect(await status(port, "GET", "/npm/zod", cookie)).not.toBe(401);
      expect(await status(port, "POST", "/rpc", cookie)).toBe(401);
      expect(await status(port, "POST", "/rpc", { authorization: `Bearer ${key}` })).toBe(401);
      for (const path of ["/outputs/x_00000000/0.json", "/schema/settings.json"]) {
        expect([path, await status(port, "GET", path, cookie)]).toEqual([path, 401]);
        expect([path, await status(port, "GET", path, { authorization: `Bearer ${key}` })]).toEqual(
          [path, 401],
        );
      }
    });
  });
});

describe("the page cookie refused", () => {
  it("with a wrong key, or under another port's name, gets a 401 with no body on /ui/ and /npm/", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      const [, key = ""] = (await pageCookie(port, token)).split("=");
      for (const cookie of [`nimbo-${String(port)}=${key}x`, `nimbo-${String(port + 1)}=${key}`]) {
        for (const path of ["/ui/a.jsnb", "/npm/zod"]) {
          const headers = { cookie, "sec-fetch-site": "same-origin" };
          const answer = await rawHttp(port, { path, headers });
          expect([path, answer.status, answer.body]).toEqual([path, 401, ""]);
        }
      }
    });
  });

  it("lets in a browser on the daemon's own page only: no Sec-Fetch-Site, same-site or cross-site is a bare 401", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      const cookie = await pageCookie(port, token);
      const site = (value?: string) => (value === undefined ? {} : { "sec-fetch-site": value });
      for (const path of ["/ui/a.jsnb", "/npm/zod"]) {
        for (const value of [undefined, "same-site", "cross-site", "other"]) {
          const answer = await rawHttp(port, { path, headers: { cookie, ...site(value) } });
          expect([path, value, answer.status, answer.body]).toEqual([path, value, 401, ""]);
        }
        for (const value of ["same-origin", "none"]) {
          const answer = await rawHttp(port, { path, headers: { cookie, ...site(value) } });
          expect([path, value, answer.status]).not.toEqual([path, value, 401]);
        }
      }
    });
  });
});

describe("a foreign Host or Origin", () => {
  it("is refused 403 on HTTP, and no answer carries a CORS header", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      const answers = [
        await post(port, token, { host: "evil.example:80" }),
        await post(port, token, { origin: "http://evil.example" }),
        await rawHttp(port, {
          method: "OPTIONS",
          path: "/rpc",
          headers: { origin: `http://127.0.0.1:${String(port)}` },
        }),
        await post(port, token, { origin: `http://localhost:${String(port)}` }),
        await rawHttp(port, { path: "/nowhere" }),
      ];
      expect(answers.map((answer) => answer.status)).toEqual([403, 403, 405, 200, 404]);
      for (const answer of answers) {
        expect(
          Object.keys(answer.headers).filter((name) => name.startsWith("access-control-")),
        ).toEqual([]);
      }
    });
  });

  it("is refused 403 on the WebSocket upgrade", async () => {
    await withDaemon(async (daemon) => {
      const upgrade = rawSocket(daemon.server.port, `?token=${daemon.token}`, {
        origin: "http://evil.example",
      });
      const refused = await new Promise<number | undefined>((resolve) => {
        upgrade.ws.once("unexpected-response", (_request, response) => {
          resolve(response.statusCode);
        });
      });
      expect(refused).toBe(403);
    });
  });
});

/** Whether a TCP connection to `host:port` opens. */
const opens = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });

/** The status a WebSocket upgrade at `path` is refused with (undefined when it is accepted). */
const upgradeStatus = (port: number, path: string): Promise<number | undefined> =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`);
    ws.on("error", () => undefined); // the refusal is read from the unexpected-response event
    ws.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode);
    });
    ws.once("open", () => {
      ws.close();
      resolve(undefined);
    });
  });

describe("the WebSocket upgrade", () => {
  it("exists at /rpc only: anywhere else it is 404, the token notwithstanding", async () => {
    await withDaemon(async (daemon) => {
      const { port, token } = daemon.server;
      for (const path of ["/", "/ui/a", "/n/a/hook", "/rpc/x"])
        expect([path, await upgradeStatus(port, `${path}?token=${token}`)]).toEqual([path, 404]);
      expect(await upgradeStatus(port, `/rpc?token=${token}`)).toBeUndefined();
    });
  });
});

describe("the bind address", () => {
  it("is 127.0.0.1 only: the IPv6 loopback and every LAN address of this machine refuse", async () => {
    await withDaemon(async (daemon) => {
      const { port } = daemon.server;
      const lan = Object.values(networkInterfaces())
        .flat()
        .flatMap((entry) =>
          entry && !entry.internal && entry.family === "IPv4" ? [entry.address] : [],
        );
      expect(await opens("127.0.0.1", port)).toBe(true);
      expect(await opens("::1", port)).toBe(false);
      for (const address of lan)
        expect([address, await opens(address, port)]).toEqual([address, false]);
    });
  });
});
