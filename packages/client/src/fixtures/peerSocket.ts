// The WebSocket side of the test peer: one connected client socket, which the peer answers, notifies, asks and drops.
import type { RawData, WebSocket } from "ws";

import type { MethodHandler, WireAnswer } from "./answers.js";

type Frame = { readonly id?: unknown; readonly method?: unknown; readonly params?: unknown };

const textOf = (raw: RawData): string => {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
};

const isFrame = (value: unknown): value is Frame =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class PeerSocket {
  /** The upgrade's query: token, client, agent (03-api §7.1). */
  readonly query: URLSearchParams;
  readonly #ws: WebSocket;
  readonly #handlerOf: (method: string) => MethodHandler;
  readonly #frames: unknown[] = [];
  readonly #waiters: ((frame: unknown) => void)[] = [];
  readonly #asked = new Map<unknown, (frame: unknown) => void>();
  #nextId = 1;

  constructor(ws: WebSocket, query: URLSearchParams, handlerOf: (method: string) => MethodHandler) {
    this.query = query;
    this.#ws = ws;
    this.#handlerOf = handlerOf;
    ws.on("message", (raw) => {
      this.#message(JSON.parse(textOf(raw)));
    });
  }

  /** The next frame from the client that is neither a call nor an answer to `request`. */
  nextFrame(): Promise<unknown> {
    return new Promise((resolve) => {
      if (this.#frames.length > 0) resolve(this.#frames.shift());
      else this.#waiters.push(resolve);
    });
  }

  notify(method: string, params: unknown): void {
    this.#ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  send(text: string): void {
    this.#ws.send(text);
  }

  /** Sends a request to the client; resolves to its response frame. */
  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const id = `peer-${String(this.#nextId++)}`;
      this.#asked.set(id, resolve);
      this.#ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Ends the TCP connection without a closing handshake, as a crash or a network drop does. */
  drop(): void {
    this.#ws.terminate();
  }

  close(code: number): void {
    this.#ws.close(code);
  }

  #message(frame: unknown): void {
    if (isFrame(frame) && typeof frame.method === "string") {
      const answer = this.#handlerOf(frame.method)(frame.params, { transport: "ws", socket: this });
      void Promise.resolve(answer).then((settled) => {
        this.#reply(frame.id, settled);
      });
      return;
    }
    const asked = isFrame(frame) ? this.#asked.get(frame.id) : undefined;
    if (asked && isFrame(frame)) {
      this.#asked.delete(frame.id);
      asked(frame);
      return;
    }
    const waiter = this.#waiters.shift();
    if (waiter) waiter(frame);
    else this.#frames.push(frame);
  }

  #reply(id: unknown, answer: WireAnswer): void {
    if ("destroy" in answer) this.#ws.terminate();
    else if ("raw" in answer) this.#ws.send(answer.raw);
    else this.#ws.send(JSON.stringify({ jsonrpc: "2.0", id, ...answer }));
  }
}
