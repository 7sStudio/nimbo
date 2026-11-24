// The daemon's Chrome DevTools Protocol session with a kernel's inspector (04-kernel §6, §9): JSON-RPC calls over
// the global WebSocket, frames validated with Zod, pending calls rejected when the socket closes, the paused state
// tracked from Debugger.paused and Debugger.resumed, and the session closed when the kernel waits for it to exit.
import { z } from "zod";

import { InspectorFailed } from "./errors.js";

const Answer = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
const Event = z.object({ method: z.string(), params: z.unknown().optional() });

export type CdpOptions = {
  readonly onPause: (paused: boolean) => void;
  /** Every event, by method (the paused events included). */
  readonly onEvent?: (method: string, params: unknown) => void;
  /** A frame that is neither an answer nor an event. */
  readonly onInvalid: (frame: string) => void;
};

export type Cdp = {
  /** Calls `method`; rejects InspectorFailed with the inspector's error or once the connection closed. */
  readonly send: (method: string, params?: Readonly<Record<string, unknown>>) => Promise<unknown>;
  readonly paused: () => boolean;
  readonly close: () => void;
};

/** The slice of a WebSocket the session uses (the global WebSocket, or a test's fake). */
export type CdpSocket = {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "open" | "error" | "close", listener: () => void): void;
  send(text: string): void;
  close(): void;
};

type Pending = {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};
type Session = {
  readonly options: CdpOptions;
  readonly pending: Map<number, Pending>;
  readonly close: () => void;
  paused: boolean;
  closed: boolean;
};

const closedError = (method: string): InspectorFailed =>
  new InspectorFailed({ method, reason: "the connection closed" });

const parseFrame = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON at all: reported through onInvalid like any frame that is not CDP.
    return undefined;
  }
};

function onEvent(session: Session, method: string, params: unknown): void {
  if (method === "Debugger.paused" || method === "Debugger.resumed") {
    session.paused = method === "Debugger.paused";
    session.options.onPause(session.paused);
  }
  session.options.onEvent?.(method, params);
  // A process with a connected client does not exit until the client leaves (NodeRuntime.notifyWhenWaitingForDisconnect).
  if (method === "NodeRuntime.waitingForDisconnect") session.close();
}

function onFrame(session: Session, text: string): void {
  const frame = parseFrame(text);
  const answer = Answer.safeParse(frame);
  if (answer.success) {
    const entry = session.pending.get(answer.data.id);
    session.pending.delete(answer.data.id);
    const { error } = answer.data;
    if (error) entry?.reject(new InspectorFailed({ method: entry.method, reason: error.message }));
    else entry?.resolve(answer.data.result);
    return;
  }
  const event = Event.safeParse(frame);
  if (event.success) onEvent(session, event.data.method, event.data.params);
  else session.options.onInvalid(text);
}

function onClose(session: Session): void {
  session.closed = true;
  for (const entry of session.pending.values()) entry.reject(closedError(entry.method));
  session.pending.clear();
}

/** A session over `socket`, open or still opening: calls sent before it opens are the caller's to avoid. */
export function sessionOver(socket: CdpSocket, options: CdpOptions): Cdp {
  const close = (): void => {
    socket.close();
  };
  const session: Session = { options, pending: new Map(), close, paused: false, closed: false };
  socket.addEventListener("message", (message) => {
    onFrame(session, String(message.data));
  });
  socket.addEventListener("close", () => {
    onClose(session);
  });
  let lastId = 0;
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (session.closed) {
          reject(closedError(method));
          return;
        }
        lastId += 1;
        session.pending.set(lastId, { method, resolve, reject });
        socket.send(JSON.stringify({ id: lastId, method, params }));
      }),
    paused: () => session.paused,
    close,
  };
}

/** The socket to `url`; InspectorFailed when `url` is no WebSocket URL. */
function socketTo(url: string): WebSocket {
  try {
    return new WebSocket(url);
  } catch (error) {
    throw new InspectorFailed(
      { method: "connect", reason: `${url} is not a WebSocket URL` },
      { cause: error },
    );
  }
}

/** Opens a session to the inspector at `url`; InspectorFailed when nothing answers there. */
export async function connectCdp(url: string, options: CdpOptions): Promise<Cdp> {
  const socket = socketTo(url);
  const cdp = sessionOver(socket, options);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve();
    });
    socket.addEventListener("error", () => {
      reject(new InspectorFailed({ method: "connect", reason: `no inspector answers at ${url}` }));
    });
  });
  return cdp;
}
