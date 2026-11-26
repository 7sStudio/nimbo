// The WebSocket connection: concurrent calls matched by id, event notifications, the daemon's requests
// to the page, reconnects with backoff, calls held while reconnecting, and the status the UI mirrors.
import type { JsnbError } from "@jsnb/core";
import { Unauthorized } from "@jsnb/core";

import type { OutgoingCall } from "../call/caller.js";
import type { DaemonOptions } from "../daemon/address.js";
import { socketUrl } from "../daemon/address.js";
import type { ReportError } from "../errors/report.js";
import { reportToHost } from "../errors/report.js";
import { ConnectionClosed, ConnectionDropped, DaemonUnreachable } from "../errors/transport.js";
import { countAttempts } from "../retry/attempts.js";
import type { Backoff } from "../retry/backoff.js";
import { socketBackoff } from "../retry/backoff.js";
import { dispatch } from "./dispatch.js";
import { createPendingCalls, enlist } from "./pending.js";
import type { ServerRequestHandler, ServerRequestMethod } from "./requests.js";
import { createRequestHandlers } from "./requests.js";
import { openInOrder } from "./opening.js";
import type { OpenSocket, SocketLike } from "./socketLike.js";
import { openWebSocket } from "./socketLike.js";
import type { ConnectionStatus } from "./status.js";
import { createStatus } from "./status.js";

export type SocketOptions = DaemonOptions & {
  /** Overrides of the reconnect backoff (unlimited attempts from 250 ms up to 5 s). */
  readonly reconnect?: Partial<Backoff>;
  /** The socket to use; the platform WebSocket by default. */
  readonly openSocket?: OpenSocket;
  /** Errors no caller waits for (a throwing listener or onError); by default thrown to the host on a microtask. */
  readonly reportError?: ReportError;
};

/** One logical connection to the daemon over successive sockets; state lives here, not in a socket. */
export class SocketConnection {
  readonly #options: SocketOptions;
  readonly #attempts;
  readonly #report: ReportError;
  readonly #status;
  readonly #pending = createPendingCalls();
  readonly #requests = createRequestHandlers();
  readonly #events = new Set<(params: unknown) => void>();
  #socket: SocketLike | undefined;
  #nextId = 1;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #ending: ((method: string) => JsnbError) | undefined;
  #reason: JsnbError | undefined;

  constructor(options: SocketOptions) {
    this.#options = options;
    this.#attempts = countAttempts({ ...socketBackoff, ...options.reconnect });
    this.#report = options.reportError ?? reportToHost;
    this.#status = createStatus(this.#report);
    this.#open();
  }

  get status(): ConnectionStatus {
    return this.#status.get();
  }

  /** Why it closed for good (Unauthorized, DaemonUnreachable); undefined while open or closed by its owner. */
  get closeReason(): JsnbError | undefined {
    return this.#reason;
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    return this.#status.listen(listener);
  }

  /** Every `event` notification's params, as they arrive. */
  onEvent(listener: (params: unknown) => void): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }

  handle<M extends ServerRequestMethod>(method: M, respond: ServerRequestHandler<M>): () => void {
    return this.#requests.register(method, respond);
  }

  /** Sends a call now if the socket is live, else when it is; resolves to the raw result. */
  request(call: OutgoingCall): Promise<unknown> {
    if (this.#ending) return Promise.reject(this.#ending(call.method));
    const answer = enlist(this.#pending, this.#nextId, call);
    this.#nextId += 1;
    this.#flush();
    return answer;
  }

  /** Closes for good: pending and later calls fail with ConnectionClosed. */
  close(): void {
    if (this.#ending) return;
    clearTimeout(this.#timer);
    const socket = this.#socket;
    this.#socket = undefined;
    this.#end((method) => new ConnectionClosed({ method }), undefined);
    socket?.close(1000);
  }

  /** Where errors go that no caller waits for: listeners' and subscribers' failures. */
  report(error: unknown): void {
    this.#report(error);
  }

  #open(): void {
    this.#attempts.tried();
    const open = this.#options.openSocket ?? openWebSocket;
    const adopt = (socket: SocketLike): void => {
      this.#socket = socket;
    };
    openInOrder(open, socketUrl(this.#options), adopt, {
      open: (socket) => {
        if (socket === this.#socket) this.#opened();
      },
      message: (socket, frame) => {
        if (socket === this.#socket) this.#route(socket, frame);
      },
      close: (socket, code) => {
        if (socket === this.#socket) this.#closed(code);
      },
    });
  }

  #route(socket: SocketLike, frame: unknown): void {
    const isCurrent = (): boolean => socket === this.#socket;
    const routes = { socket, pending: this.#pending, requests: this.#requests, isCurrent };
    dispatch(frame, { ...routes, events: this.#events, report: this.#report });
  }

  #opened(): void {
    this.#attempts.succeeded();
    this.#status.set("live");
    this.#flush();
  }

  #flush(): void {
    if (this.#status.get() !== "live" || !this.#socket) return;
    for (const call of this.#pending.unsent()) this.#socket.send(call.frame);
  }

  #closed(code: number): void {
    this.#socket = undefined;
    if (code === 4401) {
      this.#endWith(new Unauthorized());
      return;
    }
    for (const call of this.#pending.drop()) {
      call.reject(new ConnectionDropped({ method: call.method }));
    }
    const delayMs = this.#attempts.next();
    if (delayMs === undefined) {
      const attempts = this.#attempts.count();
      this.#endWith(new DaemonUnreachable({ url: this.#options.url, attempts }));
      return;
    }
    if (this.#status.get() === "live") this.#status.set("reconnecting");
    this.#timer = setTimeout(() => {
      this.#open();
    }, delayMs);
  }

  #endWith(reason: JsnbError): void {
    this.#end(() => reason, reason);
  }

  #end(ending: (method: string) => JsnbError, reason: JsnbError | undefined): void {
    this.#ending = ending;
    this.#reason = reason;
    this.#status.set("closed");
    for (const call of this.#pending.clear()) call.reject(ending(call.method));
  }
}
