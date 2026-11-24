// /feedback/ (the page's feedback mode): the UI feedback kept in the workspace's `.jsnb/feedback/`, with the bearer
// header only, as /outputs/ (the page sends its token). GET /feedback/ lists the entries, newest first, with the folder
// they are in; POST /feedback/ saves one; PATCH /feedback/<id> sets its status or its
// text ({"status":"open"|"done","text":…}); PUT /feedback/<id>/shots adds its screenshots ({"element"?,"viewport"?},
// base64 PNG); DELETE /feedback/<id> removes it and its screenshots; GET /feedback/shots/<name>.png answers one screenshot.
import type { IncomingMessage, ServerResponse } from "node:http";

import { hasBearer } from "./auth.js";
import { readBody, sendJson, sendStatus, sendUnauthorized } from "./respond.js";

export const feedbackPrefix = "/feedback/";

/** The store's answer to a body: the entry, or why the body is no entry or no change. */
type Checked = { readonly entry: unknown } | { readonly refused: string };

/** What the endpoint asks of the feedback store (files/feedback/feedbackStore.ts), which checks the bodies: the
 * entry's shape is the store's. */
export type FeedbackStore = {
  readonly dir: string;
  readonly list: () => Promise<readonly unknown[]>;
  readonly add: (body: unknown) => Promise<Checked>;
  readonly change: (id: string, body: unknown) => Promise<Checked | undefined>;
  readonly attach: (id: string, body: unknown) => Promise<Checked | undefined>;
  readonly remove: (id: string) => Promise<boolean>;
  readonly shot: (name: string) => Promise<Buffer | undefined>;
};

export type FeedbackRequest = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly pathname: string;
  readonly token: string;
  readonly feedback: FeedbackStore;
};

const json = (response: ServerResponse, status: number, value: unknown) => {
  sendJson(response, status, JSON.stringify(value));
};

/** The request's body as JSON, or undefined (the 400 or 413 already sent). */
async function bodyOf(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<{ readonly value: unknown } | undefined> {
  const text = await readBody(request);
  if (text === undefined) {
    sendStatus(response, 413);
    return undefined;
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    json(response, 400, { error: "The body is not JSON." });
    return undefined;
  }
}

/** The store's answer: 400 with why it refused the body, else `status` with the entry. */
function answer(response: ServerResponse, checked: Checked, status: number): void {
  if ("refused" in checked) json(response, 400, { error: checked.refused });
  else json(response, status, checked.entry);
}

async function sendShot(response: ServerResponse, store: FeedbackStore, name: string) {
  const bytes = await store.shot(name);
  if (bytes === undefined) {
    sendStatus(response, 404);
    return;
  }
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": bytes.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(bytes);
}

/** PATCH or DELETE of the entry `id`. */
async function answerEntry(
  { request, response, feedback }: FeedbackRequest,
  id: string,
): Promise<void> {
  if (request.method === "DELETE") {
    sendStatus(response, (await feedback.remove(id)) ? 204 : 404);
    return;
  }
  if (request.method !== "PATCH") {
    sendStatus(response, 405, { allow: "PATCH, DELETE" });
    return;
  }
  const body = await bodyOf(request, response);
  if (body === undefined) return;
  const checked = await feedback.change(id, body.value);
  if (checked === undefined) sendStatus(response, 404);
  else answer(response, checked, 200);
}

/** PUT of the entry `id`'s screenshots. */
async function answerShots({ request, response, feedback }: FeedbackRequest, id: string) {
  if (request.method !== "PUT") {
    sendStatus(response, 405, { allow: "PUT" });
    return;
  }
  const body = await bodyOf(request, response);
  if (body === undefined) return;
  const checked = await feedback.attach(id, body.value);
  if (checked === undefined) sendStatus(response, 404);
  else answer(response, checked, 200);
}

/** Answers a request below /feedback/. */
export async function answerFeedback(feedbackRequest: FeedbackRequest): Promise<void> {
  const { request, response, pathname, token, feedback } = feedbackRequest;
  if (!hasBearer(request, token)) {
    sendUnauthorized(response);
    return;
  }
  const rest = pathname.slice(feedbackPrefix.length);
  if (rest === "") {
    if (request.method === "GET") {
      json(response, 200, { dir: feedback.dir, entries: await feedback.list() });
      return;
    }
    if (request.method !== "POST") {
      sendStatus(response, 405, { allow: "GET, POST" });
      return;
    }
    const body = await bodyOf(request, response);
    if (body !== undefined) answer(response, await feedback.add(body.value), 201);
    return;
  }
  await answerPath(feedbackRequest, rest);
}

/** A request below /feedback/<rest>: a screenshot, an entry's screenshots or an entry. */
async function answerPath(feedbackRequest: FeedbackRequest, rest: string): Promise<void> {
  const { request, response, feedback } = feedbackRequest;
  const shot = /^shots\/([^/]+)$/u.exec(rest);
  if (shot?.[1] !== undefined) {
    if (request.method === "GET") await sendShot(response, feedback, shot[1]);
    else sendStatus(response, 405, { allow: "GET" });
    return;
  }
  const shots = /^([0-9TZ-]+[0-9a-f]{6})\/shots$/u.exec(rest);
  if (shots?.[1] !== undefined) await answerShots(feedbackRequest, shots[1]);
  else if (/^[0-9TZ-]+[0-9a-f]{6}$/u.test(rest)) await answerEntry(feedbackRequest, rest);
  else sendStatus(response, 404);
}
