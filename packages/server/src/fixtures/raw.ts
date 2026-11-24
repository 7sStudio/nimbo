// Raw HTTP and WebSocket access to a test daemon, below the typed client: bodies the client would never send, headers
// it would never set, and the close codes and frames a socket receives.
import { request } from "node:http";

import { WebSocket } from "ws";

export type RawAnswer = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
  /** The body's bytes as they came. */
  readonly bytes: Uint8Array;
};

export type RawRequest = {
  readonly method?: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent as it is: text as UTF-8, bytes unchanged. */
  readonly body?: string | Uint8Array;
};

/** A JSON body, parsed. */
export const bodyOf = (answer: RawAnswer): unknown => JSON.parse(answer.body);

/** One HTTP request with exactly the given headers (Host included: fetch would replace it). */
export function rawHttp(port: number, raw: RawRequest): Promise<RawAnswer> {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${String(port)}`, ...raw.headers };
    const sent = request(
      { host: "127.0.0.1", port, method: raw.method ?? "GET", path: raw.path, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            bytes: Buffer.concat(chunks),
          });
        });
      },
    );
    sent.on("error", reject);
    sent.end(raw.body);
  });
}

/** The page cookie pairs (`nimbo-<port>=<key>`) a first load of `/ui/` with the token sets, one per path. */
export async function pageCookie(port: number, token: string): Promise<string> {
  const answer = await rawHttp(port, { path: `/ui/a.jsnb?token=${token}` });
  const set = answer.headers["set-cookie"];
  const [first = ""] = Array.isArray(set) ? set : [set ?? ""];
  return first.split(";")[0] ?? "";
}

/** POST /rpc with the token and a raw body. */
export const postRpc = (
  port: number,
  token: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  rawHttp(port, {
    method: "POST",
    path: "/rpc",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body,
  });

export type RawSocket = {
  readonly ws: WebSocket;
  /** The next text frame, parsed. */
  readonly next: () => Promise<unknown>;
  /** The close code. */
  readonly closed: Promise<number>;
};

/** A raw socket to `/rpc` with the given query and headers. */
export function rawSocket(
  port: number,
  query: string,
  headers: Record<string, string> = {},
): RawSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/rpc${query}`, { headers });
  const frames: unknown[] = [];
  let wake: (() => void) | undefined;
  ws.on("message", (data: Buffer) => {
    frames.push(JSON.parse(data.toString("utf8")));
    wake?.();
  });
  ws.on("error", () => undefined); // a refused upgrade is read from `closed` and the unexpected-response event
  const closed = new Promise<number>((resolve) => {
    ws.on("close", (code) => {
      resolve(code);
    });
  });
  const next = async (): Promise<unknown> => {
    while (frames.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    return frames.shift();
  };
  return { ws, next, closed };
}

/** Resolves once `ws` is open. */
export const opened = (ws: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    ws.once("open", () => {
      resolve();
    });
    ws.once("unexpected-response", (_request, response) => {
      reject(new Error(`HTTP ${String(response.statusCode)}`));
    });
  });
