// A JSON-RPC peer standing in for the daemon in transport tests (nothing of ours is mocked): POST /rpc, GET routes, and /rpc over WebSocket with the token rules.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { text } from "node:stream/consumers";

import { WebSocketServer } from "ws";
import { z } from "zod";

import type { MethodHandler } from "./answers.js";
import { methodNotFound } from "./answers.js";
import { PeerSocket } from "./peerSocket.js";

export type PeerOptions = { readonly token?: string; readonly port?: number };

/** What the peer saw of one HTTP call. */
export type HttpCall = {
  readonly method: string;
  readonly params: unknown;
  readonly headers: IncomingMessage["headers"];
};

const callFrame = z.object({ id: z.unknown(), method: z.string(), params: z.unknown() });

export class Peer {
  readonly token: string;
  readonly httpCalls: HttpCall[] = [];
  readonly sockets: PeerSocket[] = [];
  readonly #server: Server;
  readonly #wss: WebSocketServer;
  readonly #answers = new Map<string, MethodHandler>();
  readonly #routes = new Map<string, (response: ServerResponse) => void>();
  readonly #socketWaiters: ((socket: PeerSocket) => void)[] = [];
  #port: number | undefined;

  constructor(token: string) {
    this.token = token;
    this.#server = createServer((request, response) => {
      void this.#http(request, response);
    });
    this.#wss = new WebSocketServer({ server: this.#server, path: "/rpc" });
    this.#wss.on("connection", (ws, request) => {
      const query = new URL(request.url ?? "/", "http://peer").searchParams;
      const socket = new PeerSocket(ws, query, (method) => this.#handlerOf(method));
      this.sockets.push(socket);
      for (const waiter of this.#socketWaiters.splice(0)) waiter(socket);
      if (query.get("token") !== this.token) ws.close(4401);
    });
  }

  /** The port it listened on, kept after close so a test can aim at a daemon that went away. */
  get port(): number {
    if (this.#port === undefined) throw new Error("the peer never listened");
    return this.#port;
  }

  get url(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  /** Answers `method` on both transports. */
  on(method: string, answer: MethodHandler): void {
    this.#answers.set(method, answer);
  }

  /** Answers GET `path` (after the token check). */
  route(path: string, respond: (response: ServerResponse) => void): void {
    this.#routes.set(path, respond);
  }

  /** The next socket to connect (already connected ones do not count). */
  nextSocket(): Promise<PeerSocket> {
    return new Promise((resolve) => this.#socketWaiters.push(resolve));
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) =>
      this.#server.listen(port, "127.0.0.1", () => {
        const address = this.#server.address();
        this.#port = address !== null && typeof address === "object" ? address.port : undefined;
        resolve();
      }),
    );
  }

  /** Stops listening and ends every connection. */
  close(): Promise<void> {
    for (const client of this.#wss.clients) client.terminate();
    this.#server.closeAllConnections();
    return new Promise((resolve) => {
      this.#wss.close();
      this.#server.close(() => {
        resolve();
      });
    });
  }

  #handlerOf(method: string): MethodHandler {
    return this.#answers.get(method) ?? methodNotFound;
  }

  async #http(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      response.writeHead(401).end();
      return;
    }
    const route = this.#routes.get(request.url ?? "");
    if (request.method === "GET" && route) {
      route(response);
      return;
    }
    const frame = callFrame.parse(JSON.parse(await text(request)));
    this.httpCalls.push({ method: frame.method, params: frame.params, headers: request.headers });
    const answer = await this.#handlerOf(frame.method)(frame.params, {
      transport: "http",
      headers: request.headers,
    });
    if ("destroy" in answer) request.socket.destroy();
    else if ("raw" in answer) response.writeHead(answer.status ?? 200).end(answer.raw);
    else {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...answer }));
    }
  }
}

/** A peer listening on 127.0.0.1 (port 0 unless given); the test closes it. */
export async function startPeer(options: PeerOptions = {}): Promise<Peer> {
  const peer = new Peer(options.token ?? "secret");
  await peer.listen(options.port ?? 0);
  return peer;
}
