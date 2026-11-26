// The headless page's CDP relay for js-debug (02-architecture §8): a WebSocket on a Unix socket in a new 0700 folder
// (under `.jsnb/headless/` when the socket's path fits, else where js-debug's own goes), at a random path, that takes one
// connection and then listens no more (the socket file goes with the folder), so only the js-debug given the address
// reaches it. That connection is one new CDP session on the one page, never the browser's, and carries only what a
// debugger needs of the page: the Runtime, Debugger and Profiler domains and DOM.describeNode for element previews;
// any other method is refused. It closes when js-debug leaves, the page goes, or the daemon closes it.
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { join } from "node:path";

import type { CDPSession, Page } from "puppeteer-core";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { z } from "zod";

import type { Log } from "../../events/log.js";
import { makePrivateDir, socketDir } from "../debug/adapter.js";

export type CdpRelay = {
  /** `ws+unix:<socket>:/<secret>`: the address js-debug alone is given. */
  readonly url: string;
  /** Aborted once the relay closed: js-debug left, the page closed, or `close`. */
  readonly closed: AbortSignal;
  readonly close: () => void;
};

const socketName = "cdp.sock";
/** Under the 104 bytes macOS allows a socket's path (108 on Linux). */
const maxSocketPath = 100;
/** How long the relay waits for js-debug's connection. */
const acceptTimeoutMs = 15_000;
const maxMessageBytes = 16 * 1024 * 1024;

const relayed = /^(?:Runtime|Debugger|Profiler)\.[A-Za-z]+$/u;

/** Whether js-debug may call `method` on the page. */
export const allowedMethod = (method: string): boolean =>
  relayed.test(method) || method === "DOM.describeNode";

const Request = z.object({ id: z.number(), method: z.string(), params: z.unknown().optional() });

/** A new 0700 folder for the socket, and the socket's path in it. */
function placeIn(dir: string): { readonly dir: string; readonly path: string } {
  const own = join(dir, `debug-${randomBytes(6).toString("hex")}`);
  if (Buffer.byteLength(join(own, socketName)) < maxSocketPath) {
    makePrivateDir(own);
    return { dir: own, path: join(own, socketName) };
  }
  const fallback = socketDir();
  return { dir: fallback, path: join(fallback, socketName) };
}

const failure = (error: unknown): { readonly code: number; readonly message: string } => {
  const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
  const original: unknown =
    error instanceof Error ? Reflect.get(error, "originalMessage") : undefined;
  return {
    code: typeof code === "number" ? code : -32000,
    message:
      typeof original === "string" && original !== ""
        ? original
        : error instanceof Error
          ? error.message
          : String(error),
  };
};

/** js-debug's requests to the page's session, its answers and events back. */
function pipe(ws: WebSocket, session: CDPSession, log: Log): void {
  const send = (message: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  session.on("*", (type: unknown, event: unknown) => {
    if (typeof type === "string") send({ method: type, params: event });
  });
  ws.on("message", (data: Buffer) => {
    let request: z.infer<typeof Request>;
    try {
      request = Request.parse(JSON.parse(data.toString("utf8")));
    } catch {
      return;
    }
    const { id, method } = request;
    if (!allowedMethod(method)) {
      log.debug({ method }, "the debugger's CDP relay refused a method");
      send({
        id,
        error: { code: -32601, message: `'${method}' is not available to the debugger` },
      });
      return;
    }
    // the request goes to this session only: a sessionId of its own would address another target
    const params = (request.params ?? {}) as Record<string, unknown>;
    session.send(method as "Runtime.evaluate", params as never).then(
      (result) => {
        send({ id, result });
      },
      (error: unknown) => {
        send({ id, error: failure(error) });
      },
    );
  });
}

/** Opens the relay to `page` in a new folder under `dir`; the first connection to its address is js-debug's. */
export async function openCdpRelay(
  page: Page,
  options: { readonly dir: string; readonly log: Log },
): Promise<CdpRelay> {
  const { log } = options;
  const place = placeIn(options.dir);
  const secret = randomBytes(24).toString("base64url");
  const closed = new AbortController();
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });
  let session: CDPSession | undefined;
  let socket: WebSocket | undefined;
  const stopListening = (): void => {
    server.close();
    rmSync(place.dir, { recursive: true, force: true });
  };
  const close = (): void => {
    if (closed.signal.aborted) return;
    closed.abort();
    clearTimeout(timer);
    stopListening();
    socket?.terminate();
    void session?.detach().catch(() => undefined);
  };
  const timer = setTimeout(close, acceptTimeoutMs);
  timer.unref();
  let taken = false;
  server.on("upgrade", (request: IncomingMessage, stream: Duplex, head: Buffer) => {
    if (taken || request.url !== `/${secret}`) {
      stream.destroy();
      return;
    }
    taken = true;
    clearTimeout(timer);
    stopListening(); // one connection: nothing else can reach the socket from here on
    void page.createCDPSession().then(
      (own) => {
        session = own;
        if (closed.signal.aborted) {
          void own.detach().catch(() => undefined);
          stream.destroy();
          return;
        }
        sockets.handleUpgrade(request, stream, head, (ws) => {
          socket = ws;
          pipe(ws, own, log);
          ws.on("close", close);
          ws.on("error", close);
        });
      },
      (error: unknown) => {
        log.warn({ err: error }, "the debugger's CDP relay could not open a session on the page");
        stream.destroy();
        close();
      },
    );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(place.path, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    close();
    throw error;
  }
  page.once("close", close);
  return { url: `ws+unix:${place.path}:/${secret}`, closed: closed.signal, close };
}
