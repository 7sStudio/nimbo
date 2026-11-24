// The stdio transport of `nimbo mcp` (03-api §9): one JSON-RPC message per line on stdin and stdout, read with the SDK's
// own line buffer. Written here rather than the SDK's StdioServerTransport, which neither ends when stdin does nor
// hears a write fail: a reader gone (the agent exited: EPIPE, ECANCELED, ENOTCONN, …) closes the
// transport at once and quietly; stdin's end stops the reading and closes it once every request already read has been
// answered (or cancelled), so `printf … | nimbo mcp` gets its answers; a line that is no JSON-RPC message is reported
// and skipped, as the SDK's is. A class, as the SDK's transports are: it is the long-lived stateful thing whose
// callbacks the SDK sets (08 §6).
import type { Readable, Writable } from "node:stream";

import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { CancelledNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

import { readerGone } from "../io/world.js";

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** A transport over `stdin` and `stdout`; stdout carries the protocol and nothing else. */
export class StdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly #stdin: Readable;
  readonly #stdout: Writable;
  readonly #buffer = new ReadBuffer();
  /** The requests read and handed to the SDK that have no answer yet. */
  readonly #pending = new Set<RequestId>();
  /** stdin has ended: the transport closes once nothing is pending. */
  #draining = false;
  #closed = false;
  #failed = false;

  constructor(stdin: Readable, stdout: Writable) {
    this.#stdin = stdin;
    this.#stdout = stdout;
  }

  /** Whether the transport closed on a failure other than its reader going away (exit 1). */
  get failed(): boolean {
    return this.#failed;
  }

  start(): Promise<void> {
    // A failed write's `error` event, after its callback carried the failure, is no uncaught exception.
    if (this.#stdout.listenerCount("error") === 0) this.#stdout.on("error", () => undefined);
    this.#stdin.on("data", this.#onData);
    this.#stdin.on("end", this.#drain);
    this.#stdin.on("error", this.#onStreamError);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#end();
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    const stdout = this.#stdout;
    if (this.#closed || stdout.destroyed || stdout.writableEnded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      stdout.write(serializeMessage(message), (error) => {
        if (error === null || error === undefined) {
          resolve();
          const answered = "method" in message ? undefined : message.id;
          if (answered !== undefined) this.#settle(answered);
        } else if (readerGone(error)) {
          this.#end();
          resolve();
        } else reject(error);
      });
    });
  }

  /** A request no longer pending (answered, or cancelled by the agent); the last one ends a drained transport. */
  #settle(id: RequestId): void {
    this.#pending.delete(id);
    if (this.#draining && this.#pending.size === 0) this.#end();
  }

  /** Notes a request as pending, and a cancellation as its settlement (the SDK answers no cancelled request). */
  #track(message: JSONRPCMessage): void {
    if ("method" in message && "id" in message) this.#pending.add(message.id);
    const cancelled = CancelledNotificationSchema.safeParse(message);
    const id = cancelled.success ? cancelled.data.params.requestId : undefined;
    if (id !== undefined) this.#settle(id);
  }

  /** stdin ended: nothing more is read; the transport closes now, or once the pending requests are answered. */
  readonly #drain = (): void => {
    this.#stdin.off("data", this.#onData);
    this.#stdin.off("end", this.#drain);
    this.#draining = true;
    if (this.#pending.size === 0) this.#end();
  };

  readonly #end = (): void => {
    if (this.#closed) return;
    this.#closed = true;
    this.#stdin.off("data", this.#onData);
    this.#stdin.off("end", this.#drain);
    this.#pending.clear();
    this.#buffer.clear();
    this.#stdin.pause();
    this.onclose?.();
  };

  /** A read failure ends the transport; one that says the agent went away is no failure. */
  readonly #onStreamError = (error: Error): void => {
    if (!readerGone(error)) {
      this.#failed = true;
      this.onerror?.(error);
    }
    this.#end();
  };

  readonly #onData = (chunk: Buffer): void => {
    try {
      this.#buffer.append(chunk);
    } catch (error) {
      // Over the SDK's 10 MB line limit: no message can be read from what follows.
      this.#onStreamError(asError(error));
      return;
    }
    this.#readMessages();
  };

  #readMessages(): void {
    for (;;) {
      let message: JSONRPCMessage | null;
      try {
        message = this.#buffer.readMessage();
      } catch (error) {
        // Not JSON, or JSON that is no JSON-RPC message: that line is dropped and the next one read.
        this.onerror?.(asError(error));
        continue;
      }
      if (message === null || this.#closed) return;
      this.#track(message);
      this.onmessage?.(message);
    }
  }
}
