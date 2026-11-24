// A Debug Adapter Protocol connection to js-debug over TCP: Content-Length framed JSON, requests answered by seq with a
// timeout and their bodies validated (protocol.ts), events fanned out, reverse requests (startDebugging) answered by
// the owner, pending requests rejected when the socket closes. The daemon's long-lived handle on one DAP session.
import { connect } from "node:net";
import type { Socket } from "node:net";

import { z } from "zod";

import { DapFailed } from "./failure.js";

const Message = z.object({ seq: z.number(), type: z.string() }).loose();
const Response = z
  .object({
    request_seq: z.number(),
    success: z.boolean(),
    message: z.string().optional(),
    body: z.unknown().optional(),
  })
  .loose();
const Event = z.object({ event: z.string(), body: z.unknown().optional() }).loose();
const Reverse = z.object({ command: z.string(), arguments: z.unknown().optional() }).loose();
const ErrorBody = z.object({ error: z.object({ format: z.string() }) });

export type DapEvent = { readonly event: string; readonly body: unknown };

export { DapFailed } from "./failure.js";

const defaultTimeoutMs = 10_000;

type Pending = {
  readonly command: string;
  readonly settle: (body: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
};

/** Why js-debug refused a request: its error's text (an evaluation's exception), else its message. */
function failureOf(response: z.infer<typeof Response>): string {
  const body = ErrorBody.safeParse(response.body);
  return body.success ? body.data.error.format : (response.message ?? "refused");
}

/** The complete messages at the front of `buffer` and what is left of it. */
function frames(buffer: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let rest = buffer;
  for (let head = rest.indexOf("\r\n\r\n"); head !== -1; head = rest.indexOf("\r\n\r\n")) {
    const length = /Content-Length: *(\d+)/iu.exec(rest.subarray(0, head).toString("latin1"));
    const end = head + 4 + Number(length?.[1] ?? 0);
    if (rest.length < end) break;
    try {
      if (length) messages.push(JSON.parse(rest.subarray(head + 4, end).toString("utf8")));
    } catch {
      // a frame that is not JSON is skipped; the next one is read
    }
    rest = rest.subarray(end);
  }
  return { messages, rest };
}

export class DapConnection {
  readonly #socket: Socket;
  readonly #pending = new Map<number, Pending>();
  readonly #events = new Set<(event: DapEvent) => void>();
  readonly #closes = new Set<() => void>();
  #reverse: (command: string, args: unknown) => Promise<unknown> = () => Promise.resolve({});
  #seq = 0;
  #buffer: Buffer = Buffer.alloc(0);
  #closed = false;

  constructor(socket: Socket) {
    this.#socket = socket;
    socket.on("data", (chunk: Buffer) => {
      const read = frames(Buffer.concat([this.#buffer, chunk]));
      this.#buffer = read.rest;
      for (const raw of read.messages) this.#dispatch(raw);
    });
    socket.on("close", () => {
      this.#ended();
    });
    socket.on("error", () => {
      this.#ended();
    });
  }

  /** Sends `command` and answers its body (protocol.ts's `dap` reads it); rejects with DapFailed when js-debug
   * refuses it, times out, or the connection closed. */
  send(command: string, args: unknown, timeoutMs = defaultTimeoutMs): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.#closed) {
        reject(new DapFailed(command, "the debugger connection closed"));
        return;
      }
      const sent = this.#seq + 1;
      const timer = setTimeout(() => {
        this.#pending.delete(sent);
        reject(new DapFailed(command, `no answer within ${String(timeoutMs)} ms`));
      }, timeoutMs);
      this.#pending.set(sent, { command, settle: resolve, reject, timer });
      this.#write({ type: "request", command, arguments: args });
    });
  }

  onEvent(listener: (event: DapEvent) => void): void {
    this.#events.add(listener);
  }

  /** Answers js-debug's reverse requests (startDebugging); the handler's resolved value is the body. */
  onReverse(handler: (command: string, args: unknown) => Promise<unknown>): void {
    this.#reverse = handler;
  }

  onClose(listener: () => void): void {
    if (this.#closed) listener();
    else this.#closes.add(listener);
  }

  closed(): boolean {
    return this.#closed;
  }

  close(): void {
    this.#socket.destroy();
    this.#ended();
  }

  #write(message: Readonly<Record<string, unknown>>): void {
    if (this.#closed) return;
    this.#seq += 1;
    const text = JSON.stringify({ ...message, seq: this.#seq });
    this.#socket.write(`Content-Length: ${String(Buffer.byteLength(text))}\r\n\r\n${text}`);
  }

  #dispatch(raw: unknown): void {
    const message = Message.safeParse(raw);
    if (!message.success) return;
    const { type, seq } = message.data;
    if (type === "response") this.#answered(raw);
    else if (type === "event") {
      const event = Event.safeParse(raw);
      if (event.success)
        for (const listener of this.#events)
          listener({ event: event.data.event, body: event.data.body });
    } else if (type === "request") {
      const request = Reverse.safeParse(raw);
      if (request.success) this.#answerReverse(seq, request.data.command, request.data.arguments);
    }
  }

  #answered(raw: unknown): void {
    const response = Response.safeParse(raw);
    if (!response.success) return;
    const entry = this.#pending.get(response.data.request_seq);
    if (!entry) return;
    this.#pending.delete(response.data.request_seq);
    clearTimeout(entry.timer);
    if (response.data.success) entry.settle(response.data.body);
    else entry.reject(new DapFailed(entry.command, failureOf(response.data)));
  }

  #answerReverse(seq: number, command: string, args: unknown): void {
    const respond = (success: boolean, body?: unknown): void => {
      this.#write({ type: "response", request_seq: seq, command, success, body });
    };
    this.#reverse(command, args).then(
      (body) => {
        respond(true, body);
      },
      () => {
        respond(false);
      },
    );
  }

  #ended(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new DapFailed(entry.command, "the debugger connection closed"));
    }
    this.#pending.clear();
    for (const listener of this.#closes) listener();
  }
}

/** A connection to the DAP server at `path` (a Unix socket or a named pipe). */
export function connectDap(path: string): Promise<DapConnection> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path });
    socket.once("connect", () => {
      socket.setNoDelay(true);
      resolve(new DapConnection(socket));
    });
    socket.once("error", reject);
  });
}
