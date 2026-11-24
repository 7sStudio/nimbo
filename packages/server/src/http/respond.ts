// The daemon's HTTP answers: JSON-RPC bodies, the 401 of a missing token, plain refusals; never a CORS header
// (02-architecture §8). Request bodies are read up to a limit.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { WireError } from "../commands/wireError.js";
import { writeError } from "./frames.js";

/** The largest body the daemon reads (a bridge argument may carry 5 MB of bytes as base64). */
export const maxBodyBytes = 64 * 1024 * 1024;

/** Writes `body` as JSON with `status`. */
export function sendJson(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

/** A JSON-RPC error body with `status` (03-api §7.5: a failed download carries one, id null). */
export const sendError = (response: ServerResponse, status: number, error: WireError): void => {
  sendJson(response, status, writeError(null, error));
};

/** 401 with the UNAUTHORIZED error of 03-api §7.4. */
export const sendUnauthorized = (response: ServerResponse): void => {
  sendError(response, 401, {
    code: 1006,
    message: "The token is missing or wrong. Read it from .jsnb/server.json in the workspace.",
  });
};

/** A 401 with no body: what a page's GET of /ui/ or /npm/ gets without its credentials. */
export const sendBareUnauthorized = (response: ServerResponse): void => {
  sendStatus(response, 401);
};

/** True for a GET or a HEAD, the methods of every endpoint that only reads. */
export const isRead = (request: IncomingMessage): boolean =>
  request.method === "GET" || request.method === "HEAD";

/** The 405 of an endpoint that only reads: its Allow names HEAD beside GET, since both are served. */
export const sendReadOnly = (response: ServerResponse): void => {
  sendStatus(response, 405, { allow: "GET, HEAD" });
};

/** An empty answer: a refused Host or Origin says nothing more (03-api §7.1). */
export function sendStatus(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { "content-length": 0, ...headers });
  response.end();
}

/** The bytes of `request`'s body, or undefined when it is larger than `maxBodyBytes`. */
export async function readRawBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBodyBytes) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** The body of `request` as text, or undefined when it is larger than `maxBodyBytes`. */
export async function readBody(request: IncomingMessage): Promise<string | undefined> {
  return (await readRawBody(request))?.toString("utf8");
}
