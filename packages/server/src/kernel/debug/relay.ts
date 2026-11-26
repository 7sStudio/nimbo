// The CDP relay js-debug attaches through, to the kernel's inspector or to the headless page: a WebSocket on a Unix
// socket in a new 0700 folder (under the folder given when the socket's path fits, else where js-debug's own goes), at
// a random path, that takes one connection and then listens no more (the socket file goes with the folder), so only the
// js-debug given the address reaches it. Its requests go to one upstream (the kernel's inspector, or one CDP session on
// the page), the methods `allow` refuses answered -32601. Reading a paused realm never runs its code: js-debug's object
// descriptions (which read every property, getters and Proxy traps included, and call custom toString and description
// symbols) are answered here as plain ones, a getter is not called when its variable is opened, and an evaluation
// ends after `evaluationTimeoutMs` with the realm still paused. It closes when js-debug leaves, the upstream goes, or
// the daemon closes it.
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { z } from "zod";

import type { Log } from "../../events/log.js";
import { makePrivateDir, socketDir } from "./adapter.js";

export type CdpRelay = {
  /** `ws+unix:<socket>:/<secret>`: the address js-debug alone is given. */
  readonly url: string;
  /** Aborted once the relay closed: js-debug left, the upstream went, or `close`. */
  readonly closed: AbortSignal;
  readonly close: () => void;
};

/** Where the relay's requests go. */
type Upstream = {
  /** Sends one request on; its answer reaches the relay's `deliver` with the same id. */
  readonly request: (id: number, method: string, params: Readonly<Record<string, unknown>>) => void;
  readonly close: () => void;
};

/** Opens the upstream: `deliver` takes each answer and event for js-debug, `lost` says it went. */
type Connect = (deliver: (message: unknown) => void, lost: () => void) => Promise<Upstream>;

export type RelayOptions = {
  readonly connect: Connect;
  readonly log: Log;
  /** Where the socket's folder goes when its path fits; else under the system's temp folder. */
  readonly dir?: string | undefined;
  /** The methods js-debug may call; every one when absent. */
  readonly allow?: (method: string) => boolean;
};

const socketName = "cdp.sock";
/** Under the 104 bytes macOS allows a socket's path (108 on Linux). */
const maxSocketPath = 100;
/** How long the relay waits for js-debug's connection. */
const acceptTimeoutMs = 15_000;
const maxMessageBytes = 16 * 1024 * 1024;
/** How long an evaluation may run before the realm ends it. */
const evaluationTimeoutMs = 5000;

