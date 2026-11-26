// The daemon's endpoints besides /rpc: the notebooks' routes below /n/, the one surface without a
// token; `/ui/` and `/npm/` take the bearer header or the page cookie, `/outputs/`, `/feedback/` and `/schema/settings.json`
// the bearer header only; `/` sends a browser to the Home page `/ui/`, keeping only its `?token=`;
// anything else is 404.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Log } from "../events/log.js";
import type { PageCookie } from "./auth.js";
import { hasBearer } from "./auth.js";
import type { FeedbackStore } from "./feedback.js";
import { answerFeedback, feedbackPrefix } from "./feedback.js";
import type { FullValue } from "./outputs.js";
import { answerOutput, outputsPrefix } from "./outputs.js";
import type { NpmModules } from "./npm.js";
import { answerNpm, npmPrefix } from "./npm.js";
import type { Routes } from "./routes.js";
import { answerRoute, routesPrefix } from "./routes.js";
import type { UiFiles } from "./ui.js";
import { answerUi, isUiPath } from "./ui.js";
import { isRead, sendJson, sendReadOnly, sendStatus, sendUnauthorized } from "./respond.js";

export type PageEndpoints = {
  /** The JSON Schema of the settings. */
  readonly settingsSchema: () => unknown;
  readonly fullValue: FullValue;
  readonly ui: UiFiles;
  readonly routes: Routes;
  readonly npm: NpmModules;
  /** The UI feedback of the page's feedback mode, in the workspace's `.jsnb/feedback/`. */
  readonly feedback: FeedbackStore;
};

export type PageRequest = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly token: string;
  readonly cookie: PageCookie;
  readonly pages: PageEndpoints;
  readonly log: Log;
};

/** GET /: 302 to the Home page, the token carried when one was given and nothing else; it reveals nothing. */
function redirectHome(request: IncomingMessage, response: ServerResponse, url: URL): void {
  if (!isRead(request)) {
    sendReadOnly(response);
    return;
  }
  const token = url.searchParams.get("token");
  const query = token === null ? "" : `?${new URLSearchParams({ token }).toString()}`;
  sendStatus(response, 302, { location: `/ui/${query}`, "cache-control": "no-store" });
}

/** Answers a request that is not /rpc. */
export function answerPage({
  request,
  response,
  url,
  token,
  cookie,
  pages,
  log,
}: PageRequest): Promise<void> {
  if (url.pathname === "/") {
    redirectHome(request, response, url);
    return Promise.resolve();
  }
  if (url.pathname.startsWith(routesPrefix)) {
    return answerRoute({ request, response, url, token, routes: pages.routes, log });
  }
  if (isUiPath(url.pathname))
    return answerUi({ request, response, url, token, cookie, ui: pages.ui });
  if (url.pathname.startsWith(npmPrefix)) {
    return answerNpm({ request, response, url, token, cookie, npm: pages.npm, log });
  }
  if (url.pathname.startsWith(feedbackPrefix)) {
    const { feedback } = pages;
    return answerFeedback({ request, response, pathname: url.pathname, token, feedback });
  }
  if (url.pathname.startsWith(outputsPrefix)) {
    const { fullValue } = pages;
    return answerOutput({ request, response, pathname: url.pathname, token, fullValue, log });
  }
  if (url.pathname !== "/schema/settings.json") {
    sendStatus(response, 404);
    return Promise.resolve();
  }
  if (!isRead(request)) sendReadOnly(response);
  else if (!hasBearer(request, token)) sendUnauthorized(response);
  else sendJson(response, 200, `${JSON.stringify(pages.settingsSchema(), null, 2)}\n`);
  return Promise.resolve();
}
