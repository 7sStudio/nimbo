// The WebSocket upgrade of 03-api §7.1: the same Host and Origin rules as every request (a refusal is an HTTP 403),
// `/rpc` only (404 elsewhere), then the upgrade is accepted and a missing or wrong `?token=` closes the socket with 4401,
// never a 401 on the upgrade, which browsers and Node's WebSocket cannot read (a refused upgrade looks like a drop).
// Every raw socket and every accepted WebSocket has an `error` listener: a client that resets during a refusal, or a
// frame `ws` refuses (over maxPayload, bad UTF-8, a bad opcode), closes that connection only, never the daemon.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { WebSocket, WebSocketServer } from "ws";

import type { Declaration } from "../commands/context.js";
import type { Log } from "../events/log.js";
import { isToken } from "./auth.js";
import { declarationOf } from "./declaration.js";
import { isAllowed } from "./guard.js";

export type UpgradeOptions = {
  readonly wss: WebSocketServer;
  readonly token: string;
  readonly port: () => number;
  /** Whether the daemon still takes connections (false while it stops). */
  readonly accepting: () => boolean;
  /** Serves an authorized socket. */
  readonly serve: (ws: WebSocket, declaration: Declaration) => void;
  readonly log: Log;
};

/** Writes a bare HTTP status on the raw socket, then destroys it once written. */
function refuse(socket: Duplex, status: number, reason: string): void {
  socket.end(
    `HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}

type Upgrade = {
  readonly request: IncomingMessage;
  readonly socket: Duplex;
  readonly head: Buffer;
};

/** Accepts the upgrade: the socket served, or closed 4401; either way a frame it cannot read closes it alone. */
function accept(options: UpgradeOptions, upgrade: Upgrade, url: URL): void {
  const authorized = isToken(url.searchParams.get("token") ?? undefined, options.token);
  const declaration = declarationOf(url.searchParams.get("client"), url.searchParams.get("agent"));
  const { request, socket, head } = upgrade;
  options.wss.handleUpgrade(request, socket, head, (ws) => {
    ws.on("error", (error) => {
      // ws has closed the socket already (1009 over maxPayload, 1007 bad UTF-8, 1002 a protocol error).
      options.log.warn({ err: error, authorized }, "a WebSocket sent a frame it could not read");
    });
    if (authorized) options.serve(ws, declaration);
    else ws.close(4401, "Unauthorized");
  });
}

/** The `upgrade` listener of the daemon's HTTP server. */
export function onUpgrade(options: UpgradeOptions) {
  return (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on("error", (error) => {
      // A client that resets during the handshake or a refusal: its socket alone is gone.
      options.log.debug({ err: error }, "an upgrading socket failed");
    });
    if (!isAllowed(request.headers, options.port())) {
      refuse(socket, 403, "Forbidden");
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/rpc") {
      refuse(socket, 404, "Not Found");
      return;
    }
    if (!options.accepting()) {
      refuse(socket, 503, "Service Unavailable");
      return;
    }
    accept(options, { request, socket, head }, url);
  };
}