const Request = z.object({
  id: z.number(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** js-debug's own description code, which runs in the realm: a function holding this text. */
const descriptionMark = "<<default preview>>";
/** js-debug's getter call, made when a getter's variable is opened: `function(t){return t.call(this)}`. */
const getterCall = /^function\s*\(\s*(\w+)\s*\)\s*\{\s*return\s+\1\.call\(this\)/u;

/** What the relay answers itself for a request, or the parameters it sends on. */
function screened(
  method: string,
  params: Readonly<Record<string, unknown>>,
):
  | { readonly answer: unknown }
  | { readonly params: Readonly<Record<string, unknown>>; readonly timed?: true } {
  if (method === "Runtime.callFunctionOn") {
    const code = typeof params.functionDeclaration === "string" ? params.functionDeclaration : "";
    if (code.includes(descriptionMark))
      return {
        answer: code.includes("customProps")
          ? { result: { type: "object", value: {} } }
          : { result: { type: "undefined" } },
      };
    if (getterCall.test(code)) {
      const text = "A getter runs only when it is evaluated (debug.evaluate).";
      return {
        answer: {
          result: { type: "object", subtype: "error", className: "Error", description: text },
          exceptionDetails: { exceptionId: 0, text, lineNumber: 0, columnNumber: 0 },
        },
      };
    }
  }
  if (
    (method === "Runtime.evaluate" || method === "Debugger.evaluateOnCallFrame") &&
    params.timeout === undefined
  )
    return { params: { ...params, timeout: evaluationTimeoutMs }, timed: true };
  return { params };
}

const Answer = z
  .object({ id: z.number(), error: z.object({ message: z.string() }).optional() })
  .loose();

const tooLong = `Error: the evaluation did not end within ${String(evaluationTimeoutMs / 1000)} s and was stopped`;

/** The answer to an evaluation the realm ended at its timeout, as the evaluation's exception. */
const timedOut = (id: number) => {
  const exception = { type: "object", subtype: "error", className: "Error", description: tooLong };
  return {
    id,
    result: {
      result: exception,
      exceptionDetails: {
        exceptionId: 0,
        text: "Uncaught",
        lineNumber: 0,
        columnNumber: 0,
        exception,
      },
    },
  };
};

/** A new 0700 folder for the socket, and the socket's path in it. */
function placeIn(dir: string | undefined): { readonly dir: string; readonly path: string } {
  if (dir !== undefined) {
    const own = join(dir, `debug-${randomBytes(6).toString("hex")}`);
    if (Buffer.byteLength(join(own, socketName)) < maxSocketPath) {
      makePrivateDir(own);
      return { dir: own, path: join(own, socketName) };
    }
  }
  const fallback = socketDir();
  return { dir: fallback, path: join(fallback, socketName) };
}

/** js-debug's requests, screened and sent on; the upstream's answers and events back. */
function pipe(
  ws: WebSocket,
  upstream: Upstream,
  options: RelayOptions & { readonly timed: Set<number> },
): void {
  const send = (message: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  ws.on("message", (data: Buffer) => {
    let request: z.infer<typeof Request>;
    try {
      request = Request.parse(JSON.parse(data.toString("utf8")));
    } catch {
      return;
    }
    const { id, method } = request;
    if (options.allow !== undefined && !options.allow(method)) {
      options.log.debug({ method }, "the debugger's CDP relay refused a method");
      send({
        id,
        error: { code: -32601, message: `'${method}' is not available to the debugger` },
      });
      return;
    }
    const screen = screened(method, request.params ?? {});
    if ("answer" in screen) {
      send({ id, result: screen.answer });
      return;
    }
    if (screen.timed === true) options.timed.add(id);
    upstream.request(id, method, screen.params);
  });
}

/** Opens a relay to the upstream `connect` opens once js-debug connects; the first connection is js-debug's. */
export async function openCdpRelay(options: RelayOptions): Promise<CdpRelay> {
  const { log } = options;
  const place = placeIn(options.dir);
  const secret = randomBytes(24).toString("base64url");
  const closed = new AbortController();
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });
  let upstream: Upstream | undefined;
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
    upstream?.close();
  };
  const timer = setTimeout(close, acceptTimeoutMs);
  timer.unref();
  let taken = false;
  /** The evaluations sent with the relay's timeout, until answered. */
  const timed = new Set<number>();
  const deliver = (message: unknown): void => {
    const answer = Answer.safeParse(message);
    const ended =
      answer.success &&
      timed.delete(answer.data.id) &&
      /terminated/iu.test(answer.data.error?.message ?? "");
    const out = ended ? timedOut(answer.data.id) : message;
    if (socket?.readyState === socket?.OPEN) socket?.send(JSON.stringify(out));
  };
  server.on("upgrade", (request: IncomingMessage, stream: Duplex, head: Buffer) => {
    if (taken || request.url !== `/${secret}`) {
      stream.destroy();
      return;
    }
    taken = true;
    clearTimeout(timer);
    stopListening(); // one connection: nothing else can reach the socket from here on
    void options.connect(deliver, close).then(
      (own) => {
        upstream = own;
        if (closed.signal.aborted) {
          own.close();
          stream.destroy();
          return;
        }
        sockets.handleUpgrade(request, stream, head, (ws) => {
          socket = ws;
          pipe(ws, own, { ...options, timed });
          ws.on("close", close);
          ws.on("error", close);
        });
      },
      (error: unknown) => {
        log.warn({ err: error }, "the debugger's CDP relay could not reach its target");
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
  return { url: `ws+unix:${place.path}:/${secret}`, closed: closed.signal, close };
}
